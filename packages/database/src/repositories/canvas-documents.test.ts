import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'
import type { CanvasScene } from '@musecanvas/contracts'
import {
  CanvasReferenceError,
  createCanvasDocument,
  deleteCanvasDocument,
  findCanvasForActor,
  listCanvasDocuments,
  updateCanvasDocument,
  validateCanvasReferences,
} from './canvas-documents'

const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`
const actor = id(1)
const other = id(2)
const canvasId = id(3)
const assetId = id(4)
const jobId = id(5)
const modelId = id(6)
const empty: CanvasScene = { nodes: [], edges: [] }
const scene = (kind: 'image' | 'video' = 'image'): CanvasScene => ({ nodes: [
  { id: id(10), type: kind, position: { x: 0, y: 0 }, data: { assetId, jobId, modelId } },
  { id: id(11), type: kind, position: { x: 1, y: 1 }, data: { assetId, jobId, modelId } },
], edges: [] })
const row = (overrides = {}) => ({ id: canvasId, created_by: actor, title: 'Canvas', revision: 1,
  scene: empty, cover_asset_id: null, deleted_at: null,
  created_at: new Date('2026-10-06T12:00:00.000Z'), updated_at: new Date('2026-10-06T12:00:00.000Z'),
  cursor_updated_at: '2026-10-06T12:00:00.000123Z', ...overrides })
interface Query { sql: string; params: unknown[] }
function mock(answer: (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>) {
  const calls: Query[] = []
  const client = { query: async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    return { rows: await answer(sql, params) }
  } } as unknown as pg.PoolClient
  return { client, calls }
}
function refRows(sql: string, deleted = false, enabled = true) {
  const kind = 'image'
  return [{ id: sql.includes('FROM assets') ? assetId : sql.includes('FROM generation_jobs') ? jobId : modelId,
    kind, deleted_at: deleted ? new Date() : null, enabled }]
}

test('canvas migration declares idempotent table, owner/cover FKs, positive revision and tuple index', async () => {
  const sql = await readFile(new URL('../../migrations/0030_canvas_documents.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canvas_documents/)
  assert.match(sql, /created_by uuid NOT NULL REFERENCES users\(id\)/)
  assert.match(sql, /cover_asset_id uuid REFERENCES assets\(id\)/)
  assert.match(sql, /revision integer NOT NULL DEFAULT 1 CHECK \(revision > 0\)/)
  assert.match(sql, /scene jsonb NOT NULL DEFAULT '\{"nodes":\[\],"edges":\[\]\}'::jsonb/)
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[\s\S]+\(created_by, updated_at DESC, id DESC\)[\s\S]+WHERE deleted_at IS NULL/)
})

test('find/create return contract-compatible documents with ISO time strings and scoped SQL', async () => {
  const { client, calls } = mock((sql, params) => {
    if (sql.includes('INSERT INTO canvas_documents')) {
      assert.deepEqual(params, [actor, 'Canvas', JSON.stringify(empty), null])
      return [row()]
    }
    assert.match(sql, /WHERE id = \$1 AND created_by = \$2 AND deleted_at IS NULL/)
    return params[1] === actor ? [row()] : []
  })
  const created = await createCanvasDocument(client, actor, { title: 'Canvas', scene: empty, coverAssetId: null })
  assert.equal(created.createdAt, '2026-10-06T12:00:00.000Z')
  assert.equal(created.updatedAt, '2026-10-06T12:00:00.000Z')
  assert.equal(created.revision, 1)
  assert.deepEqual(Object.keys(created).sort(), ['coverAssetId', 'createdAt', 'id', 'revision', 'scene', 'title', 'updatedAt'])
  assert.deepEqual(await findCanvasForActor(client, actor, canvasId), created)
  assert.equal(await findCanvasForActor(client, other, canvasId), null)
  assert.equal(calls.some(call => call.sql === 'BEGIN'), false, 'caller-owned client must not start nested transaction')
})

test('list uses owner tuple cursor, preserves microseconds and omits scene from DTO', async () => {
  const { client, calls } = mock(() => [row(), row({ id: id(20) }), row({ id: id(21) })])
  const page = await listCanvasDocuments(client, actor, { limit: 2 })
  assert.equal(page.items.length, 2)
  assert.equal('scene' in page.items[0]!, false)
  assert.ok(page.nextCursor)
  const cursor = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8'))
  assert.deepEqual(cursor, { updatedAt: '2026-10-06T12:00:00.000123Z', id: id(20) })
  await listCanvasDocuments(client, actor, { limit: 2, cursor: page.nextCursor })
  assert.match(calls[1]!.sql, /created_by = \$1 AND deleted_at IS NULL AND \(updated_at, id\) < \(\$3::timestamptz, \$4::uuid\)/)
  assert.match(calls[1]!.sql, /ORDER BY updated_at DESC, id DESC LIMIT \$2/)
  assert.deepEqual(calls[1]!.params, [actor, 3, cursor.updatedAt, cursor.id])
  const end = mock(() => [row()])
  assert.equal((await listCanvasDocuments(end.client, actor, { limit: 2 })).nextCursor, null)
})

test('list rejects malformed/noncanonical cursor and invalid limits before SQL', async () => {
  const { client, calls } = mock(() => { throw new Error('must not query') })
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  for (const cursor of ['', '!', 'a'.repeat(513), 'abcd=', encode(null), encode([]), encode({}),
    encode({ updatedAt: 'bad', id: canvasId }), encode({ updatedAt: '2026-02-30T00:00:00.000000Z', id: canvasId }),
    encode({ updatedAt: '2026-10-06T00:00:00.000000Z', id: 'not-uuid' }),
    encode({ updatedAt: '2026-10-06T00:00:00.000000Z', id: canvasId, extra: true }),
    encode({ updatedAt: '2026-10-06T00:00:00.000Z', id: canvasId }),
  ]) await assert.rejects(listCanvasDocuments(client, actor, { limit: 10, cursor }), /INVALID_INPUT/)
  for (const limit of [0, -1, 101, 1.5, NaN]) await assert.rejects(listCanvasDocuments(client, actor, { limit }), /INVALID_INPUT/)
  assert.equal(calls.length, 0)
})

test('update checks locked owner row/revision before reference errors; missing/foreign/deleted are 404', async () => {
  for (const existing of [undefined, row({ created_by: other }), row({ deleted_at: new Date() }), row({ revision: 2 })]) {
    const { client, calls } = mock((sql, params) => {
      assert.match(sql, /WHERE id = \$1 AND created_by = \$2 AND deleted_at IS NULL FOR UPDATE/)
      assert.deepEqual(params, [canvasId, actor])
      return existing && existing.created_by === actor && existing.deleted_at === null ? [existing] : []
    })
    const result = await updateCanvasDocument(client, actor, canvasId, { baseRevision: 1, scene: scene() })
    assert.deepEqual(result, existing?.revision === 2
      ? { status: 'conflict', code: 'CANVAS_REVISION_CONFLICT' } : { status: 'not_found', code: 'CANVAS_NOT_FOUND' })
    assert.equal(calls.length, 1, 'no reference SQL on 404/409')
  }
})

test('update increments revision with owner/nondeleted/revision SQL guard and preserves omitted fields', async () => {
  const { client, calls } = mock((sql, params) => {
    if (sql.includes('FOR UPDATE')) return [row()]
    assert.match(sql, /revision = revision \+ 1, updated_at = now\(\)/)
    assert.match(sql, /WHERE id = \$1 AND created_by = \$2 AND deleted_at IS NULL AND revision = \$3 RETURNING \*/)
    assert.deepEqual(params, [canvasId, actor, 1, 'Renamed', JSON.stringify(empty), null])
    return [row({ title: 'Renamed', revision: 2 })]
  })
  const result = await updateCanvasDocument(client, actor, canvasId, { baseRevision: 1, title: 'Renamed' })
  assert.equal(result.status, 'updated')
  if (result.status === 'updated') assert.equal(result.document.revision, 2)
  assert.equal(calls.length, 2)
})

test('update retains deleted placeholders on rename and allows explicitly clearing cover', async () => {
  for (const clearCover of [false, true]) {
    const input = { scene: scene(), coverAssetId: assetId }
    const { client, calls } = mock((sql, params) => {
      if (sql.includes('FOR UPDATE')) return [row({ scene: input.scene, cover_asset_id: assetId })]
      if (sql.includes('UPDATE canvas_documents SET')) {
        assert.equal(params[5], clearCover ? null : assetId)
        return [row({ scene: input.scene, cover_asset_id: clearCover ? null : assetId, revision: 2 })]
      }
      return refRows(sql, true, false)
    })
    const result = await updateCanvasDocument(client, actor, canvasId,
      { baseRevision: 1, title: 'Title', ...(clearCover ? { coverAssetId: null } : {}) })
    assert.equal(result.status, 'updated')
    assert.match(calls[0]!.sql, /FOR UPDATE$/)
    assert.match(calls.at(-1)!.sql, /UPDATE canvas_documents SET/)
  }
})

test('update guard miss classifies only through owner-scoped live lookup', async () => {
  for (const live of [true, false]) {
    const { client, calls } = mock(sql => sql.includes('FOR UPDATE') ? [row()]
      : sql.startsWith('UPDATE') ? [] : live ? [row({ revision: 2 })] : [])
    const result = await updateCanvasDocument(client, actor, canvasId, { baseRevision: 1, title: 'Title' })
    assert.equal(result.status, live ? 'conflict' : 'not_found')
    assert.match(calls[2]!.sql, /WHERE id = \$1 AND created_by = \$2 AND deleted_at IS NULL/)
  }
})

test('delete is scoped, soft only and cannot resurrect/redelete records', async () => {
  let deleted = false
  const { client } = mock((sql, params) => {
    assert.match(sql, /SET deleted_at = now\(\), updated_at = now\(\)/)
    assert.match(sql, /WHERE id = \$1 AND created_by = \$2 AND deleted_at IS NULL RETURNING id/)
    if (params[1] !== actor || deleted) return []
    deleted = true
    return [{ id: canvasId }]
  })
  assert.equal(await deleteCanvasDocument(client, other, canvasId), false)
  assert.equal(await deleteCanvasDocument(client, actor, canvasId), true)
  assert.equal(await deleteCanvasDocument(client, actor, canvasId), false)
})

test('reference batches deduplicate and scope assets/jobs without inverse-order row locks', async () => {
  const { client, calls } = mock(sql => refRows(sql))
  assert.deepEqual(await validateCanvasReferences(client, actor, { scene: scene(), coverAssetId: assetId }), { valid: true })
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.match(call.sql, /id = ANY\(\$1::uuid\[\]\)/)
    assert.match(call.sql, /ORDER BY id/)
    assert.doesNotMatch(call.sql, /FOR (SHARE|UPDATE|KEY SHARE)/, 'reference deletion after validation becomes a placeholder')
    assert.equal((call.params[0] as string[]).length, 1)
    if (!call.sql.includes('FROM model_configs')) {
      assert.match(call.sql, /AND created_by = \$2/)
      assert.equal(call.params[1], actor)
    } else assert.equal(call.params.length, 1)
  }
})

test('retained owner refs including cover allow softdelete/disabled model; new deleted refs reject', async () => {
  const input = { scene: scene(), coverAssetId: assetId }
  const { client } = mock(sql => refRows(sql, true, false))
  assert.deepEqual(await validateCanvasReferences(client, actor, input, input), { valid: true })
  assert.deepEqual(await validateCanvasReferences(client, actor, input), { valid: false, code: 'INVALID_INPUT' })
  const modelsOnly: CanvasScene = { nodes: [{ id: id(10), type: 'prompt', position: { x: 0, y: 0 }, data: { prompt: '', modelId } }], edges: [] }
  const disabled = mock(sql => refRows(sql, false, false))
  assert.equal((await validateCanvasReferences(disabled.client, actor, { scene: modelsOnly, coverAssetId: null })).valid, false)
  assert.equal((await validateCanvasReferences(disabled.client, actor, { scene: modelsOnly, coverAssetId: null },
    { scene: modelsOnly, coverAssetId: null })).valid, true)
})

test('missing/foreign/type mismatched refs return generic error, even if previously retained', async () => {
  for (const category of ['assets', 'generation_jobs', 'model_configs']) {
    for (const mode of ['missing', 'mismatch', 'deleted']) {
      const { client } = mock(sql => {
        if (!sql.includes(`FROM ${category}`)) return refRows(sql)
        if (mode === 'missing') return [] // SQL owner scope excludes foreign rows too.
        return refRows(sql, mode === 'deleted').map(ref => ({ ...ref, kind: mode === 'mismatch' ? 'video' : ref.kind }))
      })
      const input = { scene: scene(), coverAssetId: null }
      assert.deepEqual(await validateCanvasReferences(client, actor, input), { valid: false, code: 'INVALID_INPUT' })
      if (mode !== 'deleted') assert.equal((await validateCanvasReferences(client, actor, input, input)).valid, false)
    }
  }
})

test('cover is image-only; new prompt model allows image/video but never language', async () => {
  const cover = mock(() => [{ id: assetId, kind: 'video', deleted_at: null }])
  assert.equal((await validateCanvasReferences(cover.client, actor, { scene: empty, coverAssetId: assetId })).valid, false)
  for (const kind of ['image', 'video', 'language']) {
    const { client } = mock(() => [{ id: modelId, kind, deleted_at: null, enabled: true }])
    const prompt: CanvasScene = { nodes: [{ id: id(10), type: 'prompt', position: { x: 0, y: 0 }, data: { prompt: '', modelId } }], edges: [] }
    assert.equal((await validateCanvasReferences(client, actor, { scene: prompt, coverAssetId: null })).valid, kind !== 'language')
  }
  const incompatible = mock(sql => refRows(sql))
  assert.equal((await validateCanvasReferences(incompatible.client, actor, { scene: scene('video'), coverAssetId: null })).valid, false)
})

test('foreign/missing cover is generic invalid input; retained refs cannot grandfather a new deleted ID', async () => {
  const absent = mock(() => [])
  assert.deepEqual(await validateCanvasReferences(absent.client, actor, { scene: empty, coverAssetId: assetId }),
    { valid: false, code: 'INVALID_INPUT' })
  const deleted = mock(sql => refRows(sql, true, false))
  const previous = { scene: { nodes: [], edges: [] }, coverAssetId: id(99) }
  assert.equal((await validateCanvasReferences(deleted.client, actor, { scene: empty, coverAssetId: assetId }, previous)).valid, false)
})

test('create throws generic reference error and update returns invalid_reference without writes', async () => {
  const { client, calls } = mock(sql => sql.includes('FOR UPDATE') ? [row()] : [])
  await assert.rejects(createCanvasDocument(client, actor, { title: 'Title', scene: scene(), coverAssetId: null }), CanvasReferenceError)
  assert.deepEqual(await updateCanvasDocument(client, actor, canvasId, { baseRevision: 1, scene: scene() }),
    { status: 'invalid_reference', code: 'INVALID_INPUT' })
  assert.equal(calls.some(call => /INSERT|UPDATE canvas_documents SET/.test(call.sql)), false)
})

test('Pool write entrypoint owns BEGIN/COMMIT or ROLLBACK and releases; client never nests', async () => {
  // Real Pool instance selects the documented Pool path, but connect is replaced:
  // this tests orchestration only, not PostgreSQL transactions or concurrency.
  for (const fail of [false, true]) {
    const { client, calls } = mock(sql => {
      if (sql.includes('INSERT')) {
        if (fail) throw new Error('write failure')
        return [row()]
      }
      return []
    })
    let released = 0
    client.release = () => { released++ }
    const pool = new pg.Pool()
    pool.connect = async () => client
    const operation = createCanvasDocument(pool, actor, { title: 'Canvas', scene: empty, coverAssetId: null })
    if (fail) await assert.rejects(operation, /write failure/)
    else await operation
    assert.equal(calls[0]!.sql, 'BEGIN')
    assert.equal(calls.at(-1)!.sql, fail ? 'ROLLBACK' : 'COMMIT')
    assert.equal(released, 1)
    await pool.end()
  }
})
