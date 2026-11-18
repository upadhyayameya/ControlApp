// ---------------------------------------------------------------------------
// Database handle and migration runner.
//
// The schema is applied idempotently at startup — every statement is
// CREATE ... IF NOT EXISTS — which is the right trade for a project that has
// not shipped yet. Before the first real deployment this should become a
// numbered-migration table; the seam is `migrate()`.
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { applyColumnMigrations } from './migrations.js'

export type Db = Database.Database

let instance: Db | null = null

export function getDb(): Db {
  if (instance) return instance
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const db = new Database(config.databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  instance = db
  return db
}

export function migrate(db: Db, quiet = false): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // The build copies schema.sql next to the compiled output (see package.json),
  // so the first candidate is the current one. The source path is the fallback
  // for running straight from TypeScript.
  const candidates = [
    path.join(here, 'schema.sql'),
    path.join(here, '../../src/db/schema.sql'),
  ]
  const schemaPath = candidates.find((p) => fs.existsSync(p))
  if (!schemaPath) throw new Error(`Could not locate schema.sql (looked in ${candidates.join(', ')})`)
  db.exec(fs.readFileSync(schemaPath, 'utf8'))

  // Tables come from schema.sql; columns added to tables that already exist
  // come from here, so an existing database picks up new fields on boot.
  const added = applyColumnMigrations(db)
  if (added.length > 0 && !quiet) console.log(`[db] added columns: ${added.join(', ')}`)
}

/** An in-memory database with the schema applied. Used by tests and seeds. */
export function createTestDb(): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  // Quiet: a test creates dozens of these and the migration log would bury
  // the test output it is meant to sit alongside.
  migrate(db, true)
  return db
}
