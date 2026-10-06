import { CanvasErrorCode as C, applyCanvasOps, parseCanvasOp, isCanvasUuid, type CanvasOp, type CanvasScene, type JsonObject, type JsonValue } from '@musecanvas/contracts'
import { canvasAgentPendingIdentity } from '../../../../../packages/database/src/index'
import type { LanguageModelChatTool, LanguageModelChatToolCall } from '../../../../../packages/providers/src/index'
import type { Actor } from '../../auth/security'
import { raise } from './config'
import type { AgentStore, RunContext } from './store'
import { submitPending, type GenerationCreate } from './submit'
import { normalizeSubmissionRequest } from './normalization'

const string = { type: 'string' }, uuid = { type: 'string', format: 'uuid' }, number = { type: 'number' }
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const position = object({ x: number, y: number })
const data = object({ prompt: string, text: string, modelId: uuid, parameters: { type: 'object' }, assetId: uuid, jobId: uuid, sourceNodeId: uuid }, [])
const node = object({ id: uuid, type: { type: 'string', enum: ['prompt', 'image', 'video', 'note'] }, position, size: object({ width: number, height: number }), data }, ['id', 'type', 'position', 'data'])
const schemas: Record<string, Record<string, unknown>> = {
  get_canvas: object({}), list_models: object({ mode: { type: 'string', enum: ['text_to_image', 'image_to_image', 'text_to_video', 'image_to_video'] } }, []),
  add_node: object({ node }), update_node: object({ nodeId: uuid, patch: object({ position, size: object({ width: number, height: number }), data }, []) }),
  remove_node: object({ nodeId: uuid }), connect: object({ edge: object({ id: uuid, source: uuid, target: uuid }) }), disconnect: object({ edgeId: uuid }),
  arrange: object({ positions: { type: 'array', maxItems: 500, items: object({ nodeId: uuid, position }) } }),
  generate_image: object({ prompt: string, modelId: uuid, parameters: { type: 'object' } }),
  generate_video: object({ sourceNodeId: uuid, prompt: string, modelId: uuid, parameters: { type: 'object' } }),
}
export const agentTools: LanguageModelChatTool[] = Object.entries(schemas).map(([name, parameters]) => ({ name, description: name.startsWith('generate_') ? 'Create a persisted pending generation. A pending result ends this round. Video source must already be a saved image with a ready asset.' : 'Read or propose canvas changes; never save the scene.', parameters }))
export function validateToolArguments(name: string, input: unknown): asserts input is JsonObject {
  const schema = schemas[name]
  if (!schema) raise(C.INVALID_INPUT)
  function validate(value: unknown, schema: any, depth = 0): void {
    if (depth > 12) raise(C.INVALID_INPUT)
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) raise(C.INVALID_INPUT)
      const entries = value as Record<string, unknown>
      for (const key of Reflect.ownKeys(entries)) {
        if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in Object.getOwnPropertyDescriptor(entries, key)!)) raise(C.INVALID_INPUT)
        if (schema.additionalProperties === false && !Object.hasOwn(schema.properties, key)) raise(C.INVALID_INPUT)
        if (schema.properties?.[key]) validate(entries[key], schema.properties[key], depth + 1)
      }
      for (const key of schema.required ?? []) if (!Object.hasOwn(entries, key)) raise(C.INVALID_INPUT)
    } else if (schema.type === 'array') {
      if (!Array.isArray(value) || value.length > schema.maxItems) raise(C.INVALID_INPUT)
      for (const item of value) validate(item, schema.items, depth + 1)
    } else if (schema.type === 'string') {
      if (typeof value !== 'string' || value.length > 16000 || (schema.format === 'uuid' && !isCanvasUuid(value))) raise(C.INVALID_INPUT)
    } else if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) raise(C.INVALID_INPUT)
    if (schema.enum && !schema.enum.includes(value)) raise(C.INVALID_INPUT)
  }
  validate(input, schema)
}
function summaryText(value: string): string {
  const text = value.slice(0, 500)
  // A length bound must not split an otherwise valid surrogate pair.
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text
}
export function canvasSummary(scene: CanvasScene): JsonValue {
  return { nodeCount: scene.nodes.length, edgeCount: scene.edges.length, nodes: scene.nodes.slice(0, 50).map(node => ({ id: node.id, type: node.type, position: node.position,
    data: Object.fromEntries(Object.entries(node.data).map(([key, value]) => [key, typeof value === 'string' ? summaryText(value) : key === 'parameters' ? {} : value])) })) as unknown as JsonValue,
    edges: scene.edges.slice(0, 100) as unknown as JsonValue }
}
export interface ToolOutcome { result: JsonValue; ops: CanvasOp[]; pending?: import('../../../../../packages/database/src/index').CanvasAgentPendingJob }
export async function executeTool(input: { store: AgentStore; ctx: RunContext; actor: Actor; call: LanguageModelChatToolCall; scene: CanvasScene; signal: AbortSignal; create: GenerationCreate }): Promise<ToolOutcome> {
  const { store, ctx, actor, call, scene, signal, create } = input
  if (signal.aborted) raise(C.CANVAS_AGENT_CANCELED, 409)
  validateToolArguments(call.name, call.arguments)
  const args = call.arguments as JsonObject
  if (call.name === 'get_canvas') return { result: canvasSummary(scene), ops: [] }
  if (call.name === 'list_models') return { result: await store.models(args.mode as string | undefined), ops: [] }
  if (!call.name.startsWith('generate_')) {
    const parsed = parseCanvasOp({ type: call.name, ...args })
    if (!parsed.success) raise(parsed.error.code)
    const applied = applyCanvasOps(scene, [parsed.data])
    if (!applied.success) raise(applied.error.code)
    await store.validateReferences(ctx, [parsed.data], scene)
    return { result: { ok: true }, ops: [parsed.data] }
  }
  const kind = call.name === 'generate_image' ? 'image' : 'video'
  const parsed = parseCanvasOp({ type: 'add_node', node: { id: ctx.lease.turnId, type: kind, position: { x: 0, y: 0 }, data: { modelId: args.modelId, prompt: args.prompt, parameters: args.parameters } } })
  if (!parsed.success || typeof args.prompt !== 'string' || !args.prompt.trim()) raise(C.INVALID_INPUT)
  const sourceNodeId = kind === 'video' ? args.sourceNodeId as string : null
  const sourceAssetId = sourceNodeId ? await store.source(actor.id, ctx.scope.canvasId, sourceNodeId) : null
  const model = await store.mediaModel(args.modelId as string, kind)
  const request = { modelId: args.modelId as string, prompt: args.prompt as string, parameters: args.parameters as JsonObject,
    inputs: sourceAssetId ? [{ assetId: sourceAssetId, role: 'first_frame', position: 0 }] : [], idempotencyKey: 'agent-validation' }
  const normalized = normalizeSubmissionRequest({ capabilities: model.capabilities, defaults: model.defaults as Record<string, JsonValue>,
    request, kind, signal, deadline: ctx.deadline })
  const namespacedCallId = `${ctx.lease.turnId}:${call.id}`
  const ids = canvasAgentPendingIdentity(ctx.scope.canvasId, namespacedCallId)
  const sourceNode = sourceNodeId ? scene.nodes.find(node => node.id === sourceNodeId) : null
  const ops: CanvasOp[] = [{ type: 'add_node', node: { id: ids.nodeId, type: kind, position: { x: (sourceNode?.position.x ?? 0) + 320, y: sourceNode?.position.y ?? 0 },
    data: { prompt: normalized.prompt, modelId: args.modelId as string, parameters: normalized.parameters as JsonObject, ...(sourceNodeId ? { sourceNodeId } : {}) } } }]
  if (sourceNodeId) ops.push({ type: 'connect', edge: { id: ids.edgeId, source: sourceNodeId, target: ids.nodeId } })
  const applied = applyCanvasOps(scene, ops)
  if (!applied.success) raise(applied.error.code)
  const pending = await store.pending(ctx, { toolCallId: namespacedCallId, kind, prompt: normalized.prompt, modelId: args.modelId as string,
    parameters: normalized.parameters as JsonObject, sourceNodeId, sourceAssetId, baseRevision: ctx.canvas.revision,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), ops, modelConfigDigest: model.digest })
  if (ctx.requireConfirmation) return { pending, result: { pendingId: pending.id, status: pending.status, confirmationRequired: true }, ops: [] }
  if (signal.aborted) raise(C.CANVAS_AGENT_CANCELED, 409)
  const submitted = await submitPending(store, actor, ctx.scope.canvasId, { pendingId: pending.id, approve: true }, create, signal, ctx.settings.timeoutMs)
  return { pending: submitted, result: { pendingId: submitted.id, jobId: submitted.jobId, status: submitted.status }, ops: submitted.ops }
}
