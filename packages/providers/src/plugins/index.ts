import { globalPluginRegistry } from '../core/plugin-registry'
import { globalProviderRegistry } from '../core/registry'
import { anthropicLanguagePlugin, openAiLanguagePlugin } from './builtin-language/index'
import { legacyOpenAiImagePlugin, openAiImagePlugin } from './openai-image/index'
import { legacySeedreamImagePlugin, seedreamImagePlugin } from './seedream-image/index'
import { seedanceVideoPlugin } from './seedance-video/index'
import { veoVideoPlugin } from './veo-video/index'

// Register bundled static plugins idempotently. Image plugins keep both the
// hardened active (1.1.0) and the legacy (1.0.0) registrations so
// already-pinned revisions keep resolving while new revisions use 1.1.0.
for (const plugin of [openAiImagePlugin, legacyOpenAiImagePlugin, seedreamImagePlugin, legacySeedreamImagePlugin, seedanceVideoPlugin, veoVideoPlugin]) {
  if (!globalProviderRegistry.has(plugin.manifest.id, plugin.manifest.version)) {
    globalProviderRegistry.register(plugin)
  }
}
// The native language protocols, under the keys historical language rows carry.
for (const plugin of [openAiLanguagePlugin, anthropicLanguagePlugin]) {
  if (!globalPluginRegistry.has(plugin.manifest.id, plugin.manifest.version)) {
    globalPluginRegistry.registerLanguage(plugin)
  }
}

export * from '../core/index'
export * from './openai-image/index'
export * from './seedream-image/index'
export * from './seedance-video/index'
export * from './veo-video/index'
export * from './builtin-language/index'
