import type { LanguageProviderManifest, MediaProviderManifest, PluginCredentialSpec } from './types'
import { hostMatchesAllowlist, urlHostOf } from './url-guard'

/**
 * Reading and enforcing a plugin's declared credential contract. Pure: no I/O, no
 * node builtins, so the API (which never loads plugin code) and the worker apply
 * exactly the same rules from the same manifest data.
 */

type AnyManifest = MediaProviderManifest | LanguageProviderManifest

/**
 * The plugin's credential contract. A manifest that predates `credential` (an
 * uploaded package from before the field existed) gets a conservative one derived
 * from what it did declare: its own id as the provider namespace, its first schema,
 * and its first exact allowed host as the default endpoint.
 */
export function pluginCredentialSpec(manifest: AnyManifest): PluginCredentialSpec {
  if (manifest.credential) return manifest.credential
  const schemaId = manifest.credentialSchemas[0] ?? 'legacy-api-key-v1'
  const exactHost = manifest.allowedHosts.find(host => !!host && !host.includes('*'))
  const help = `${manifest.id}@${manifest.version} 声明的凭据格式（${schemaId}）。`
  return {
    providerId: manifest.id,
    schemaId,
    secret: schemaId === 'json-v1'
      ? { format: 'json', label: `${manifest.displayName} 凭据 JSON`, placeholder: '{"...":"..."}', help }
      : { format: 'text', label: `${manifest.displayName} API Key`, placeholder: 'API key', help },
    baseUrl: { ...(exactHost ? { default: `https://${exactHost}` } : {}), policy: 'allowlisted' },
  }
}

export type CredentialBaseUrlResult = { ok: true; baseUrl: string | undefined } | { ok: false }

/**
 * Applies the plugin's base URL policy to a requested endpoint (already normalized
 * to a safe https URL by the caller, or empty). An empty request resolves to the
 * declared default. Hosts are compared, never full strings, matching how the
 * egress allowlist is enforced at call time.
 */
export function resolveCredentialBaseUrl(
  manifest: AnyManifest,
  requested: string | null | undefined,
): CredentialBaseUrlResult {
  const spec = pluginCredentialSpec(manifest)
  if (!requested) return { ok: true, baseUrl: spec.baseUrl.default }
  const host = urlHostOf(requested)
  if (!host) return { ok: false }
  switch (spec.baseUrl.policy) {
    case 'fixed': {
      const fixedHost = spec.baseUrl.default ? urlHostOf(spec.baseUrl.default) : null
      if (!fixedHost) return hostMatchesAllowlist(host, manifest.allowedHosts) ? { ok: true, baseUrl: requested } : { ok: false }
      return host.toLowerCase() === fixedHost.toLowerCase() ? { ok: true, baseUrl: requested } : { ok: false }
    }
    case 'allowlisted':
      return hostMatchesAllowlist(host, manifest.allowedHosts) ? { ok: true, baseUrl: requested } : { ok: false }
    case 'any-https':
      return { ok: true, baseUrl: requested }
  }
}

/**
 * Whether a stored credential can serve this plugin: same provider account and a
 * schema the plugin can decode. Plugin version never enters into it.
 */
export function credentialServesPlugin(
  manifest: AnyManifest,
  credential: { provider_id?: unknown; schema_id?: unknown },
): boolean {
  const spec = pluginCredentialSpec(manifest)
  if (credential.provider_id !== spec.providerId) return false
  const schema = typeof credential.schema_id === 'string' && credential.schema_id ? credential.schema_id : 'legacy-api-key-v1'
  return manifest.credentialSchemas.includes(schema)
}
