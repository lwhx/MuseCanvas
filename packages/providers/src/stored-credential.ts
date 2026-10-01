import { decodeCredential } from './core/credentials'
import type { DecodedCredential } from './core/types'
import { decryptProviderCredential } from './crypto'

/**
 * The one place a stored `provider_credentials` row becomes a usable secret.
 *
 * Rows carry up to two ciphertext columns from different eras: `payload_encrypted`
 * (current: the whole credential payload) and `api_key_encrypted` (pre-payload: a
 * bare API key). Every reader used to pick between them on its own, with drifting
 * rules. They now all go through these helpers, so the fallback order, empty-string
 * handling and key-id selection are decided exactly once.
 *
 * Lives outside `core/` on purpose: it pulls in node:crypto key derivation, and
 * `core/` must stay importable by uploaded plugin bundles.
 */

/** The ciphertext-bearing columns of a `provider_credentials` row. */
export type StoredCredentialFields = {
  payload_encrypted?: string | null
  api_key_encrypted?: string | null
  encryption_key_id?: string | null
  schema_id?: string | null
}

/** Default schema for rows that predate `schema_id` (a bare API key string). */
export const LEGACY_CREDENTIAL_SCHEMA = 'legacy-api-key-v1'

/** Current payload first, then the legacy single-key column; empty strings count as absent. */
export function storedCredentialCiphertext(row: StoredCredentialFields | null | undefined): string | null {
  if (!row) return null
  if (typeof row.payload_encrypted === 'string' && row.payload_encrypted) return row.payload_encrypted
  if (typeof row.api_key_encrypted === 'string' && row.api_key_encrypted) return row.api_key_encrypted
  return null
}

export function hasStoredCredentialSecret(row: StoredCredentialFields | null | undefined): boolean {
  return storedCredentialCiphertext(row) !== null
}

/**
 * Decrypts the stored secret to its plaintext payload (a bare key or a JSON text).
 * Throws `PROVIDER_NOT_CONFIGURED` when the row holds no secret, and the crypto
 * layer's stable codes (DECRYPTION_FAILED, UNSUPPORTED_KEY_ID, ...) otherwise.
 * Callers map those onto their own error vocabulary.
 */
export function decryptStoredCredential(row: StoredCredentialFields): string {
  const ciphertext = storedCredentialCiphertext(row)
  if (!ciphertext) throw new Error('PROVIDER_NOT_CONFIGURED')
  const keyId = typeof row.encryption_key_id === 'string' && row.encryption_key_id ? row.encryption_key_id : null
  return decryptProviderCredential(ciphertext, keyId)
}

export type OpenedCredential = {
  /** Decrypted payload exactly as stored; still needed by the built-in language path. */
  raw: string
  decoded: DecodedCredential
}

/**
 * Decodes an already-decrypted payload by the row's schema. Split from decryption
 * so callers can map a decrypt failure onto their own error code while a decode
 * failure keeps its NormalizedProviderError. `plugin` only labels that error.
 */
export function decodeStoredCredential(
  row: StoredCredentialFields,
  raw: string,
  plugin?: { pluginId: string; pluginVersion: string },
): DecodedCredential {
  const schema = typeof row.schema_id === 'string' && row.schema_id ? row.schema_id : LEGACY_CREDENTIAL_SCHEMA
  return decodeCredential(raw, schema, plugin?.pluginId, plugin?.pluginVersion)
}

/** Decrypt and decode in one step, for callers that treat both failures alike. */
export function openStoredCredential(
  row: StoredCredentialFields,
  plugin?: { pluginId: string; pluginVersion: string },
): OpenedCredential {
  const raw = decryptStoredCredential(row)
  return { raw, decoded: decodeStoredCredential(row, raw, plugin) }
}
