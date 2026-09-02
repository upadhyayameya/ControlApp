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

export function migrate(db: Db): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // schema.sql sits beside the source in dev and beside the build output in
  // production, so look in both rather than assuming a layout.
  const candidates = [
    path.join(here, 'schema.sql'),
    path.join(here, '../../src/db/schema.sql'),
  ]
  const schemaPath = candidates.find((p) => fs.existsSync(p))
  if (!schemaPath) throw new Error(`Could not locate schema.sql (looked in ${candidates.join(', ')})`)
  db.exec(fs.readFileSync(schemaPath, 'utf8'))
}

/** An in-memory database with the schema applied. Used by tests and seeds. */
export function createTestDb(): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
