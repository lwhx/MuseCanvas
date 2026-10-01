import type pg from 'pg'

/**
 * Row access for `provider_credentials`. Ciphertext columns are returned as-is:
 * turning them into a secret is `openStoredCredential` in packages/providers, so
 * this package never depends on key material.
 */
export interface ProviderCredentialRow {
  id: string
  display_name: string
  adapter: string | null
  provider_id: string | null
  schema_id: string | null
  schema_version: number
  base_url: string | null
  enabled: boolean
  payload_encrypted: string | null
  api_key_encrypted: string | null
  api_key_fingerprint: string | null
  encryption_key_id: string | null
  configured_fields: Record<string, unknown> | null
  last_test_status: string | null
  last_test_error_code: string | null
  last_tested_at: Date | null
  test_requested_at: Date | null
  test_requested_by: string | null
  test_claimed_at: Date | null
  created_by: string | null
  updated_by: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

type Queryable = pg.PoolClient | pg.Pool

/** A live (not soft-deleted) credential, or null. Disabled rows are returned; callers decide. */
export async function findProviderCredential(client: Queryable, id: string): Promise<ProviderCredentialRow | null> {
  const result = await client.query<ProviderCredentialRow>(
    'SELECT * FROM provider_credentials WHERE id=$1 AND deleted_at IS NULL',
    [id],
  )
  return result.rows[0] ?? null
}

export type ProviderCredentialTestResult =
  | { status: 'success' }
  | { status: 'failed'; errorCode: string }

/**
 * Opens a connectivity test request: the row reads 'pending' until a worker
 * settles it. Returns the request's identity (its timestamp), or null for a
 * missing or deleted credential. A repeated click simply supersedes the open
 * request; the older probe's result is then discarded on settle.
 */
export async function requestProviderCredentialTest(
  client: Queryable,
  id: string,
  actorId: string | null,
): Promise<Date | null> {
  const result = await client.query<{ test_requested_at: Date }>(
    `UPDATE provider_credentials
        SET last_test_status='pending',last_test_error_code=NULL,
            -- Millisecond precision: the timestamp round-trips through a JS Date as
            -- the request identity, so it must compare equal when it comes back.
            test_requested_at=date_trunc('milliseconds', clock_timestamp()),test_requested_by=$2,test_claimed_at=NULL
      WHERE id=$1 AND deleted_at IS NULL
      RETURNING test_requested_at`,
    [id, actorId],
  )
  return result.rows[0]?.test_requested_at ?? null
}

export type ClaimedCredentialTest = { id: string; requestedAt: Date; requestedBy: string | null }

/**
 * Claims up to `limit` open requests for this worker. A claim older than
 * `staleAfterMs` is treated as abandoned (its worker died) and claimed again.
 */
export async function claimProviderCredentialTests(
  client: Queryable,
  limit: number,
  staleAfterMs: number,
): Promise<ClaimedCredentialTest[]> {
  const result = await client.query<{ id: string; test_requested_at: Date; test_requested_by: string | null }>(
    `UPDATE provider_credentials SET test_claimed_at=clock_timestamp()
      WHERE id IN (
        SELECT id FROM provider_credentials
         WHERE test_requested_at IS NOT NULL AND deleted_at IS NULL
           AND (test_claimed_at IS NULL OR test_claimed_at < clock_timestamp() - ($2::int * interval '1 millisecond'))
         ORDER BY test_requested_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING id,test_requested_at,test_requested_by`,
    [limit, staleAfterMs],
  )
  return result.rows.map(row => ({ id: row.id, requestedAt: row.test_requested_at, requestedBy: row.test_requested_by }))
}

/**
 * Stamps a test outcome and audits it in one transaction. With `requestedAt`,
 * only that exact request is settled (and closed); a newer request opened in the
 * meantime is left pending for its own probe. Returns whether anything was stamped.
 */
export async function recordProviderCredentialTest(
  client: pg.Pool,
  id: string,
  result: ProviderCredentialTestResult,
  options: { actorId?: string | null; requestedAt?: Date } = {},
): Promise<boolean> {
  const conn = await client.connect()
  try {
    await conn.query('BEGIN')
    const errorCode = result.status === 'failed' ? result.errorCode : null
    const updated = await conn.query(
      `UPDATE provider_credentials
          SET last_test_status=$2,last_test_error_code=$3,last_tested_at=now(),
              test_requested_at=CASE WHEN $4::timestamptz IS NULL THEN test_requested_at ELSE NULL END,
              test_requested_by=CASE WHEN $4::timestamptz IS NULL THEN test_requested_by ELSE NULL END,
              test_claimed_at=CASE WHEN $4::timestamptz IS NULL THEN test_claimed_at ELSE NULL END
        WHERE id=$1 AND deleted_at IS NULL
          AND ($4::timestamptz IS NULL OR test_requested_at = $4::timestamptz)`,
      [id, result.status, errorCode, options.requestedAt ?? null],
    )
    if (updated.rowCount === 1) {
      await conn.query(
        'INSERT INTO audit_logs(actor_id,action,target_type,target_id,summary) VALUES($1,$2,$3,$4,$5)',
        [options.actorId ?? null, 'provider_credential.test', 'provider_credential', id,
          errorCode === null ? { status: result.status } : { status: result.status, errorCode }],
      )
    }
    await conn.query('COMMIT')
    return updated.rowCount === 1
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}
