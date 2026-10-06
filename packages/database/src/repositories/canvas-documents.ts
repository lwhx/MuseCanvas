import pg from 'pg'
import {
  CanvasErrorCode,
  isCanvasUuid,
  type CanvasDto,
  type CanvasListItemDto,
  type CanvasListPageDto,
  type CanvasScene,
  type ParsedCreateCanvasRequest,
  type UpdateCanvasRequest,
} from '@musecanvas/contracts'

export type CanvasDocument = CanvasDto
export interface CanvasReferenceInput { scene: CanvasScene; coverAssetId: string | null }
export type CanvasReferenceValidationResult =
  | { valid: true }
  | { valid: false; code: typeof CanvasErrorCode.INVALID_INPUT }
export type CanvasUpdateResult =
  | { status: 'updated'; document: CanvasDocument }
  | { status: 'not_found'; code: typeof CanvasErrorCode.CANVAS_NOT_FOUND }
  | { status: 'conflict'; code: typeof CanvasErrorCode.CANVAS_REVISION_CONFLICT }
  | { status: 'invalid_reference'; code: typeof CanvasErrorCode.INVALID_INPUT }

export class CanvasReferenceError extends Error {
  readonly code = CanvasErrorCode.INVALID_INPUT
  constructor() { super('Invalid canvas reference') }
}

interface CanvasRow {
  id: string
  title: string
  revision: number
  scene: CanvasScene
  cover_asset_id: string | null
  created_at: Date | string
  updated_at: Date | string
  cursor_updated_at?: string
}
function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
function listItem(row: CanvasRow): CanvasListItemDto {
  return { id: row.id, title: row.title, revision: row.revision,
    coverAssetId: row.cover_asset_id, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) }
}
function document(row: CanvasRow): CanvasDocument { return { ...listItem(row), scene: row.scene } }

/** Pool writes acquire their own short transaction. PoolClient writes MUST be
 * called inside an existing transaction; no nested BEGIN/COMMIT is issued.
 * Keep network/provider calls outside this transaction. */
async function writeTransaction<T>(client: pg.Pool | pg.PoolClient, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!(client instanceof pg.Pool)) return fn(client)
  const connection = await client.connect()
  try {
    await connection.query('BEGIN')
    const value = await fn(connection)
    await connection.query('COMMIT')
    return value
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally { connection.release() }
}

export async function findCanvasForActor(client: pg.Pool | pg.PoolClient, actorId: string, canvasId: string): Promise<CanvasDocument | null> {
  const res = await client.query(
    `SELECT * FROM canvas_documents WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL`,
    [canvasId, actorId],
  )
  return res.rows[0] ? document(res.rows[0] as CanvasRow) : null
}

interface Cursor { updatedAt: string; id: string }
function invalidCursor(): never { throw new Error(CanvasErrorCode.INVALID_INPUT) }
function decodeCursor(value: string): Cursor {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidCursor()
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value) invalidCursor()
  let cursor: unknown
  try { cursor = JSON.parse(bytes.toString('utf8')) } catch { invalidCursor() }
  if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) invalidCursor()
  const fields = cursor as Record<string, unknown>
  if (Object.keys(fields).sort().join(',') !== 'id,updatedAt' || !isCanvasUuid(fields.id)
    || typeof fields.updatedAt !== 'string') invalidCursor()
  // Preserve PG microseconds for tuple pagination (pg's Date parser loses them).
  const time = fields.updatedAt as string
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(time) || time.startsWith('0000')) invalidCursor()
  const date = new Date(time)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== `${time.slice(0, 23)}Z`) invalidCursor()
  return { updatedAt: time, id: (fields.id as string).toLowerCase() }
}

export async function listCanvasDocuments(
  client: pg.Pool | pg.PoolClient, actorId: string, options: { limit: number; cursor?: string },
): Promise<CanvasListPageDto> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error(CanvasErrorCode.INVALID_INPUT)
  const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor)
  const res = await client.query(
    `SELECT id, title, revision, cover_asset_id, created_at, updated_at,
       to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
     FROM canvas_documents
     WHERE created_by = $1 AND deleted_at IS NULL
       ${cursor ? 'AND (updated_at, id) < ($3::timestamptz, $4::uuid)' : ''}
     ORDER BY updated_at DESC, id DESC LIMIT $2`,
    cursor ? [actorId, options.limit + 1, cursor.updatedAt, cursor.id] : [actorId, options.limit + 1],
  )
  const rows = res.rows as CanvasRow[]
  const items = rows.slice(0, options.limit)
  const last = items.at(-1)
  return { items: items.map(listItem), nextCursor: rows.length > options.limit && last
    ? Buffer.from(JSON.stringify({ updatedAt: last.cursor_updated_at!, id: last.id })).toString('base64url') : null }
}

type MediaKind = 'image' | 'video'
type ExpectedKind = MediaKind | 'media'
interface References {
  assets: Map<string, Set<ExpectedKind>>
  jobs: Map<string, Set<ExpectedKind>>
  models: Map<string, Set<ExpectedKind>>
}
function references(input: CanvasReferenceInput): References {
  const refs: References = { assets: new Map(), jobs: new Map(), models: new Map() }
  const add = (map: Map<string, Set<ExpectedKind>>, id: string | undefined | null, kind: ExpectedKind) => {
    if (id) { const kinds = map.get(id) ?? new Set<ExpectedKind>(); kinds.add(kind); map.set(id, kinds) }
  }
  add(refs.assets, input.coverAssetId, 'image')
  for (const node of input.scene.nodes) {
    if (node.type === 'note') continue
    add(refs.models, node.data.modelId, node.type === 'prompt' ? 'media' : node.type)
    if (node.type === 'image' || node.type === 'video') {
      add(refs.assets, node.data.assetId, node.type)
      add(refs.jobs, node.data.jobId, node.type)
    }
  }
  return refs
}
interface ReferenceRow { id: string; kind: string; deleted_at: Date | string | null; enabled?: boolean }
/** Batch validation is owner scoped and intentionally reveals no missing/foreign
 * IDs. Previous MUST be the stored owner document, never client-supplied history.
 * Retained refs may be soft-deleted; new refs must be active when checked.
 * Do not lock reference rows: deletion uses jobs -> assets while account cleanup
 * uses assets -> jobs. A concurrent soft deletion after this check is allowed;
 * the saved reference becomes a placeholder, never an authorization grant. */
export async function validateCanvasReferences(
  client: pg.Pool | pg.PoolClient, actorId: string, input: CanvasReferenceInput, previous?: CanvasReferenceInput,
): Promise<CanvasReferenceValidationResult> {
  const next = references(input)
  const old = previous ? references(previous) : { assets: new Map(), jobs: new Map(), models: new Map() }
  for (const category of ['assets', 'jobs', 'models'] as const) {
    const expected = next[category]
    if (!expected.size) continue
    const ids = [...expected.keys()].sort()
    const table = category === 'jobs' ? 'generation_jobs' : category === 'models' ? 'model_configs' : 'assets'
    const res = await client.query(
      `SELECT id, ${category === 'models' ? 'model_kind' : 'media_kind'} AS kind, deleted_at${category === 'models' ? ', enabled' : ''}
       FROM ${table} WHERE id = ANY($1::uuid[])${category === 'models' ? '' : ' AND created_by = $2'}
       ORDER BY id`,
      category === 'models' ? [ids] : [ids, actorId],
    )
    const rows = new Map((res.rows as ReferenceRow[]).map(row => [row.id, row]))
    for (const [id, kinds] of expected) {
      const row = rows.get(id)
      if (!row || !['image', 'video'].includes(row.kind)
        || [...kinds].some(kind => kind !== 'media' && kind !== row.kind)
        || (!old[category].has(id) && (row.deleted_at !== null || (category === 'models' && !row.enabled)))) {
        return { valid: false, code: CanvasErrorCode.INVALID_INPUT }
      }
    }
  }
  return { valid: true }
}

/** Parsed input only. See writeTransaction's Pool / transaction-scoped
 * PoolClient contract; invalid references throw CanvasReferenceError. */
export async function createCanvasDocument(
  client: pg.Pool | pg.PoolClient, actorId: string, input: ParsedCreateCanvasRequest,
): Promise<CanvasDocument> {
  return writeTransaction(client, async connection => {
    const validation = await validateCanvasReferences(connection, actorId, input)
    if (!validation.valid) throw new CanvasReferenceError()
    const res = await connection.query(
      `INSERT INTO canvas_documents(created_by, title, scene, cover_asset_id)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [actorId, input.title, JSON.stringify(input.scene), input.coverAssetId],
    )
    return document(res.rows[0] as CanvasRow)
  })
}

/** Locks only the actor's live row. Revision is checked BEFORE reference queries
 * so stale patches deterministically conflict. Caller-owned PoolClient must have
 * an open transaction; the canvas revision check and update are atomic. */
export async function updateCanvasDocument(
  client: pg.Pool | pg.PoolClient, actorId: string, canvasId: string, input: UpdateCanvasRequest,
): Promise<CanvasUpdateResult> {
  return writeTransaction(client, async connection => {
    const res = await connection.query(
      `SELECT * FROM canvas_documents WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL FOR UPDATE`,
      [canvasId, actorId],
    )
    const row = res.rows[0] as CanvasRow | undefined
    if (!row) return { status: 'not_found', code: CanvasErrorCode.CANVAS_NOT_FOUND }
    if (row.revision !== input.baseRevision) return { status: 'conflict', code: CanvasErrorCode.CANVAS_REVISION_CONFLICT }
    const previous = { scene: row.scene, coverAssetId: row.cover_asset_id }
    const next = { scene: input.scene ?? previous.scene,
      coverAssetId: input.coverAssetId === undefined ? previous.coverAssetId : input.coverAssetId }
    const validation = await validateCanvasReferences(connection, actorId, next, previous)
    if (!validation.valid) return { status: 'invalid_reference', code: CanvasErrorCode.INVALID_INPUT }
    const updated = await connection.query(
      `UPDATE canvas_documents SET title = $4, scene = $5::jsonb, cover_asset_id = $6,
         revision = revision + 1, updated_at = now()
       WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL AND revision = $3 RETURNING *`,
      [canvasId, actorId, input.baseRevision, input.title ?? row.title, JSON.stringify(next.scene), next.coverAssetId],
    )
    if (updated.rows[0]) return { status: 'updated', document: document(updated.rows[0] as CanvasRow) }
    // Defensive guard for callers violating the transaction contract: never do
    // an unscoped existence probe (foreign and deleted canvases are still 404).
    const current = await findCanvasForActor(connection, actorId, canvasId)
    return current ? { status: 'conflict', code: CanvasErrorCode.CANVAS_REVISION_CONFLICT }
      : { status: 'not_found', code: CanvasErrorCode.CANVAS_NOT_FOUND }
  })
}

/** Returns false for foreign, missing or already deleted documents. Pool owns
 * its short transaction; PoolClient requires the caller's open transaction. */
export async function deleteCanvasDocument(client: pg.Pool | pg.PoolClient, actorId: string, canvasId: string): Promise<boolean> {
  return writeTransaction(client, async connection => {
    const res = await connection.query(
      `UPDATE canvas_documents SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL RETURNING id`,
      [canvasId, actorId],
    )
    return res.rows.length > 0
  })
}
