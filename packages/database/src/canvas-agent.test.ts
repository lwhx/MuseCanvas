import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type pg from 'pg'
import type { JsonValue } from '@musecanvas/contracts'
import { CANVAS_AGENT_SETTINGS_DEFAULTS, CANVAS_AGENT_DEFAULT_REQUIRE_CONFIRMATION } from '@musecanvas/contracts'
import {
  appendCanvasAgentMessage, beginCanvasAgentJobEventTurn, beginCanvasAgentTurn, canvasAgentPendingIdentity,
  canvasAgentGenerationRequest, canvasAgentGenerationJobMatches, canvasAgentRequestDigest, claimCanvasAgentPendingJob, claimCanvasAgentTurn, completeCanvasAgentPendingJob,
  createCanvasAgentPendingJob, findCanvasAgentPendingByJob, finishCanvasAgentTurn, getCanvasAgentSettings,
  getOrCreateCanvasAgentSession, markCanvasAgentTerminalEvent, readCanvasAgentTurnMessages, readCanvasAgentMessages, readCanvasAgentPendingJobs,
  rejectCanvasAgentPendingJob, releaseCanvasAgentTurn, updateCanvasAgentSettings,
  type CanvasAgentPendingJob, type CanvasAgentSession, type CanvasAgentTurn, type CreateCanvasAgentPendingInput,
} from './repositories/canvas-agent'

const actorId = '10000000-0000-4000-8000-000000000001'
const canvasId = '20000000-0000-4000-8000-000000000001'
const sessionId = '30000000-0000-4000-8000-000000000001'
const messageId = '40000000-0000-4000-8000-000000000001'
const jobId = '50000000-0000-4000-8000-000000000001'
const scope = { actorId, canvasId, sessionId }
const hash = canvasAgentRequestDigest({ kind: 'user', text: 'cat', baseRevision: 1 })
const request = { messageId, requestDigest: hash, timeoutMs: 120000 }
const userMessage = { role: 'user' as const, content: 'cat' }
const raw = (object: object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]))

/** A deliberately small fake, not a PostgreSQL emulator. It asserts critical SQL predicates before
 * applying simplified state transitions. Passing these tests is NOT migration/concurrency evidence. */
class Fake {
  now = Date.parse('2026-10-06T00:00:00Z')
  owner = actorId
  deleted = false
  session: CanvasAgentSession | null = null
  turns = new Map<string, CanvasAgentTurn>()
  messages: Record<string, unknown>[] = []
  pending = new Map<string, CanvasAgentPendingJob>()
  events = new Set<string>()
  jobs = new Map<string, ReturnType<typeof jobFor>>()
  calls: { sql: string; params: unknown[] }[] = []
  client = { query: (sql: string, params: unknown[] = []) => this.query(sql.replace(/\s+/g, ' ').trim(), params) } as unknown as pg.PoolClient
  iso(ms = this.now) { return new Date(ms).toISOString() }
  allowed(params: unknown[]) { return params[0] === this.owner && params[1] === canvasId && !this.deleted && this.session?.createdBy === this.owner && (params.length === 2 || params[2] === sessionId) }
  live(params: unknown[]) { return this.session?.runningTurnId === params[3] && this.session?.runningLeaseToken === params[4] && Date.parse(this.session!.runningLeaseExpiresAt!) > this.now }
  rows(value?: object | object[]) { return { rows: value ? (Array.isArray(value) ? value : [value]) : [] } }
  async query(sql: string, p: unknown[]) {
    this.calls.push({ sql, params: p })
    if (!sql.includes('canvas_agent_settings')) {
      assert.ok(sql.includes('canvas_documents'), sql)
      assert.ok(sql.includes('deleted_at IS NULL'), sql)
      assert.ok(sql.includes('created_by = $1'), sql)
      assert.equal(p[1], canvasId)
    }
    if (sql.startsWith('INSERT INTO canvas_agent_sessions')) {
      assert.ok(sql.includes('ON CONFLICT(canvas_id) DO NOTHING'))
      if (p[0] === this.owner && !this.deleted && !this.session) this.session = {
        id: sessionId, canvasId, createdBy: this.owner, requireConfirmation: true, nextSeq: 1, autoContinuationCount: 0,
        runningTurnId: null, runningLeaseToken: null, runningLeaseExpiresAt: null, createdAt: this.iso(), updatedAt: this.iso(),
      }
      return this.rows()
    }
    if (sql.startsWith('SELECT s.*')) return this.rows(this.allowed(p) ? raw(this.session!) : undefined)
    if (sql.startsWith('SELECT t.*')) return this.rows(this.allowed(p) && this.turns.has(String(p[3])) ? raw(this.turns.get(String(p[3]))!) : undefined)
    if (sql.startsWith('UPDATE canvas_agent_sessions s SET running_turn_id = $4')) {
      assert.ok(sql.includes('s.running_lease_expires_at <= now()'))
      assert.ok(sql.includes('COALESCE($7, s.require_confirmation)'))
      if (!this.allowed(p) || (this.session!.runningTurnId && Date.parse(this.session!.runningLeaseExpiresAt!) > this.now)) return this.rows()
      Object.assign(this.session!, { runningTurnId: p[3], runningLeaseToken: p[4], runningLeaseExpiresAt: this.iso(this.now + Number(p[5])), requireConfirmation: p[6] ?? this.session!.requireConfirmation })
      return this.rows(raw(this.session!))
    }
    if (sql.startsWith('UPDATE canvas_agent_turns t SET status')) {
      assert.ok(sql.includes("t.status = 'running' AND t.lease_expires_at <= now()"))
      for (const turn of this.turns.values()) if (this.allowed(p) && turn.id !== p[3] && turn.status === 'running' && Date.parse(turn.leaseExpiresAt) <= this.now) turn.status = 'expired'
      return this.rows()
    }
    if (sql.startsWith('INSERT INTO canvas_agent_turns')) {
      assert.ok(sql.includes('canvas_agent_turns.request_digest = EXCLUDED.request_digest'))
      if (!this.allowed(p)) return this.rows()
      const turn: CanvasAgentTurn = { id: String(p[3]), sessionId, messageId: String(p[4]), requestDigest: String(p[5]), status: 'running', leaseToken: this.session!.runningLeaseToken!, leaseExpiresAt: this.session!.runningLeaseExpiresAt!, timeoutMs: Number(p[6]), startedAt: this.iso(), completedAt: null, errorCode: null }
      this.turns.set(turn.messageId, turn)
      return this.rows(raw(turn))
    }
    if (sql.startsWith('SELECT m.id')) return this.rows(this.allowed(p) ? this.messages.filter(m => m.id === p[3]) : [])
    if (sql.startsWith('WITH allocated AS')) {
      assert.ok(sql.includes('RETURNING s.id, s.next_seq - 1 AS seq'))
      assert.ok(sql.includes('s.running_lease_token = $5 AND s.running_lease_expires_at > now()'))
      if (!this.allowed(p) || (p[3] && !this.live(p))) return this.rows()
      const msg = { id: p[5], session_id: sessionId, turn_id: p[3], seq: this.session!.nextSeq++, role: p[6], content: p[7], tool_calls: JSON.parse(String(p[8])), content_blocks: JSON.parse(String(p[9])), ops: JSON.parse(String(p[10])), input_tokens: p[11], output_tokens: p[12], created_at: new Date(this.now) }
      this.messages.push(msg)
      return this.rows(msg)
    }
    if (sql.startsWith('WITH released AS')) {
      assert.ok(sql.includes("t.lease_token = $5 AND t.status = 'running'"))
      assert.ok(!sql.includes('s.running_lease_expires_at > now()'))
      if (!this.allowed(p) || this.session?.runningTurnId !== p[3] || this.session?.runningLeaseToken !== p[4]) return this.rows()
      const turn = [...this.turns.values()].find(t => t.id === p[3])!
      turn.status = p[5] as CanvasAgentTurn['status']; turn.errorCode = p[6] as string | null; turn.completedAt = this.iso()
      Object.assign(this.session!, { runningTurnId: null, runningLeaseToken: null, runningLeaseExpiresAt: null })
      return this.rows({ id: turn.id })
    }
    if (sql.startsWith('SELECT m.*')) {
      if (sql.includes('m.turn_id = $4')) return this.rows(this.allowed(p) ? this.messages.filter(m => m.turn_id === p[3] && Number(m.seq) > Number(p[4])).slice(0, Number(p[5])) : [])
      return this.rows(this.allowed(p) ? this.messages.filter(m => Number(m.seq) > Number(p[3])).slice(0, Number(p[4])) : [])
    }
    if (sql.startsWith('SELECT j.*')) {
      assert.ok(sql.includes('j.idempotency_key = p.idempotency_key'))
      const pending = this.pending.get(String(p[3])), job = this.jobs.get(String(p[4]))
      return this.rows(this.allowed(p) && pending && job?.actorId === actorId && job.key === pending.idempotencyKey ? job : undefined)
    }
    if (sql.startsWith('SELECT p.*')) {
      assert.ok(sql.includes('s.canvas_id = p.canvas_id AND s.created_by = p.created_by'))
      if (!this.allowed(p)) return this.rows()
      const list = [...this.pending.values()]
      if (sql.includes('p.job_id = $4')) return this.rows(list.filter(v => v.jobId === p[3] && v.status === 'submitted').map(raw))
      if (sql.includes('p.id = $4')) return this.rows(list.filter(v => v.id === p[3]).map(raw))
      return this.rows(list.sort((a, b) => a.id.localeCompare(b.id)).filter(v => !p[3] || v.id > String(p[3])).slice(0, Number(p[4])).map(raw))
    }
    if (sql.startsWith('INSERT INTO canvas_agent_pending_jobs')) {
      assert.ok(sql.includes('ON CONFLICT(canvas_id, tool_call_id) DO NOTHING'))
      if (!this.allowed(p) || !this.live(p) || this.pending.has(String(p[5]))) return this.rows()
      const value: CanvasAgentPendingJob = { id: String(p[5]), sessionId, canvasId, createdBy: actorId, turnId: String(p[3]), toolCallId: String(p[6]), kind: p[7] as 'image' | 'video', prompt: String(p[8]), modelId: String(p[9]), parameters: JSON.parse(String(p[10])), sourceNodeId: p[11] as string | null, sourceAssetId: p[12] as string | null, baseRevision: Number(p[13]), nodeId: String(p[14]), edgeId: String(p[15]), idempotencyKey: String(p[16]), requestDigest: String(p[17]), expiresAt: String(p[18]), ops: JSON.parse(String(p[19])), modelConfigDigest: String(p[20]), status: 'pending', leaseToken: null, leaseExpiresAt: null, jobId: null, createdAt: this.iso(), updatedAt: this.iso() }
      this.pending.set(value.id, value)
      return this.rows(raw(value))
    }
    if (sql.startsWith('UPDATE canvas_agent_pending_jobs')) {
      assert.ok(sql.includes('p.session_id = s.id AND p.created_by = $1 AND p.canvas_id = $2'))
      if (!this.allowed(p)) return this.rows()
      const value = this.pending.get(String(p[3]))
      if (!value) return this.rows()
      if (sql.includes("SET status = 'expired'")) {
        assert.ok(sql.includes("p.status = 'pending' AND p.expires_at <= now()"))
        if (value.status === 'pending' && Date.parse(value.expiresAt) <= this.now) value.status = 'expired'
        return this.rows()
      }
      if (sql.includes("SET status = 'submitting'")) {
        assert.ok(sql.includes("p.status = 'submitting' AND p.lease_expires_at <= now()"))
        if (!((value.status === 'pending' && Date.parse(value.expiresAt) > this.now) || (value.status === 'submitting' && Date.parse(value.leaseExpiresAt!) <= this.now))) return this.rows()
        value.status = 'submitting'; value.leaseToken = String(p[4]); value.leaseExpiresAt = this.iso(this.now + Number(p[5]))
      } else if (sql.includes("SET status = 'submitted'")) {
        assert.ok(sql.includes('p.lease_token = $5 AND p.lease_expires_at > now()'))
        assert.ok(sql.includes('j.created_by = $1 AND j.idempotency_key = p.idempotency_key'))
        assert.ok(sql.includes('j.media_kind = p.kind AND j.model_id = p.model_id AND j.normalized_request = $8::jsonb'))
        assert.deepEqual(JSON.parse(String(p[7])), canvasAgentGenerationRequest(value))
        const job = this.jobs.get(String(p[5]))
        if (value.status !== 'submitting' || value.leaseToken !== p[4] || Date.parse(value.leaseExpiresAt!) <= this.now || job?.actorId !== actorId || job.key !== value.idempotencyKey || !canvasAgentGenerationJobMatches(value, job)) return this.rows()
        value.status = 'submitted'; value.jobId = String(p[5]); value.ops = JSON.parse(String(p[6])); value.leaseToken = null; value.leaseExpiresAt = null
      } else {
        assert.ok(sql.includes("p.status = 'pending'"))
        if (value.status !== 'pending') return this.rows()
        value.status = Date.parse(value.expiresAt) <= this.now ? 'expired' : 'rejected'
      }
      return this.rows(raw(value))
    }
    if (sql.startsWith('SELECT e.job_id')) return this.rows(this.allowed(p) && this.events.has(String(p[3])) ? { job_id: p[3] } : undefined)
    if (sql.startsWith('WITH marked AS')) {
      assert.ok(sql.includes('ON CONFLICT(session_id, job_id) DO NOTHING'))
      assert.ok(sql.includes('auto_continuation_count = s.auto_continuation_count + 1'))
      if (!this.allowed(p) || !this.live(p) || this.events.has(String(p[5]))) return this.rows()
      this.events.add(String(p[5])); this.session!.autoContinuationCount++
      return this.rows({ auto_continuation_count: this.session!.autoContinuationCount })
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  }
}
async function setup() {
  const fake = new Fake()
  await getOrCreateCanvasAgentSession(fake.client, { actorId, canvasId })
  const claimed = await beginCanvasAgentTurn(fake.client, scope, request, userMessage)
  assert.equal(claimed.status, 'claimed')
  if (claimed.status !== 'claimed') throw new Error('setup')
  return { fake, lease: { turnId: claimed.turn.id, leaseToken: claimed.turn.leaseToken } }
}
function pendingInput(fake: Fake, toolCallId = 'call_cat'): CreateCanvasAgentPendingInput {
  const ids = canvasAgentPendingIdentity(canvasId, toolCallId)
  return { toolCallId, modelConfigDigest: hash, kind: 'image', prompt: 'cat', modelId: '60000000-0000-4000-8000-000000000001', parameters: { aspect: '1:1' }, sourceNodeId: null, sourceAssetId: null, baseRevision: 1, expiresAt: fake.iso(fake.now + 600000), ops: [{ type: 'add_node', node: { id: ids.nodeId, type: 'image', position: { x: 0, y: 0 }, data: { prompt: 'cat' } } }] }
}
async function addPending(fake: Fake, lease: { turnId: string; leaseToken: string }, call = 'call_cat') {
  const result = await createCanvasAgentPendingJob(fake.client, scope, lease, pendingInput(fake, call))
  assert.equal(result.status, 'created')
  if (result.status !== 'created') throw new Error('setup')
  return result.pending
}
function jobFor(pending: CanvasAgentPendingJob, owner = actorId) { return { actorId: owner, key: pending.idempotencyKey, model_id: pending.modelId, media_kind: pending.kind, normalized_request: canvasAgentGenerationRequest(pending) } }
async function submit(fake: Fake, id: string) {
  const claim = await claimCanvasAgentPendingJob(fake.client, scope, id, 1000)
  assert.equal(claim.status, 'claimed')
  if (claim.status !== 'claimed') throw new Error('setup')
  fake.jobs.set(jobId, jobFor(claim.pending))
  const done = await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: id, leaseToken: claim.pending.leaseToken!, jobId })
  assert.equal(done.status, 'completed')
}

test('0031 declares idempotent tables, immutable snapshots, bounds and contract defaults', () => {
  const sql = readFileSync(new URL('../migrations/0031_canvas_agent.sql', import.meta.url), 'utf8')
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length, 6)
  assert.ok(sql.includes('ON CONFLICT DO NOTHING'))
  assert.equal((sql.match(/EXCEPTION WHEN duplicate_object THEN NULL/g) ?? []).length, 2)
  for (const clause of ['UNIQUE(session_id, message_id)', 'UNIQUE(session_id, seq)', 'PRIMARY KEY(session_id, job_id)', 'UNIQUE(canvas_id, tool_call_id)', 'FOREIGN KEY(session_id, canvas_id, created_by)', 'immutable canvas agent pending snapshot', 'immutable canvas agent turn', 'lease_expires_at <= started_at + timeout_ms', 'CHECK((status = \'submitted\') = (job_id IS NOT NULL))']) assert.ok(sql.includes(clause), clause)
  assert.ok(sql.includes("model_config_digest text NOT NULL CHECK(model_config_digest ~ '^[0-9a-f]{64}$')"))
  const d = CANVAS_AGENT_SETTINGS_DEFAULTS
  assert.ok(sql.includes(`enabled boolean NOT NULL DEFAULT ${d.enabled}`))
  assert.ok(sql.includes(`max_tool_calls_per_turn integer NOT NULL DEFAULT ${d.maxToolCallsPerTurn}`))
  assert.ok(sql.includes(`max_jobs_per_turn integer NOT NULL DEFAULT ${d.maxJobsPerTurn}`))
  assert.ok(sql.includes(`timeout_ms integer NOT NULL DEFAULT ${d.timeoutMs}`))
  assert.ok(sql.includes(`max_auto_continuations integer NOT NULL DEFAULT ${d.maxAutoContinuations}`))
  assert.ok(sql.includes(`require_confirmation boolean NOT NULL DEFAULT ${CANVAS_AGENT_DEFAULT_REQUIRE_CONFIRMATION}`))
  for (const bounds of ['BETWEEN 1 AND 32', 'BETWEEN 1 AND 8', 'BETWEEN 1000 AND 300000', 'BETWEEN 0 AND 10']) assert.ok(sql.includes(bounds))
})

test('digest is canonical; pending/node/edge IDs and generation key are stable and globally canvas-namespaced', () => {
  assert.equal(canvasAgentRequestDigest({ b: 2, a: [1, 2] }), canvasAgentRequestDigest({ a: [1, 2], b: 2 }))
  assert.notEqual(canvasAgentRequestDigest([1, 2]), canvasAgentRequestDigest([2, 1]))
  const ids = canvasAgentPendingIdentity(canvasId, 'call:1')
  assert.deepEqual(ids, canvasAgentPendingIdentity(canvasId.toUpperCase(), 'call:1'))
  assert.equal(ids.idempotencyKey, `canvas:${canvasId}:call:1`)
  assert.equal(new Set([ids.id, ids.nodeId, ids.edgeId]).size, 3)
  assert.notEqual(ids.id, canvasAgentPendingIdentity(messageId, 'call:1').id)
  assert.throws(() => canvasAgentPendingIdentity(canvasId, ''))
})

test('session uniqueness, defaults, deleted/current-owner isolation across reads and writes', async () => {
  const { fake, lease } = await setup()
  assert.equal(fake.session!.requireConfirmation, true)
  assert.equal((await getOrCreateCanvasAgentSession(fake.client, { actorId, canvasId }))!.id, sessionId)
  const pending = await addPending(fake, lease)
  const other = { ...scope, actorId: messageId }
  assert.equal(await getOrCreateCanvasAgentSession(fake.client, other), null)
  assert.deepEqual(await claimCanvasAgentTurn(fake.client, other, request), { status: 'not_found' })
  assert.equal(await appendCanvasAgentMessage(fake.client, other, userMessage), null)
  assert.deepEqual(await claimCanvasAgentPendingJob(fake.client, other, pending.id, 1000), { status: 'not_found' })
  assert.deepEqual(await readCanvasAgentMessages(fake.client, other), { messages: [], nextAfterSeq: null })
  assert.deepEqual(await readCanvasAgentPendingJobs(fake.client, other), { pendingJobs: [], nextAfterId: null })
  fake.owner = messageId
  assert.equal(await getOrCreateCanvasAgentSession(fake.client, { actorId, canvasId }), null)
  fake.owner = actorId; fake.deleted = true
  assert.equal(await getOrCreateCanvasAgentSession(fake.client, { actorId, canvasId }), null)
  assert.deepEqual(await rejectCanvasAgentPendingJob(fake.client, scope, pending.id), { status: 'not_found' })
})

test('message append allocates ordered seq, preserves ordered blocks/tools/ops and usage, paginates without gap', async () => {
  const { fake, lease } = await setup()
  const blocks: JsonValue[] = [{ type: 'text', text: 'one' }, { type: 'tool_use', id: 'x' }, { type: 'text', text: 'two' }]
  const toolCalls = [{ id: 'x', name: 'get_canvas', arguments: {} }]
  const appended = await appendCanvasAgentMessage(fake.client, scope, { role: 'assistant', content: 'one two', contentBlocks: blocks, toolCalls, usage: { inputTokens: 12, outputTokens: 3 } }, lease)
  assert.equal(appended!.seq, 2); assert.deepEqual(appended!.contentBlocks, blocks); assert.deepEqual(appended!.toolCalls, toolCalls)
  assert.deepEqual(appended!.usage, { inputTokens: 12, outputTokens: 3 })
  assert.equal(appended!.createdAt, fake.iso())
  assert.equal(await appendCanvasAgentMessage(fake.client, scope, userMessage, { ...lease, leaseToken: messageId }), null)
  assert.equal(fake.session!.nextSeq, 3)
  const page = await readCanvasAgentMessages(fake.client, scope, { limit: 1 })
  assert.equal(page.nextAfterSeq, 1)
  const next = await readCanvasAgentMessages(fake.client, scope, { afterSeq: page.nextAfterSeq!, limit: 1 })
  assert.equal(next.messages[0]!.seq, 2); assert.equal(next.nextAfterSeq, null)
  await assert.rejects(readCanvasAgentMessages(fake.client, scope, { limit: 201 }))
})

test('turn digest replay/conflict, session-wide busy, finish append/release orchestration and confirmation persistence', async () => {
  const { fake, lease } = await setup()
  assert.deepEqual(await beginCanvasAgentTurn(fake.client, scope, request, userMessage), { status: 'busy' })
  assert.deepEqual(await claimCanvasAgentTurn(fake.client, scope, { ...request, requestDigest: 'a'.repeat(64) }), { status: 'conflict' })
  assert.deepEqual(await claimCanvasAgentTurn(fake.client, scope, { ...request, messageId: jobId }), { status: 'busy' })
  assert.equal(await releaseCanvasAgentTurn(fake.client, scope, { ...lease, leaseToken: messageId }, 'failed'), false)
  const finished = await finishCanvasAgentTurn(fake.client, scope, lease, { role: 'assistant', content: 'done' })
  assert.equal(finished!.seq, 2); assert.equal(fake.session!.runningTurnId, null)
  const replay = await beginCanvasAgentTurn(fake.client, scope, { ...request, requireConfirmation: false }, userMessage)
  assert.equal(replay.status, 'replay'); assert.equal(fake.messages.length, 2)
  // requireConfirmation is part of the caller's canonical request digest; on replay it is NOT applied.
  assert.equal(fake.session!.requireConfirmation, true)
  const next = await beginCanvasAgentTurn(fake.client, scope, { ...request, messageId: jobId, requireConfirmation: false }, userMessage)
  assert.equal(next.status, 'claimed'); assert.equal(fake.session!.requireConfirmation, false)
})

test('expired turn reclaims with a new token/deadline, user seq dedupes, stale runner cannot append/release', async () => {
  const { fake, lease } = await setup()
  fake.now += 120001
  const recovered = await beginCanvasAgentTurn(fake.client, scope, request, userMessage)
  assert.equal(recovered.status, 'claimed')
  if (recovered.status !== 'claimed') return
  assert.equal(recovered.turn.id, lease.turnId); assert.notEqual(recovered.turn.leaseToken, lease.leaseToken)
  assert.equal(Date.parse(recovered.turn.leaseExpiresAt) - Date.parse(recovered.turn.startedAt), request.timeoutMs)
  assert.equal(fake.messages.length, 1); assert.equal(fake.session!.nextSeq, 2)
  assert.equal(await appendCanvasAgentMessage(fake.client, scope, userMessage, lease), null)
  assert.equal(await releaseCanvasAgentTurn(fake.client, scope, lease, 'completed'), false)
  await assert.rejects(claimCanvasAgentTurn(fake.client, scope, { ...request, timeoutMs: 300001 }))
  await assert.rejects(claimCanvasAgentTurn(fake.client, scope, { ...request, requestDigest: 'bad' }))
})

test('new turn expires the abandoned old request; terminal failed/expired replay cannot rerun', async () => {
  const { fake } = await setup()
  fake.now += 120001
  const next = await beginCanvasAgentTurn(fake.client, scope, { ...request, messageId: jobId }, userMessage)
  assert.equal(next.status, 'claimed')
  const old = await claimCanvasAgentTurn(fake.client, scope, request)
  assert.equal(old.status, 'replay')
  if (old.status === 'replay') assert.equal(old.turn.status, 'expired')
})

test('pending snapshots replay unchanged but reject changed prompt/model/parameters/source/turn; pagination is bounded', async () => {
  const { fake, lease } = await setup()
  const input = pendingInput(fake)
  await assert.rejects(createCanvasAgentPendingJob(fake.client, scope, lease, { ...input, modelConfigDigest: 'invalid' }))
  const created = await createCanvasAgentPendingJob(fake.client, scope, lease, input)
  assert.equal(created.status, 'created')
  assert.equal((await createCanvasAgentPendingJob(fake.client, scope, lease, input)).status, 'replay')
  for (const patch of [{ prompt: 'dog' }, { modelId: jobId }, { parameters: { aspect: '16:9' } }, { sourceAssetId: jobId }, { baseRevision: 2 }, { modelConfigDigest: 'c'.repeat(64) }]) {
    assert.equal((await createCanvasAgentPendingJob(fake.client, scope, lease, { ...input, ...patch })).status, 'conflict')
  }
  assert.equal((await createCanvasAgentPendingJob(fake.client, scope, { ...lease, turnId: jobId }, input)).status, 'conflict')
  const two = await addPending(fake, lease, 'call_other')
  const page = await readCanvasAgentPendingJobs(fake.client, scope, { limit: 1 })
  assert.ok(page.nextAfterId)
  const next = await readCanvasAgentPendingJobs(fake.client, scope, { afterId: page.nextAfterId!, limit: 1 })
  assert.equal(next.pendingJobs.length, 1); assert.equal(next.nextAfterId, null)
  assert.ok([...fake.pending.keys()].includes(two.id))
})

test('confirm CAS serializes approval vs rejection; submitted replay returns identical persisted job/ops', async () => {
  const { fake, lease } = await setup()
  const pending = await addPending(fake, lease)
  const claimed = await claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000)
  assert.equal(claimed.status, 'claimed')
  if (claimed.status !== 'claimed') return
  assert.equal((await claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000)).status, 'busy')
  assert.equal((await rejectCanvasAgentPendingJob(fake.client, scope, pending.id)).status, 'busy')
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: messageId, jobId })).status, 'conflict')
  fake.jobs.set(jobId, jobFor(pending, messageId))
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: claimed.pending.leaseToken!, jobId })).status, 'conflict')
  fake.jobs.set(jobId, jobFor(pending))
  const complete = await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: claimed.pending.leaseToken!, jobId })
  assert.equal(complete.status, 'completed')
  if (complete.status !== 'completed') return
  const op = complete.pending.ops[0]!
  assert.equal(op.type, 'add_node'); if (op.type === 'add_node') assert.equal('jobId' in op.node.data && op.node.data.jobId, jobId)
  const replay = await claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000)
  assert.equal(replay.status, 'replay'); if (replay.status === 'replay') assert.deepEqual(replay.pending.ops, complete.pending.ops)
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: messageId, jobId })).status, 'replay')
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: messageId, jobId: messageId })).status, 'conflict')
})

test('fake competing confirmations select one lease holder; sequence statements allocate distinct seq', async () => {
  const { fake, lease } = await setup()
  const pending = await addPending(fake, lease)
  const claims = await Promise.all([
    claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000),
    claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000),
  ])
  assert.equal(claims.filter(claim => claim.status === 'claimed').length, 1)
  assert.equal(claims.filter(claim => claim.status === 'busy').length, 1)
  const appended = await Promise.all([
    appendCanvasAgentMessage(fake.client, scope, userMessage, lease),
    appendCanvasAgentMessage(fake.client, scope, userMessage, lease),
  ])
  assert.deepEqual(appended.map(msg => msg!.seq), [2, 3])
  assert.equal(fake.session!.nextSeq, 4)
})

test('pending expiry never reopens/rejects submitting after a create-success/write-crash; recovered claim reuses the same immutable key', async () => {
  const { fake, lease } = await setup()
  const pending = await addPending(fake, lease)
  const first = await claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000)
  assert.equal(first.status, 'claimed')
  if (first.status !== 'claimed') return
  fake.jobs.set(jobId, jobFor(first.pending)) // external create succeeded; no pending write
  fake.now += 600001
  const recovery = await claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000)
  assert.equal(recovery.status, 'claimed')
  if (recovery.status !== 'claimed') return
  assert.notEqual(recovery.pending.leaseToken, first.pending.leaseToken)
  assert.equal(recovery.pending.idempotencyKey, first.pending.idempotencyKey)
  assert.equal(recovery.pending.prompt, first.pending.prompt)
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: first.pending.leaseToken!, jobId })).status, 'conflict')
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: recovery.pending.leaseToken!, jobId })).status, 'completed')
})

test('unclaimed expiration and rejection are final; rejected/expired can never create generation claims', async () => {
  const { fake, lease } = await setup()
  const rejected = await addPending(fake, lease)
  assert.equal((await rejectCanvasAgentPendingJob(fake.client, scope, rejected.id)).status, 'rejected')
  assert.equal((await claimCanvasAgentPendingJob(fake.client, scope, rejected.id, 1000)).status, 'rejected')
  const expired = await addPending(fake, lease, 'expires')
  fake.now += 600001
  assert.equal((await claimCanvasAgentPendingJob(fake.client, scope, expired.id, 1000)).status, 'expired')
  assert.equal((await rejectCanvasAgentPendingJob(fake.client, scope, expired.id)).status, 'expired')
})

test('terminal events bind to submitted session jobs, dedupe atomically, enforce persisted auto budget and lease', async () => {
  const { fake, lease } = await setup()
  const pending = await addPending(fake, lease)
  assert.equal(await findCanvasAgentPendingByJob(fake.client, scope, jobId), null)
  await submit(fake, pending.id)
  assert.equal((await findCanvasAgentPendingByJob(fake.client, scope, jobId))!.id, pending.id)
  assert.equal((await markCanvasAgentTerminalEvent(fake.client, scope, { ...lease, jobId: messageId, maxAutoContinuations: 3 })).status, 'not_found')
  assert.equal((await markCanvasAgentTerminalEvent(fake.client, scope, { ...lease, jobId, maxAutoContinuations: 0 })).status, 'limit')
  assert.equal((await markCanvasAgentTerminalEvent(fake.client, scope, { ...lease, leaseToken: messageId, jobId, maxAutoContinuations: 3 })).status, 'busy')
  assert.equal((await markCanvasAgentTerminalEvent(fake.client, scope, { ...lease, jobId, maxAutoContinuations: 3 })).status, 'marked')
  assert.equal((await markCanvasAgentTerminalEvent(fake.client, scope, { ...lease, jobId, maxAutoContinuations: 3 })).status, 'duplicate')
  assert.equal(fake.session!.autoContinuationCount, 1); assert.equal(fake.events.size, 1)
})

test('job event orchestration claims/appends/counts once; changed replay conflicts; duplicate/limit cause no turn or message', async () => {
  const { fake, lease } = await setup()
  const pending = await addPending(fake, lease)
  await submit(fake, pending.id)
  await finishCanvasAgentTurn(fake.client, scope, lease, { role: 'assistant', content: 'waiting' })
  const eventRequest = { ...request, messageId: jobId, jobId, maxAutoContinuations: 1, requestDigest: canvasAgentRequestDigest({ kind: 'job_event', jobId, baseRevision: 1 }) }
  const event = await beginCanvasAgentJobEventTurn(fake.client, scope, eventRequest, { role: 'user', content: 'server-verified succeeded' })
  assert.equal(event.status, 'claimed'); assert.equal(fake.session!.autoContinuationCount, 1); assert.equal(fake.messages.length, 3)
  assert.equal((await beginCanvasAgentJobEventTurn(fake.client, scope, { ...eventRequest, requestDigest: 'a'.repeat(64) }, userMessage)).status, 'conflict')
  if (event.status !== 'claimed' || !('turn' in event)) return
  await finishCanvasAgentTurn(fake.client, scope, { turnId: event.turn.id, leaseToken: event.turn.leaseToken }, { role: 'assistant', content: 'done' })
  assert.equal((await beginCanvasAgentJobEventTurn(fake.client, scope, eventRequest, userMessage)).status, 'replay')
  assert.equal((await beginCanvasAgentJobEventTurn(fake.client, scope, { ...eventRequest, messageId }, userMessage)).status, 'conflict')
  assert.equal((await beginCanvasAgentJobEventTurn(fake.client, scope, { ...eventRequest, messageId: actorId }, userMessage)).status, 'duplicate')
  assert.equal(fake.messages.length, 4); assert.equal(fake.turns.size, 2)
})

test('settings use singleton, fixed-column patches, FK actor attribution and reject unknown client writes', async () => {
  const calls: { sql: string; params: unknown[] }[] = []
  const row = { singleton: true, ...raw(CANVAS_AGENT_SETTINGS_DEFAULTS), updated_at: new Date('2026-10-06T00:00:00Z') }
  const client = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [row] } } } as unknown as pg.PoolClient
  assert.deepEqual(await getCanvasAgentSettings(client), { singleton: true, ...CANVAS_AGENT_SETTINGS_DEFAULTS, updatedAt: '2026-10-06T00:00:00.000Z' })
  await updateCanvasAgentSettings(client, actorId, { enabled: true, maxAutoContinuations: 2 })
  assert.ok(calls[1]!.sql.includes('WHERE singleton = true'))
  assert.ok(calls[1]!.sql.includes('updated_by = $1'))
  assert.deepEqual(calls[1]!.params, [actorId, true, 2])
  await assert.rejects(updateCanvasAgentSettings(client, actorId, { modelSnapshot: {} } as never))
  await assert.rejects(updateCanvasAgentSettings(client, actorId, { enabled: true, constructor: 'injected' } as never))
  await assert.rejects(updateCanvasAgentSettings(client, actorId, {}))
})

 test('expired owner lease can release; takeover token cannot release new slot', async () => {
   const { fake, lease } = await setup()
   fake.now += 120001
   assert.equal(await releaseCanvasAgentTurn(fake.client, scope, lease, 'expired'), true)
   assert.equal(fake.session!.runningTurnId, null)
   const next = await beginCanvasAgentTurn(fake.client, scope, { ...request, messageId: '40000000-0000-4000-8000-000000000002' }, userMessage)
   assert.equal(next.status, 'claimed')
   assert.equal(await releaseCanvasAgentTurn(fake.client, scope, lease, 'canceled'), false)
   assert.ok(fake.session!.runningTurnId)
 })

 test('pending completion binds actual normalized request, never merely predictable owner/key (image and video)', async () => {
  for (const kind of ['image', 'video'] as const) for (const field of ['model', 'payloadModel', 'prompt', 'parameters', 'source', 'mode', 'kind']) {
    const { fake, lease } = await setup()
    const input = pendingInput(fake)
    if (kind === 'video') {
      input.kind = 'video'; input.sourceNodeId = messageId; input.sourceAssetId = jobId
      input.ops = input.ops.map(op => op.type === 'add_node' ? { ...op, node: { ...op.node, type: 'video', data: { sourceNodeId: messageId } } } : op)
    }
    const made = await createCanvasAgentPendingJob(fake.client, scope, lease, input)
    if (made.status !== 'created') assert.fail('expected pending')
    const claim = await claimCanvasAgentPendingJob(fake.client, scope, made.pending.id, 1000)
    if (claim.status !== 'claimed') assert.fail('expected claim')
    const job = jobFor(claim.pending)
    if (field === 'model') job.model_id = messageId
    if (field === 'payloadModel') job.normalized_request.modelId = messageId
    if (field === 'prompt') job.normalized_request.prompt = 'poisoned'
    if (field === 'parameters') job.normalized_request.parameters = { count: 9 }
    if (field === 'source') job.normalized_request.inputs = [{ assetId: messageId, role: 'first_frame', position: 0 }]
    if (field === 'mode') job.normalized_request.mode = kind === 'image' ? 'image_to_video' : 'text_to_image'
    if (field === 'kind') job.media_kind = kind === 'image' ? 'video' : 'image'
    fake.jobs.set(jobId, job)
    const completed = await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: claim.pending.id, leaseToken: claim.pending.leaseToken!, jobId })
    assert.equal(completed.status, 'conflict'); assert.equal(fake.pending.get(claim.pending.id)!.jobId, null)
    fake.jobs.set(jobId, jobFor(claim.pending))
    assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: claim.pending.id, leaseToken: claim.pending.leaseToken!, jobId })).status, 'completed')
  }
 })
 test('payload equality remains enforced by complete UPDATE if job changes after preliminary read', async () => {
  const { fake, lease } = await setup(), pending = await addPending(fake, lease)
  const claim = await claimCanvasAgentPendingJob(fake.client, scope, pending.id, 1000)
  if (claim.status !== 'claimed') assert.fail('expected claim')
  fake.jobs.set(jobId, jobFor(claim.pending))
  const query = fake.client.query.bind(fake.client)
  fake.client.query = (async (sql: string, args: unknown[]) => {
    if (sql.includes("SET status = 'submitted'")) fake.jobs.get(jobId)!.normalized_request.prompt = 'changed after read'
    return query(sql, args)
  }) as any
  assert.equal((await completeCanvasAgentPendingJob(fake.client, scope, { pendingId: pending.id, leaseToken: claim.pending.leaseToken!, jobId })).status, 'conflict')
  assert.equal(fake.pending.get(pending.id)!.status, 'submitting')
 })
 test('requested-turn message pages retain complete history outside recent provider window', async () => {
  const { fake, lease } = await setup()
  await appendCanvasAgentMessage(fake.client, scope, { role: 'assistant', content: 'first answer' }, lease)
  await finishCanvasAgentTurn(fake.client, scope, lease, { role: 'assistant', content: 'done', usage: { inputTokens: 3, outputTokens: 7 } })
  for (let index = 0; index < 8; index++) {
    const claimed = await beginCanvasAgentTurn(fake.client, scope, { ...request, messageId: `40000000-0000-4000-8000-00000000001${index}` }, userMessage)
    if (claimed.status !== 'claimed') assert.fail('expected turn')
    await finishCanvasAgentTurn(fake.client, scope, { turnId: claimed.turn.id, leaseToken: claimed.turn.leaseToken }, { role: 'assistant', content: 'later answer' })
  }
  let afterSeq = 0; const messages = []
  do { const page = await readCanvasAgentTurnMessages(fake.client, scope, lease.turnId, { afterSeq, limit: 1 }); messages.push(...page.messages); afterSeq = page.nextAfterSeq ?? 0 } while (afterSeq)
  assert.deepEqual(messages.map(message => message.content), ['cat', 'first answer', 'done'])
  assert.deepEqual(messages.at(-1)!.usage, { inputTokens: 3, outputTokens: 7 })
 })
