import assert from 'node:assert/strict'
import test from 'node:test'

import '../plugins/index'
import { globalProviderRegistry } from './registry'
import { credentialServesPlugin, pluginCredentialSpec, resolveCredentialBaseUrl } from './credential-spec'
import { validatePluginManifest } from './plugin-scan'
import { hostMatchesAllowlist } from './url-guard'
import type { MediaProviderManifest } from './types'

const manifestOf = (id: string, version: string) => globalProviderRegistry.get(id, version).manifest

const uploaded: MediaProviderManifest = {
  kind: 'media',
  id: 'acme-image',
  version: '1.0.0',
  displayName: 'Acme Image',
  modalities: ['image'],
  allowedHosts: ['*.acme.example', 'api.acme.example'],
  credentialSchemas: ['access-token-v1'],
  models: [{ id: 'acme-1', modalities: ['image'] }],
}

test('host allowlist grammar matches the runtime client exactly', () => {
  assert.equal(hostMatchesAllowlist('api.openai.com', ['api.openai.com']), true)
  assert.equal(hostMatchesAllowlist('API.OPENAI.COM', ['api.openai.com']), true)
  assert.equal(hostMatchesAllowlist('x.volces.com', ['*.volces.com']), true)
  // The apex is not a subdomain of itself.
  assert.equal(hostMatchesAllowlist('volces.com', ['*.volces.com']), false)
  assert.equal(hostMatchesAllowlist('europe-west4-aiplatform.googleapis.com', ['*-aiplatform.googleapis.com']), true)
  assert.equal(hostMatchesAllowlist('evil.com-aiplatform.googleapis.com', ['*-aiplatform.googleapis.com']), false)
  assert.equal(hostMatchesAllowlist('api.openai.com.evil.test', ['api.openai.com']), false)
})

test('built-in plugins declare their provider account and secret format', () => {
  assert.deepEqual(
    ['openai-image@1.1.0', 'seedream-image@1.1.0', 'seedance-video@1.0.0', 'veo-video@1.0.0'].map(key => {
      const [id, version] = key.split('@')
      const spec = pluginCredentialSpec(manifestOf(id, version))
      return [spec.providerId, spec.schemaId, spec.secret.format, spec.baseUrl.policy]
    }),
    [
      ['openai', 'legacy-api-key-v1', 'text', 'fixed'],
      ['volcengine', 'legacy-api-key-v1', 'text', 'fixed'],
      ['volcengine', 'legacy-api-key-v1', 'text', 'allowlisted'],
      ['google', 'json-v1', 'json', 'allowlisted'],
    ],
  )
  // Historical image versions keep serving compatible endpoints.
  assert.equal(pluginCredentialSpec(manifestOf('openai-image', '1.0.0')).baseUrl.policy, 'any-https')
})

test('a manifest without a credential contract gets a conservative derived one', () => {
  const spec = pluginCredentialSpec(uploaded)
  assert.equal(spec.providerId, 'acme-image')
  assert.equal(spec.schemaId, 'access-token-v1')
  // An access token is a bare string, not a service-account JSON document.
  assert.equal(spec.secret.format, 'text')
  assert.deepEqual(spec.baseUrl, { default: 'https://api.acme.example', policy: 'allowlisted' })
})

test('base URL policy: fixed pins the host, allowlisted follows allowedHosts, any-https accepts', () => {
  const openai = manifestOf('openai-image', '1.1.0')
  assert.deepEqual(resolveCredentialBaseUrl(openai, ''), { ok: true, baseUrl: 'https://api.openai.com' })
  assert.deepEqual(resolveCredentialBaseUrl(openai, 'https://api.openai.com/v1'), { ok: true, baseUrl: 'https://api.openai.com/v1' })
  assert.deepEqual(resolveCredentialBaseUrl(openai, 'https://proxy.example.com'), { ok: false })
  // `*.openai.com` is in the allowlist, but `fixed` means the official host only.
  assert.deepEqual(resolveCredentialBaseUrl(openai, 'https://eu.openai.com'), { ok: false })

  const seedance = manifestOf('seedance-video', '1.0.0')
  assert.equal(resolveCredentialBaseUrl(seedance, 'https://ark.ap-southeast.bytepluses.com/api/v3').ok, true)
  assert.equal(resolveCredentialBaseUrl(seedance, 'https://proxy.example.com/api/v3').ok, false)

  const veo = manifestOf('veo-video', '1.0.0')
  assert.equal(resolveCredentialBaseUrl(veo, 'https://europe-west4-aiplatform.googleapis.com').ok, true)

  assert.equal(resolveCredentialBaseUrl(manifestOf('openai-image', '1.0.0'), 'https://compatible.example.com').ok, true)
})

test('a credential serves every plugin of its provider account, regardless of plugin version', () => {
  const volcengineKey = { provider_id: 'volcengine', schema_id: 'legacy-api-key-v1' }
  assert.equal(credentialServesPlugin(manifestOf('seedream-image', '1.1.0'), volcengineKey), true)
  assert.equal(credentialServesPlugin(manifestOf('seedream-image', '1.0.0'), volcengineKey), true)
  assert.equal(credentialServesPlugin(manifestOf('seedance-video', '1.0.0'), volcengineKey), true)
  assert.equal(credentialServesPlugin(manifestOf('openai-image', '1.1.0'), volcengineKey), false)
  // Same provider, schema the plugin cannot decode.
  assert.equal(credentialServesPlugin(manifestOf('veo-video', '1.0.0'), { provider_id: 'google', schema_id: 'legacy-api-key-v1' }), false)
  // Rows predating schema_id are bare keys.
  assert.equal(credentialServesPlugin(manifestOf('openai-image', '1.1.0'), { provider_id: 'openai' }), true)
})

test('uploaded manifests may declare a credential contract, within limits', () => {
  const base = { ...uploaded, credentialSchemas: ['legacy-api-key-v1'] }
  const good = validatePluginManifest({
    ...base,
    credential: {
      providerId: 'acme',
      schemaId: 'legacy-api-key-v1',
      secret: { format: 'text', label: 'Acme Key' },
      baseUrl: { default: 'https://api.acme.example', policy: 'fixed' },
    },
  })
  assert.equal(good.ok, true)
  if (good.ok) assert.equal(good.manifest.credential?.providerId, 'acme')

  const reject = (credential: unknown) => {
    const result = validatePluginManifest({ ...base, credential })
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.findings.some(finding => finding.rule === 'INVALID_CREDENTIAL_SPEC'))
  }
  const valid = {
    providerId: 'acme', schemaId: 'legacy-api-key-v1',
    secret: { format: 'text', label: 'Acme Key' }, baseUrl: { policy: 'allowlisted' },
  }
  reject({ ...valid, baseUrl: { policy: 'any-https' } })
  reject({ ...valid, schemaId: 'json-v1' })
  reject({ ...valid, providerId: 'Not Valid' })
  reject({ ...valid, secret: { format: 'binary', label: 'x' } })
  reject({ ...valid, baseUrl: { policy: 'allowlisted', default: 'https://elsewhere.example' } })
  reject({ ...valid, baseUrl: { policy: 'fixed' } })
})
