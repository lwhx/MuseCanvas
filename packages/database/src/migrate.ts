import { db } from './index'
import { runMigrations, type MigrateEvent } from './migrations/runner'

/**
 * Deploy entrypoint for schema migrations (`tsx src/migrate.ts`).
 *
 * This file used to be the 1143-line schema blob re-executed on every deploy. That
 * statement stream now lives, verbatim and in order, in `migrations/0001..0026.sql`
 * (pinned by `testdata/legacy-migrate.sql` and `migrations.test.ts`), and this
 * script only drives the sequential runner. The path is kept so every compose file
 * and operator runbook keeps working unchanged.
 *
 * A database previously built by the blob has no `schema_migrations` rows: the
 * runner classifies it as legacy and re-applies every file once (each is idempotent,
 * exactly as the blob was), then records them. Later deploys apply only new files.
 *
 * Pass `--dry-run` to list pending migrations without applying them.
 */

function log(event: MigrateEvent): void {
  switch (event.type) {
    case 'waiting':
      console.log('migrate: waiting for migration lock')
      break
    case 'legacy':
      console.log(`migrate: legacy database detected (no history); re-applying baseline up to ${event.maxVersion}`)
      break
    case 'start':
      console.log(`migrate: ${event.database} as ${event.user}: ${event.pending} pending of ${event.total}`)
      break
    case 'applied':
      console.log(`migrate: applied ${event.version}_${event.name} (${event.durationMs}ms)`)
      break
    case 'skipped':
      if (event.reason === 'dry-run') console.log(`migrate: pending ${event.version}_${event.name}`)
      break
    case 'warn':
      console.warn(`migrate: warning ${event.code}: ${event.message}`)
      break
  }
}

const pool = db()
let exitCode = 0
try {
  const result = await runMigrations({ pool, dryRun: process.argv.includes('--dry-run'), onEvent: log })
  console.log(`database migration complete: ${result.applied.length} applied, latest ${result.latest ?? 'none'}`)
} catch (error) {
  console.error('database migration failed:', error instanceof Error ? error.message : error)
  exitCode = 1
} finally {
  // runMigrations always releases its client, so ending the pool cannot hang here.
  await pool.end()
}
process.exit(exitCode)
