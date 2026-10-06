import type { AgentMessageDto, CanvasAgentPendingJobDto, CanvasOp } from '@musecanvas/contracts'
import type { CanvasAgentPendingJob, CanvasAgentStoredMessage } from '../../../../../packages/database/src/index'
import type { LanguageModelChatMessage, LanguageModelChatContentBlock } from '../../../../../packages/providers/src/index'

export function publicMessage(message: CanvasAgentStoredMessage): AgentMessageDto {
  return { id: message.id, seq: message.seq, role: message.role, content: message.content, createdAt: message.createdAt,
    ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}), ...(message.ops?.length ? { ops: message.ops } : {}), ...(message.usage ? { usage: message.usage } : {}) }
}
export function publicPending(pending: CanvasAgentPendingJob): CanvasAgentPendingJobDto {
  // Storage namespaces provider-local IDs by turn for durable generation idempotency;
  // the public call ID still matches assistant/SSE tool_call and tool_result IDs.
  const toolCallId = /^[0-9a-f-]{36}:/.test(pending.toolCallId) ? pending.toolCallId.slice(37) : pending.toolCallId
  return { id: pending.id, toolCallId, kind: pending.kind, prompt: pending.prompt, modelId: pending.modelId, parameters: pending.parameters,
    sourceNodeId: pending.sourceNodeId, sourceAssetId: pending.sourceAssetId, createdAt: pending.createdAt, expiresAt: pending.expiresAt, status: pending.status, jobId: pending.jobId }
}
/** Pending placeholders only add stable nodes/edges. Keep intentional general
 * update/remove/arrange operations intact; dedupe only these recovered identities. */
export function unrecordedPendingOps(recorded: CanvasOp[], pendingOps: CanvasOp[]): CanvasOp[] {
  const key = (op: CanvasOp) => op.type === 'add_node' ? `node:${op.node.id}` : op.type === 'connect' ? `edge:${op.edge.id}` : null
  const seen = new Set(recorded.map(key).filter((id): id is string => id !== null))
  return pendingOps.filter(op => {
    const id = key(op)
    if (!id) return true
    if (seen.has(id)) return false
    seen.add(id); return true
  })
}
export function replayTurnOps(messages: CanvasAgentStoredMessage[], pending: CanvasAgentPendingJob[]): CanvasOp[] {
  const ops = messages.flatMap(message => message.ops ?? [])
  for (const job of pending.filter(job => job.status === 'submitted')) ops.push(...unrecordedPendingOps(ops, job.ops))
  return ops
}
/** Keep recent COMPLETE turns within a byte ceiling. Never slice messages or tool pairs.
 * Incomplete persisted assistant calls already have a paired interrupted result from recordRound. */
export function providerHistory(messages: CanvasAgentStoredMessage[], maxBytes = 100_000, maxTurns = 8): LanguageModelChatMessage[] {
  const groups: CanvasAgentStoredMessage[][] = []
  for (const message of messages) {
    if (!groups.length || groups.at(-1)![0]!.turnId !== message.turnId) groups.push([])
    groups.at(-1)!.push(message)
  }
  const selected: CanvasAgentStoredMessage[][] = []; let size = 0
  for (const group of groups.slice(-maxTurns).reverse()) {
    const bytes = Buffer.byteLength(JSON.stringify(group))
    if (size + bytes > maxBytes) break
    selected.unshift(group); size += bytes
  }
  return selected.flatMap(group => {
    const mapped: LanguageModelChatMessage[] = []; const calls = new Set<string>(); let valid = true
    for (const message of group) {
      if (message.role === 'tool') {
        try {
          const result = JSON.parse(message.content)
          if (!calls.delete(result.toolCallId)) { valid = false; break }
          mapped.push({ role: 'tool', toolCallId: result.toolCallId, content: message.content, isError: !result.success })
        } catch { valid = false; break }
      } else {
        if (calls.size) { valid = false; break }
        if (message.role === 'user') mapped.push({ role: 'user', content: message.content })
        else if (message.content || message.toolCalls?.length) {
          for (const call of message.toolCalls ?? []) calls.add(call.id)
          mapped.push({ role: 'assistant', content: message.content, toolCalls: message.toolCalls ?? [],
            ...(message.contentBlocks?.length ? { contentBlocks: message.contentBlocks as unknown as LanguageModelChatContentBlock[] } : {}) })
        }
      }
    }
    return valid && !calls.size ? mapped : []
  })
}
