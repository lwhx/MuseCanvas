import { CanvasErrorCode as C, type CreateGenerationRequest, type JsonValue, type ModelCapabilities } from '@musecanvas/contracts'
import { serializeCanonicalJson, validateGenerationRequest, type NormalizedGenerationRequest } from '@musecanvas/domain'
import { raise } from './config'

/** Visibility is evaluated on raw parameters before defaults. Freeze a validated
 * fixed point so generation's subsequent validation produces exactly this payload.
 * Allow passes for dependency activation and hidden-value removal, then verification;
 * cap work for cyclic/deep contracts without changing other callers' validator. */
export function normalizeSubmissionRequest(input: {
  capabilities: ModelCapabilities; defaults: Record<string, JsonValue>; request: CreateGenerationRequest
  kind: 'image' | 'video'; signal: AbortSignal; deadline: number
}): NormalizedGenerationRequest {
  const { capabilities, defaults, kind, signal, deadline } = input
  const check = () => {
    if (signal.aborted) raise(signal.reason === 'timeout' ? C.CANVAS_AGENT_TIMEOUT : C.CANVAS_AGENT_CANCELED, 409)
    if (Date.now() >= deadline) raise(C.CANVAS_AGENT_TIMEOUT, 409)
  }
  const maxPasses = Math.min(64, capabilities.parameters.length * 2 + 3)
  const seen = new Set<string>()
  let request = input.request, previous: string | undefined
  for (let pass = 0; pass < maxPasses; pass++) {
    check()
    const validation = validateGenerationRequest(capabilities, request, { defaults })
    check()
    if (!validation.valid || !validation.value || validation.value.mode !== (kind === 'image' ? 'text_to_image' : 'image_to_video')) raise(C.INVALID_INPUT)
    const normalized = validation.value
    const canonical = serializeCanonicalJson({ modelId: normalized.modelId, prompt: normalized.prompt,
      parameters: normalized.parameters, inputs: normalized.inputs, mode: normalized.mode })
    if (canonical === previous) return normalized
    if (seen.has(canonical)) raise(C.INVALID_INPUT)
    seen.add(canonical); previous = canonical
    request = { ...request, prompt: normalized.prompt, parameters: normalized.parameters, inputs: normalized.inputs }
  }
  return raise(C.CANVAS_AGENT_BUDGET_EXCEEDED, 409)
}
