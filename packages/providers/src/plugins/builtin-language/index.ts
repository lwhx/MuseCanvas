import { callProtocolLanguageModel } from '../../language-model'
import { NormalizedProviderError } from '../../core/errors'
import type {
  LanguageCompletionResult,
  LanguageProtocol,
  LanguageProviderManifest,
  LanguageProviderPlugin,
  LanguageRequest,
  ProviderConfig,
} from '../../core/types'

/**
 * The native language protocols as first-class plugins.
 *
 * They exist so built-in language models have what every other model has: a real
 * registry key (the ids migration 0012 backfilled onto each language row) and a
 * manifest declaring the provider account and credential format. Dispatch still
 * short-circuits built-in keys to `callProtocolLanguageModel` (see
 * `isBuiltinLanguagePluginKey`); `complete` routes to the same function, so a
 * caller reaching a built-in through the plugin interface gets identical bytes.
 *
 * `any-https` because OpenAI- and Anthropic-compatible gateways are a supported
 * configuration for language models; the per-request allowlist plus the private
 * address gate in `callProtocolLanguageModel` remain the egress policy.
 */

function builtinLanguageManifest(input: {
  id: string
  displayName: string
  protocols: LanguageProtocol[]
  host: string
  providerId: string
  label: string
  placeholder: string
}): LanguageProviderManifest {
  return {
    kind: 'language',
    id: input.id,
    version: '1.0.0',
    displayName: input.displayName,
    languageProtocols: input.protocols,
    allowedHosts: [input.host],
    credentialSchemas: ['legacy-api-key-v1'],
    credential: {
      providerId: input.providerId,
      schemaId: 'legacy-api-key-v1',
      secret: { format: 'text', label: input.label, placeholder: input.placeholder },
      baseUrl: { default: `https://${input.host}`, policy: 'any-https' },
    },
  }
}

class BuiltinLanguagePlugin implements LanguageProviderPlugin {
  constructor(readonly manifest: LanguageProviderManifest) {}

  validateConfig(config: ProviderConfig): void {
    if (!config.credential?.apiKey) {
      throw NormalizedProviderError.create(this.manifest.id, this.manifest.version, 'INVALID_CREDENTIAL', 'An API key is required')
    }
  }

  async complete(request: LanguageRequest, config: ProviderConfig): Promise<LanguageCompletionResult> {
    this.validateConfig(config)
    const protocol = request.protocol ?? this.manifest.languageProtocols[0]
    if (!this.manifest.languageProtocols.includes(protocol)) {
      throw NormalizedProviderError.create(this.manifest.id, this.manifest.version, 'INVALID_CONFIG', `Protocol '${protocol}' is not served by ${this.manifest.id}`)
    }
    return callProtocolLanguageModel({
      protocol,
      vendorModelId: request.vendorModelId,
      baseUrl: config.baseUrl,
      apiKey: config.credential?.apiKey as string,
      system: request.system,
      user: request.user,
      schemaName: request.schemaName,
      schema: request.schema,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      reasoningEffort: request.reasoningEffort,
      timeoutMs: request.timeoutMs,
    })
  }
}

export const openAiLanguagePlugin = new BuiltinLanguagePlugin(builtinLanguageManifest({
  id: 'openai-language',
  displayName: 'OpenAI 兼容语言模型',
  protocols: ['openai_chat', 'openai_responses'],
  host: 'api.openai.com',
  providerId: 'openai',
  label: 'OpenAI API Key',
  placeholder: 'sk-...',
}))

export const anthropicLanguagePlugin = new BuiltinLanguagePlugin(builtinLanguageManifest({
  id: 'anthropic-language',
  displayName: 'Anthropic 语言模型',
  protocols: ['anthropic_messages'],
  host: 'api.anthropic.com',
  providerId: 'anthropic',
  label: 'Anthropic API Key',
  placeholder: 'sk-ant-...',
}))
