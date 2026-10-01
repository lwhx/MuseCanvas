import type { BuiltinProviderTemplate } from '@musecanvas/contracts'
import { globalProviderRegistry, pluginCredentialSpec } from '@musecanvas/providers'
import {
  installedPluginBaseUrl,
  presetsForCatalogPlugins,
  type CatalogPlugin,
} from '../modules/admin/plugin-catalog'
import { modelPresets, type ImageModelPreset, type ModelPreset, type VideoModelPreset } from './model-presets'

type PluginPreset = ImageModelPreset | VideoModelPreset

// Narrows a preset to one carrying an exact built-in plugin identity. Presets
// synthesized from an uploaded manifest can never collide here: uploading a key the
// static registry already owns is rejected (PLUGIN_ID_RESERVED), so an exact built-in
// spec key always belongs to a shipped preset.
function isPluginPreset(preset: ModelPreset, pluginId: string, pluginVersion: string): preset is PluginPreset {
  return 'pluginId' in preset && preset.pluginId === pluginId && 'pluginVersion' in preset && preset.pluginVersion === pluginVersion
}

/**
 * The built-in plugins offered as templates, and the only things the manifest does
 * not say about them: a short catalog name and the deprecated `adapter` string.
 * Provider account, credential format, endpoint and endpoint policy all come from
 * the plugin's own `manifest.credential`, exactly as for an uploaded plugin.
 */
const BUILTIN_TEMPLATES: { key: string; pluginId: string; pluginVersion: string; displayName: string; adapter: string }[] = [
  { key: 'openai-image', pluginId: 'openai-image', pluginVersion: '1.1.0', displayName: 'OpenAI Image', adapter: 'openai' },
  { key: 'seedream-image', pluginId: 'seedream-image', pluginVersion: '1.1.0', displayName: 'Seedream Image', adapter: 'seedream' },
  { key: 'seedance-video', pluginId: 'seedance-video', pluginVersion: '1.0.0', displayName: 'Seedance Video', adapter: 'seedream' },
  { key: 'veo-video', pluginId: 'veo-video', pluginVersion: '1.0.0', displayName: 'Veo Video', adapter: 'veo' },
]

/**
 * One template per plugin, built the same way for both sources. Built-ins take
 * their preset membership from the shipped presets and fail loudly when a preset
 * names a vendor model the manifest no longer has; uploads take theirs from the
 * presets synthesized off their own manifest.
 */
function templateFor(
  entry: CatalogPlugin,
  builtin?: { key: string; displayName: string; adapter: string },
): BuiltinProviderTemplate | null {
  const manifest = entry.manifest
  if (manifest.kind !== 'media') return null
  const spec = pluginCredentialSpec(manifest)
  const models = (manifest.models ?? []).map(model => ({ id: model.id, ...(model.name ? { name: model.name } : {}) }))
  const modelIds = new Set(models.map(model => model.id))
  const presetIds = builtin
    ? modelPresets
      .filter(preset => isPluginPreset(preset, manifest.id, manifest.version))
      .map(preset => {
        if (!modelIds.has(preset.vendorModelId)) {
          throw new Error(
            `Builtin provider template '${builtin.key}' preset '${preset.id}' ` +
              `vendorModelId '${preset.vendorModelId}' is absent from plugin ` +
              `${manifest.id}@${manifest.version} manifest`,
          )
        }
        return preset.id
      })
    : presetsForCatalogPlugins([entry]).map(preset => preset.id)
  return {
    key: builtin?.key ?? `installed:${manifest.id}@${manifest.version}`,
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    providerId: spec.providerId,
    // No legacy adapter exists for an uploaded plugin; its id keeps the deprecated
    // field populated without ever colliding with openai/seedream/anthropic.
    adapter: builtin?.adapter ?? manifest.id,
    displayName: builtin?.displayName ?? manifest.displayName,
    ...(manifest.description ? { description: manifest.description } : {}),
    modality: manifest.modalities[0],
    baseUrl: installedPluginBaseUrl(manifest),
    credential: {
      schemaId: spec.schemaId,
      schemaVersion: 1,
      format: spec.secret.format,
      kind: spec.secret.format === 'json' ? 'google_service_account' : 'api_key',
      label: spec.secret.label,
      ...(spec.secret.placeholder ? { placeholder: spec.secret.placeholder } : {}),
      ...(spec.secret.help ? { helpText: spec.secret.help } : {}),
      baseUrlPolicy: spec.baseUrl.policy,
    },
    presetIds,
    models,
    ...(entry.source === 'installed' ? { source: 'installed' as const } : {}),
  }
}

function builtinTemplate(entry: (typeof BUILTIN_TEMPLATES)[number]): BuiltinProviderTemplate {
  const manifest = globalProviderRegistry.get(entry.pluginId, entry.pluginVersion).manifest
  const template = templateFor({ source: 'builtin', manifest }, entry)
  if (!template) throw new Error(`Builtin provider template '${entry.key}' is not a media plugin`)
  return template
}

/**
 * The built-in templates, then one per active installed media plugin (resolved by
 * the caller from the catalog); omitting `installed` keeps the built-in listing.
 */
export function buildBuiltinProviderTemplates(installed: CatalogPlugin[] = []): BuiltinProviderTemplate[] {
  const uploaded = installed
    .filter(entry => entry.source === 'installed')
    .map(entry => templateFor(entry))
    .filter((template): template is BuiltinProviderTemplate => template !== null)
  return [...BUILTIN_TEMPLATES.map(builtinTemplate), ...uploaded]
}

/** The built-in template for an exact plugin identity, or null for any other key. */
export function builtinProviderTemplateForPlugin(
  pluginId: string,
  pluginVersion: string,
): BuiltinProviderTemplate | null {
  const entry = BUILTIN_TEMPLATES.find(candidate => candidate.pluginId === pluginId && candidate.pluginVersion === pluginVersion)
  return entry ? builtinTemplate(entry) : null
}
