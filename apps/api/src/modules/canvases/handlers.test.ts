import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import { NextRequest } from 'next/server'
import {
  CANVAS_DEFAULT_TITLE,
  CANVAS_MAX_NODES,
  CANVAS_MAX_SCENE_BYTES,
  type CanvasScene,
} from '@musecanvas/contracts'
import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  listCanvases,
  updateCanvas,
  type CanvasPorts,
  type RouteContext,
} from './handlers'

const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`
const actorId = id(1)
const otherId = id(2)
const canvasId = id(3)
const assetId = id(4)
const jobId = id(5)
const modelId = id(6)
const empty: CanvasScene = { nodes: [], edges: [] }
const mediaScene = (): CanvasScene => ({ nodes: [{ id: id(10), type: 'image', position: { x: 0, y: 0 },
  data: { assetId, jobId, modelId } }], edges: [] })
function context(method: string, input: unknown = {}, options: { actor?: string; id?: string; query?: string; raw?: string } = {}): RouteContext {
  return {
    actor: { id: options.actor ?? actorId, email: 'test@example.invalid', role: 'user', status: 'active', createdAt: '' },
    request: new NextRequest(`http://localhost/api/canvases${options.query ?? ''}`, {
      method, ...(method === 'POST' || method === 'PATCH' ? { body: options.raw ?? JSON.stringify(input),
        headers: { 'content-type': 'application/json' } } : {}),
    }),
    path: 'canvases', params: { id: options.id ?? canvasId },
    json: async () => { throw new Error('Must not use body() malformed-JSON fallback') },
  }
}
interface Row {
  id: string; created_by: string; title: string; revision: number; scene: CanvasScene;
  cover_asset_id: string | null; deleted_at: string | null; created_at: string; updated_at: string;
  cursor_updated_at: string
}
interface Reference { id: string; kind: string; created_by: string; deleted_at: string | null; enabled: boolean }
function harness(options: { existing?: boolean; scene?: CanvasScene; cover?: string | null; deletedRefs?: boolean; owner?: string; deletedCanvas?: boolean; revision?: number; refKind?: string; refOwner?: string; enabled?: boolean; missingCategory?: string } = {}) {
  let row: Row | undefined = options.existing === false ? undefined : {
    id: canvasId, created_by: options.owner ?? actorId, title: 'Canvas', revision: options.revision ?? 1,
    scene: options.scene ?? empty, cover_asset_id: options.cover ?? null,
    deleted_at: options.deletedCanvas ? '2026-10-06' : null,
    created_at: '2026-10-06T12:00:00.000Z', updated_at: '2026-10-06T12:00:00.000Z',
    cursor_updated_at: '2026-10-06T12:00:00.000123Z',
  }
  const calls: { sql: string; params: unknown[] }[] = []
  const budgets: { key: string; max: number; seconds: number }[] = []
  let blockedKey: string | undefined
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] }
    for (const [table, refId] of [['assets', assetId], ['generation_jobs', jobId], ['model_configs', modelId]] as const) {
      if (!sql.includes(`FROM ${table}`)) continue
      const ref: Reference = { id: refId, kind: options.refKind ?? 'image', created_by: options.refOwner ?? actorId,
        deleted_at: options.deletedRefs ? '2026-10-06' : null, enabled: options.enabled ?? true }
      return { rows: options.missingCategory !== table && (params[0] as string[]).includes(ref.id)
        && (table === 'model_configs' || ref.created_by === params[1]) ? [ref] : [] }
    }
    if (sql.includes('INSERT INTO canvas_documents')) {
      row = { id: canvasId, created_by: params[0] as string, title: params[1] as string, revision: 1,
        scene: JSON.parse(params[2] as string), cover_asset_id: params[3] as string | null, deleted_at: null,
        created_at: '2026-10-06T12:00:00.000Z', updated_at: '2026-10-06T12:00:00.000Z',
        cursor_updated_at: '2026-10-06T12:00:00.000123Z' }
      return { rows: [{ ...row }] }
    }
    if (sql.includes('FROM canvas_documents') && sql.includes('ORDER BY updated_at')) {
      assert.match(sql, /created_by = \$1 AND deleted_at IS NULL/)
      return { rows: row && row.created_by === params[0] && row.deleted_at === null ? [{ ...row }] : [] }
    }
    assert.match(sql, /WHERE id = \$1 AND created_by = \$2 AND deleted_at IS NULL/)
    if (!row || row.id !== params[0] || row.created_by !== params[1] || row.deleted_at !== null) return { rows: [] }
    if (sql.includes('SET deleted_at')) {
      row.deleted_at = '2026-10-06'
      return { rows: [{ id: row.id }] }
    }
    if (sql.includes('UPDATE canvas_documents SET title')) {
      assert.equal(row.revision, params[2])
      row = { ...row, title: params[3] as string, scene: JSON.parse(params[4] as string),
        cover_asset_id: params[5] as string | null, revision: row.revision + 1 }
    }
    return { rows: [{ ...row }] }
  }
  const client = { query, release: () => {} } as unknown as pg.PoolClient
  // Real Pool identity selects the repository-owned transaction path; all SQL
  // is stubbed. This is handler/orchestration evidence, NOT real PG/OCC evidence.
  const pool = new pg.Pool()
  pool.connect = async () => client
  pool.query = query as typeof pool.query
  const ports: CanvasPorts = {
    db: () => pool,
    limited: async (key, max, seconds) => { budgets.push({ key, max, seconds }); return key === blockedKey },
  }
  return { ports, calls, budgets, block: (key: string) => { blockedKey = key }, current: () => row }
}
async function response(answer: Response, status: number, code?: string) {
  assert.equal(answer.status, status)
  const value = await answer.json()
  assert.equal(value.success, status < 400)
  if (code) assert.equal(value.error.code, code)
  return value
}

test('create 201/get 200/list 200 use success envelopes, defaults, actor scope and no signed URLs', async () => {
  const h = harness({ existing: false })
  const created = await response(await createCanvas(context('POST'), h.ports), 201)
  assert.equal(created.data.title, CANVAS_DEFAULT_TITLE)
  assert.equal(created.data.revision, 1)
  assert.equal(created.data.coverAssetId, null)
  assert.deepEqual(created.data.scene, empty)
  assert.deepEqual((await response(await getCanvas(context('GET'), h.ports), 200)).data, created.data)
  const page = await response(await listCanvases(context('GET'), h.ports), 200)
  assert.equal(page.data.items.length, 1)
  assert.equal(page.data.nextCursor, null)
  assert.equal('scene' in page.data.items[0], false)
  assert.equal(h.calls.find(call => call.sql.includes('ORDER BY updated_at'))?.params[1], 21)
  assert.equal(JSON.stringify(created).includes('Url'), false)
  assert.deepEqual(h.calls.slice(0, 3).map(call => call.sql.split(' ')[0]), ['BEGIN', 'INSERT', 'COMMIT'])
})

test('create accepts normalized title, owned active refs and image cover in one short transaction', async () => {
  const h = harness({ existing: false })
  const value = await response(await createCanvas(context('POST', { title: '  New  ', scene: mediaScene(), coverAssetId: assetId }), h.ports), 201)
  assert.equal(value.data.title, 'New')
  assert.equal(value.data.coverAssetId, assetId)
  assert.deepEqual(h.calls.map(call => call.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'INSERT', 'COMMIT'])
  assert.ok(h.calls.slice(1, 4).every(call => !/FOR (SHARE|UPDATE|KEY SHARE)/.test(call.sql)), 'references may become deleted placeholders without cross-table locks')
})

test('unknown bodies, malformed JSON, null arrays, URLs and no-op patches fail 400 without SQL', async () => {
  for (const input of [null, [], 4, 'text', { extra: true }, { scene: null }, { scene: { nodes: null, edges: [] } },
    { scene: { nodes: [], edges: null } }, { coverAssetId: 'https://example.invalid/image.png' }]) {
    const h = harness()
    await response(await createCanvas(context('POST', input), h.ports), 400, 'INVALID_INPUT')
    assert.equal(h.calls.length, 0)
  }
  for (const method of ['POST', 'PATCH']) {
    const h = harness()
    await response(await (method === 'POST' ? createCanvas : updateCanvas)(context(method, {}, { raw: '{' }), h.ports), 400, 'INVALID_INPUT')
    assert.equal(h.calls.length, 0)
  }
  for (const input of [null, [], {}, { baseRevision: 1 }, { baseRevision: 0, title: 'x' },
    { baseRevision: 1, title: null }, { baseRevision: 1, scene: null }, { baseRevision: 1, coverAssetId: [] }]) {
    const h = harness()
    await response(await updateCanvas(context('PATCH', input), h.ports), 400, 'INVALID_INPUT')
    assert.equal(h.calls.length, 0)
  }
})

test('frozen scene quotas return contract codes with 400 and no SQL', async () => {
  const tooMany = { nodes: Array.from({ length: CANVAS_MAX_NODES + 1 }, (_, i) => ({ id: id(i + 100), type: 'note', position: { x: 0, y: 0 }, data: { text: '' } })), edges: [] }
  const tooLarge = { nodes: Array.from({ length: Math.ceil(CANVAS_MAX_SCENE_BYTES / 16_000) }, (_, i) => ({ id: id(i + 100), type: 'note', position: { x: 0, y: 0 }, data: { text: 'x'.repeat(16_000) } })), edges: [] }
  for (const [scene, code] of [[tooMany, 'CANVAS_NODE_LIMIT_EXCEEDED'], [tooLarge, 'CANVAS_SCENE_TOO_LARGE']] as const) {
    const h = harness()
    await response(await createCanvas(context('POST', { scene }), h.ports), 400, code)
    assert.equal(h.calls.length, 0)
  }
})

test('detail mutation IDs reject malformed UUIDs before SQL/rate limiting', async () => {
  for (const handler of [getCanvas, updateCanvas, deleteCanvas]) {
    for (const badId of ['', 'not-a-uuid', `${canvasId}'`]) {
      const h = harness()
      await response(await handler(context('PATCH', { baseRevision: 1, title: 'New' }, { id: badId }), h.ports), 400, 'INVALID_INPUT')
      assert.equal(h.calls.length, 0)
      assert.equal(h.budgets.length, 0)
    }
  }
})

test('pagination defaults to 20, accepts 100, rejects bad limits/duplicate params/malformed cursors', async () => {
  const h = harness()
  await response(await listCanvases(context('GET', {}, { query: '?limit=100' }), h.ports), 200)
  assert.equal(h.calls[0]?.params[1], 101)
  for (const query of ['?limit=', '?limit=0', '?limit=-1', '?limit=101', '?limit=1.5', '?limit=wat', '?limit=1&limit=2',
    '?cursor=', '?cursor=!', '?cursor=abcd=', '?cursor=e30', '?cursor=a&cursor=b']) {
    const invalid = harness()
    await response(await listCanvases(context('GET', {}, { query }), invalid.ports), 400, 'INVALID_INPUT')
    assert.equal(invalid.calls.length, 0)
  }
})

test('absent, foreign and soft-deleted documents all return owner-only 404 for get/patch/delete', async () => {
  for (const options of [{ existing: false }, { owner: otherId }, { deletedCanvas: true }]) {
    for (const handler of [getCanvas, updateCanvas, deleteCanvas]) {
      const h = harness(options)
      await response(await handler(context('PATCH', { baseRevision: 1, title: 'New' }), h.ports), 404, 'CANVAS_NOT_FOUND')
    }
  }
  const h = harness()
  await response(await getCanvas(context('GET', {}, { actor: otherId }), h.ports), 404, 'CANVAS_NOT_FOUND')
  const page = await response(await listCanvases(context('GET', {}, { actor: otherId }), h.ports), 200)
  assert.deepEqual(page.data.items, [])
})

test('patch 200 increments revision; stale patch returns 409 before reference queries; delete 200 then 404', async () => {
  const h = harness()
  const updated = await response(await updateCanvas(context('PATCH', { baseRevision: 1, title: 'Renamed' }), h.ports), 200)
  assert.equal(updated.data.revision, 2)
  assert.equal(updated.data.title, 'Renamed')
  assert.deepEqual(updated.data.scene, empty)
  const before = h.calls.length
  await response(await updateCanvas(context('PATCH', { baseRevision: 1, scene: mediaScene() }), h.ports), 409, 'CANVAS_REVISION_CONFLICT')
  assert.deepEqual(h.calls.slice(before).map(call => call.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'COMMIT'])
  assert.equal(h.current()?.title, 'Renamed')
  assert.deepEqual((await response(await deleteCanvas(context('DELETE'), h.ports), 200)).data, { id: canvasId })
  await response(await deleteCanvas(context('DELETE'), h.ports), 404, 'CANVAS_NOT_FOUND')
})

test('retained owned deleted refs and disabled models survive rename/scene save; cover can explicitly become null', async () => {
  const h = harness({ scene: mediaScene(), cover: assetId, deletedRefs: true, enabled: false })
  await response(await updateCanvas(context('PATCH', { baseRevision: 1, title: 'Renamed' }), h.ports), 200)
  assert.equal(h.current()?.cover_asset_id, assetId)
  const updated = await response(await updateCanvas(context('PATCH', { baseRevision: 2, scene: mediaScene(), coverAssetId: null }), h.ports), 200)
  assert.equal(updated.data.coverAssetId, null)
  assert.deepEqual(updated.data.scene, mediaScene())
})

test('new foreign/missing/deleted/type-mismatched refs and disabled models are generic 400, never written', async () => {
  for (const options of [{ refOwner: otherId }, { deletedRefs: true }, { refKind: 'video' }, { refKind: 'language' },
    { enabled: false }, { missingCategory: 'assets' }, { missingCategory: 'generation_jobs' }, { missingCategory: 'model_configs' }]) {
    for (const handler of [createCanvas, updateCanvas]) {
      const h = harness(options)
      const input = { scene: mediaScene(), ...(handler === updateCanvas ? { baseRevision: 1 } : {}) }
      await response(await handler(context(handler === createCanvas ? 'POST' : 'PATCH', input), h.ports), 400, 'INVALID_INPUT')
      assert.equal(h.calls.some(call => call.sql.startsWith('INSERT') || call.sql.startsWith('UPDATE')), false)
    }
  }
  const foreignRetained = harness({ scene: mediaScene(), refOwner: otherId })
  await response(await updateCanvas(context('PATCH', { baseRevision: 1, title: 'Rename' }), foreignRetained.ports), 400, 'INVALID_INPUT')
  for (const options of [{ refOwner: otherId }, { refKind: 'video' }, { deletedRefs: true }]) {
    const h = harness(options)
    await response(await updateCanvas(context('PATCH', { baseRevision: 1, coverAssetId: assetId }), h.ports), 400, 'INVALID_INPUT')
  }
})

test('retained deleted IDs do not authorize any newly introduced foreign reference', async () => {
  const h = harness({ scene: mediaScene(), deletedRefs: true })
  const next = mediaScene()
  next.nodes.push({ id: id(11), type: 'image', position: { x: 1, y: 1 }, data: { assetId: id(99) } })
  await response(await updateCanvas(context('PATCH', { baseRevision: 1, scene: next }), h.ports), 400, 'INVALID_INPUT')
  assert.equal(h.current()?.revision, 1)
})

test('mutations use per-actor 60/min and creates 20/min; 429 is enveloped and never reads/writes SQL', async () => {
  for (const handler of [createCanvas, updateCanvas, deleteCanvas]) {
    const h = harness()
    h.block(`canvas:mutate:${actorId}`)
    await response(await handler(context('PATCH', { baseRevision: 1, title: 'New' }), h.ports), 429, 'RATE_LIMITED')
    assert.deepEqual(h.budgets, [{ key: `canvas:mutate:${actorId}`, max: 60, seconds: 60 }])
    assert.equal(h.calls.length, 0)
  }
  const h = harness({ existing: false })
  h.block(`canvas:create:${actorId}`)
  await response(await createCanvas(context('POST'), h.ports), 429, 'RATE_LIMITED')
  assert.deepEqual(h.budgets, [{ key: `canvas:mutate:${actorId}`, max: 60, seconds: 60 }, { key: `canvas:create:${actorId}`, max: 20, seconds: 60 }])
  assert.equal(h.calls.length, 0)
  await response(await createCanvas(context('POST', {}, { actor: otherId }), h.ports), 201)
  assert.deepEqual(h.budgets.at(-1), { key: `canvas:create:${otherId}`, max: 20, seconds: 60 })
})
