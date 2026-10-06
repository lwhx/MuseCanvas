import assert from 'node:assert/strict'
import test from 'node:test'
import type pg from 'pg'
import { purgeCanvasContentForActor } from './canvas-cleanup'

const actorId = '11111111-1111-4111-8111-111111111111'
test('account cleanup scrubs all canvases and deletes Agent payloads in FK order, scoped to the actor', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const client = { query: async (sql: string, values: unknown[]) => {
    calls.push({ sql, values }); return { rows: sql.includes('to_regclass') ? [{ agent_table: 'canvas_agent_sessions' }] : [] }
  } } as unknown as Pick<pg.PoolClient, 'query'>
  await purgeCanvasContentForActor(client, actorId)
  assert.equal(calls.length, 7)
  assert.match(calls[0]!.sql, /title = ''/)
  assert.match(calls[0]!.sql, /scene = '\{"nodes":\[\],"edges":\[\]\}'::jsonb/)
  assert.match(calls[0]!.sql, /cover_asset_id = NULL/)
  assert.match(calls[0]!.sql, /WHERE created_by = \$1/)
  assert.doesNotMatch(calls[0]!.sql, /AND deleted_at IS NULL/, 'already-deleted content is also scrubbed')
  assert.deepEqual(calls.slice(2).map(call => call.sql.match(/DELETE FROM (\w+)/)![1]), [
    'canvas_agent_terminal_events', 'canvas_agent_messages', 'canvas_agent_pending_jobs', 'canvas_agent_turns', 'canvas_agent_sessions',
  ])
  for (const call of calls.filter(call => !call.sql.includes('to_regclass'))) {
    assert.deepEqual(call.values, [actorId])
    assert.match(call.sql, /created_by = \$1/)
    assert.doesNotMatch(call.sql, /BEGIN|COMMIT/, 'the caller owns the transaction')
  }
})
test('M1-only schema still scrubs canvases without querying absent Agent tables', async () => {
  const queries: string[] = []
  const client = { query: async (sql: string) => {
    queries.push(sql)
    return { rows: sql.includes('to_regclass') ? [{ agent_table: null }] : [] }
  } } as unknown as Pick<pg.PoolClient, 'query'>
  await purgeCanvasContentForActor(client, actorId)
  assert.equal(queries.length, 2)
  assert.match(queries[0]!, /UPDATE canvas_documents/)
  assert.match(queries[1]!, /to_regclass/)
  assert.equal(queries.some(sql => sql.includes('DELETE FROM')), false)
})
test('cleanup failure propagates so account deletion cannot be marked completed with retained canvas content', async () => {
  let queries = 0
  const client = { query: async () => { if (++queries === 3) throw new Error('cleanup failure'); return { rows: queries === 2 ? [{ agent_table: 'canvas_agent_sessions' }] : [] } } } as unknown as Pick<pg.PoolClient, 'query'>
  await assert.rejects(purgeCanvasContentForActor(client, actorId), /cleanup failure/)
  assert.equal(queries, 3)
})
