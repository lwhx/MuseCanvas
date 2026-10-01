import assert from 'node:assert/strict'
import test from 'node:test'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'

process.env.APP_MASTER_KEY = process.env.APP_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY = 'legacy-provider-secret'

const { encryptProviderCredential, CURRENT_KEY_ID } = await import('./crypto')
const {
  decryptStoredCredential,
  hasStoredCredentialSecret,
  openStoredCredential,
  storedCredentialCiphertext,
} = await import('./stored-credential')

/** Ciphertext as written before the master-key rollout: AES-GCM under sha256(legacy env secret). */
function legacyEncrypt(value: string): string {
  const key = createHash('sha256').update('legacy-provider-secret').digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`
}

test('payload_encrypted wins over the legacy api key column', () => {
  const payload = encryptProviderCredential('{"apiKey":"sk-new"}').ciphertext
  const legacy = encryptProviderCredential('sk-old').ciphertext
  assert.equal(storedCredentialCiphertext({ payload_encrypted: payload, api_key_encrypted: legacy }), payload)
})

test('an empty payload falls back to the legacy column, and nothing means no secret', () => {
  const legacy = encryptProviderCredential('sk-old').ciphertext
  assert.equal(storedCredentialCiphertext({ payload_encrypted: '', api_key_encrypted: legacy }), legacy)
  assert.equal(hasStoredCredentialSecret({ payload_encrypted: null, api_key_encrypted: '' }), false)
  assert.equal(hasStoredCredentialSecret(undefined), false)
  assert.throws(() => decryptStoredCredential({}), /PROVIDER_NOT_CONFIGURED/)
})

test('current-key rows decrypt with their stamped key id', () => {
  const envelope = encryptProviderCredential('sk-current')
  assert.equal(decryptStoredCredential({ payload_encrypted: envelope.ciphertext, encryption_key_id: envelope.keyId }), 'sk-current')
  assert.equal(envelope.keyId, CURRENT_KEY_ID)
})

test('pre-rollout rows (null or legacy key id) still decrypt through the legacy key', () => {
  const ciphertext = legacyEncrypt('sk-legacy')
  assert.equal(decryptStoredCredential({ api_key_encrypted: ciphertext, encryption_key_id: null }), 'sk-legacy')
  assert.equal(decryptStoredCredential({ payload_encrypted: ciphertext, encryption_key_id: 'legacy' }), 'sk-legacy')
})

test('unknown key ids fail closed', () => {
  const envelope = encryptProviderCredential('sk-current')
  assert.throws(() => decryptStoredCredential({ payload_encrypted: envelope.ciphertext, encryption_key_id: 'app-key-v99' }), /UNSUPPORTED_KEY_ID/)
})

test('openStoredCredential decodes bare keys and JSON payloads by schema', () => {
  const bare = openStoredCredential({ payload_encrypted: encryptProviderCredential('sk-bare').ciphertext })
  assert.equal(bare.raw, 'sk-bare')
  assert.deepEqual(bare.decoded, { schema: 'legacy-api-key-v1', apiKey: 'sk-bare' })

  const json = openStoredCredential({
    payload_encrypted: encryptProviderCredential('{"client_email":"a@b","private_key":"k"}').ciphertext,
    schema_id: 'json-v1',
  })
  assert.equal(json.decoded.schema, 'json-v1')
  assert.deepEqual(json.decoded.extra, { client_email: 'a@b', private_key: 'k' })
})
