import { normalizedProviderBaseUrl } from '../../../shared/model-helpers'

/**
 * One normalized shape for every credential write, whatever the request spelled.
 *
 * A credential is a provider account (`providerId` + schema + secret + optional
 * endpoint). `plugin` is the template the admin picked: when present the write is
 * validated against that plugin's declared contract, and it is remembered as a
 * hint for connectivity tests. It never restricts which plugins may later use the
 * credential; that is decided by provider account and schema alone.
 */
export type CredentialInput = {
  displayName?: string
  providerId?: string
  plugin?: { pluginId: string; pluginVersion: string }
  schemaId?: string
  schemaVersion?: number
  /** undefined: untouched. null: cleared (update) / plugin default (create). */
  baseUrl?: string | null
  /** Plaintext payload exactly as it will be encrypted: a bare key or a JSON text. */
  secret?: string
  enabled?: boolean
}

export type ParsedCredentialInput = { ok: true; input: CredentialInput } | { ok: false; code: string; message: string }

/**
 * Deprecated request spellings, accepted so existing clients keep working:
 * `adapter` for `providerId` (with Seedream's account living under 'volcengine'),
 * and `credential` / `apiKey` for `secret`.
 */
const ADAPTER_PROVIDERS: Record<string, string> = { openai: 'openai', seedream: 'volcengine', anthropic: 'anthropic' }

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** Objects are serialized; strings are trimmed; an empty secret counts as absent. */
function secretOf(body: Record<string, unknown>): { secret?: string; object?: Record<string, unknown> } {
  for (const candidate of [body.secret, body.credential, body.apiKey]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return { secret: JSON.stringify(candidate), object: candidate as Record<string, unknown> }
    }
    const value = text(candidate)
    if (value === undefined) continue
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        const parsed = JSON.parse(value) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { secret: value, object: parsed as Record<string, unknown> }
      } catch {
        // Not JSON after all: a bare key that happens to be brace-wrapped.
      }
    }
    return { secret: value }
  }
  return {}
}

export function parseCredentialInput(body: Record<string, unknown>): ParsedCredentialInput {
  const input: CredentialInput = {}
  if (body.displayName !== undefined) {
    const displayName = text(body.displayName)
    if (!displayName) return { ok: false, code: 'INVALID_INPUT', message: '凭据名称不能为空' }
    input.displayName = displayName
  }

  const providerId = text(body.providerId) ?? (typeof body.adapter === 'string' ? ADAPTER_PROVIDERS[body.adapter] : undefined)
  if (providerId) input.providerId = providerId

  const pluginId = text(body.pluginId)
  const pluginVersion = text(body.pluginVersion)
  if (!!pluginId !== !!pluginVersion) {
    return { ok: false, code: 'INVALID_INPUT', message: '插件身份需要同时提供 pluginId 与 pluginVersion' }
  }
  if (pluginId && pluginVersion) input.plugin = { pluginId, pluginVersion }

  const schemaId = text(body.schemaId)
  if (schemaId) input.schemaId = schemaId
  if (body.schemaVersion !== undefined) {
    const version = Number(body.schemaVersion)
    if (!Number.isSafeInteger(version) || version < 1) return { ok: false, code: 'INVALID_INPUT', message: '凭据 schema 版本无效' }
    input.schemaVersion = version
  }

  const { secret, object } = secretOf(body)
  if (secret !== undefined) input.secret = secret

  // An explicit field wins; a JSON payload may carry its own endpoint otherwise.
  const rawBaseUrl = body.baseUrl !== undefined ? body.baseUrl : (typeof object?.baseUrl === 'string' ? object.baseUrl : undefined)
  if (rawBaseUrl !== undefined && rawBaseUrl !== null) {
    const baseUrl = normalizedProviderBaseUrl(rawBaseUrl)
    if (baseUrl === null) return { ok: false, code: 'INVALID_BASE_URL', message: 'Base URL 必须是安全的 HTTPS 地址' }
    input.baseUrl = baseUrl || null
  } else if (rawBaseUrl === null) {
    input.baseUrl = null
  }

  if (typeof body.enabled === 'boolean') input.enabled = body.enabled
  return { ok: true, input }
}
