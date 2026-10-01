/**
 * Re-seals provider credentials still encrypted under the pre-rollout provider
 * key (encryption_key_id NULL or 'legacy', keyed by
 * PROVIDER_CREDENTIALS_ENCRYPTION_KEY) with the current APP_MASTER_KEY-derived
 * key, so that legacy key can eventually leave the read path.
 *
 * Run after migration 0027 (every secret is in payload_encrypted by then):
 *
 *   pnpm --filter @musecanvas/database exec tsx ../../scripts/reencrypt-provider-credentials.ts --dry-run
 *   pnpm --filter @musecanvas/database exec tsx ../../scripts/reencrypt-provider-credentials.ts
 *
 * Env: DATABASE_URL, APP_MASTER_KEY, PROVIDER_CREDENTIALS_ENCRYPTION_KEY.
 *
 * Safe to re-run and to interrupt: each row is re-sealed in its own transaction,
 * guarded by compare-and-set on the ciphertext it read, so a row an admin rotated
 * meanwhile is skipped rather than overwritten, and finished rows are no longer
 * selected. Soft-deleted rows are included: their secrets are still at rest.
 * Plaintext never leaves the process; only ids and stable error codes are logged.
 * Exits 1 when any row could not be re-sealed.
 */
import { db, transaction } from '../packages/database/src/index'
import { CURRENT_KEY_ID, decryptStoredCredential, encryptProviderCredential } from '../packages/providers/src/index'

const dryRun = process.argv.includes('--dry-run')

type Row = {
  id: string
  payload_encrypted: string | null
  api_key_encrypted: string | null
  encryption_key_id: string | null
}

async function main(): Promise<number> {
  const pending = await db().query<Row>(
    `SELECT id,payload_encrypted,api_key_encrypted,encryption_key_id FROM provider_credentials
      WHERE encryption_key_id IS DISTINCT FROM $1
        AND (COALESCE(payload_encrypted,'') <> '' OR COALESCE(api_key_encrypted,'') <> '')
      ORDER BY id`,
    [CURRENT_KEY_ID],
  )
  const tally = { scanned: pending.rows.length, resealed: 0, skipped: 0, failed: 0 }
  for (const row of pending.rows) {
    let plaintext: string
    try {
      plaintext = decryptStoredCredential(row)
    } catch (error) {
      tally.failed += 1
      console.error(`reencrypt: ${row.id} cannot be decrypted (${error instanceof Error ? error.message.split(':')[0] : 'UNKNOWN'})`)
      continue
    }
    if (dryRun) {
      tally.resealed += 1
      continue
    }
    const envelope = encryptProviderCredential(plaintext)
    const changed = await transaction(async (client) => {
      // The payload now carries the secret on its own, so the legacy single-key
      // copy is cleared rather than left behind under the retiring key.
      const updated = await client.query(
        `UPDATE provider_credentials SET payload_encrypted=$2,encryption_key_id=$3,api_key_encrypted=NULL
          WHERE id=$1 AND payload_encrypted IS NOT DISTINCT FROM $4 AND api_key_encrypted IS NOT DISTINCT FROM $5
            AND encryption_key_id IS NOT DISTINCT FROM $6`,
        [row.id, envelope.ciphertext, envelope.keyId, row.payload_encrypted, row.api_key_encrypted, row.encryption_key_id],
      )
      if (updated.rowCount !== 1) return false
      await client.query(
        'INSERT INTO audit_logs(actor_id,action,target_type,target_id,summary) VALUES(NULL,$1,$2,$3,$4)',
        ['provider_credential.reencrypt', 'provider_credential', row.id, { fromKeyId: row.encryption_key_id ?? 'legacy', toKeyId: envelope.keyId }],
      )
      return true
    })
    if (changed) tally.resealed += 1
    else tally.skipped += 1
  }

  // Provider-run opaque state is re-sealed by the worker on its next write; only
  // runs still in flight could ever be read again, so they are what is reported.
  const runs = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM provider_runs
      WHERE encrypted_state_payload IS NOT NULL AND encrypted_state_key_id IS DISTINCT FROM $1
        AND operation_state IN ('submitting','submission_unknown','waiting','importing','canceling')`,
    [CURRENT_KEY_ID],
  )
  console.log(
    `reencrypt${dryRun ? ' (dry run)' : ''}: ${tally.scanned} scanned, ${tally.resealed} ${dryRun ? 'would be re-sealed' : 're-sealed'}, ` +
      `${tally.skipped} skipped (changed concurrently), ${tally.failed} failed; ` +
      `${runs.rows[0]?.n ?? 0} in-flight provider runs still hold legacy-keyed state`,
  )
  return tally.failed > 0 ? 1 : 0
}

main()
  .catch((error: unknown) => {
    console.error('reencrypt failed:', error instanceof Error ? error.message : error)
    return 1
  })
  .then(async (exitCode) => {
    await db().end()
    process.exit(exitCode)
  })
