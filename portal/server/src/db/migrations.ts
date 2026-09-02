// ---------------------------------------------------------------------------
// Additive column migrations.
//
// schema.sql creates tables idempotently, which cannot add a column to a table
// that already exists — so a developer with an existing database would silently
// keep the old shape. Each entry here is checked against the live table and
// applied only when missing, which is safe to run on every boot and does not
// require anyone to delete their data.
//
// This is the honest version of "no migration system yet": additive only, no
// renames, no drops. Before the first real deployment it should become a
// numbered-migration table.
// ---------------------------------------------------------------------------

import type { Db } from './index.js'

interface ColumnAddition {
  table: string
  column: string
  /** Everything after the column name in ALTER TABLE ... ADD COLUMN. */
  definition: string
}

const ADDITIONS: ColumnAddition[] = [
  // --- Organizations become tenants ---
  { table: 'organizations', column: 'slug', definition: 'TEXT' },
  { table: 'organizations', column: 'accent_color', definition: "TEXT NOT NULL DEFAULT '#0B5D66'" },
  { table: 'organizations', column: 'logo_mark', definition: 'TEXT' },
  { table: 'organizations', column: 'plan_status', definition: "TEXT NOT NULL DEFAULT 'trialing'" },
  { table: 'organizations', column: 'trial_ends_at', definition: 'TEXT' },
  { table: 'organizations', column: 'onboarding_completed_at', definition: 'TEXT' },

  // --- A connection a customer made themselves ---
  { table: 'espm_connections', column: 'status', definition: "TEXT NOT NULL DEFAULT 'unverified'" },
  { table: 'espm_connections', column: 'last_error', definition: 'TEXT' },
  { table: 'espm_connections', column: 'verified_at', definition: 'TEXT' },
  // AES-256-GCM, keyed from CREDENTIAL_KEY. See services/secrets.ts for why the
  // ciphertext lives here rather than the password living in an env var.
  { table: 'espm_connections', column: 'secret_ciphertext', definition: 'TEXT' },
  { table: 'espm_connections', column: 'secret_iv', definition: 'TEXT' },
  { table: 'espm_connections', column: 'secret_tag', definition: 'TEXT' },
]

export function applyColumnMigrations(db: Db): string[] {
  const applied: string[] = []
  for (const addition of ADDITIONS) {
    if (!tableExists(db, addition.table)) continue
    if (columnExists(db, addition.table, addition.column)) continue
    db.exec(
      `ALTER TABLE ${addition.table} ADD COLUMN ${addition.column} ${addition.definition}`,
    )
    applied.push(`${addition.table}.${addition.column}`)
  }
  backfillSlugs(db)
  return applied
}

function tableExists(db: Db, table: string): boolean {
  return (
    db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table)?.n ?? 0
  ) > 0
}

function columnExists(db: Db, table: string, column: string): boolean {
  const columns = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all()
  return columns.some((c) => c.name === column)
}

/** Organizations created before slugs existed still need one to be routable. */
function backfillSlugs(db: Db): void {
  const rows = db
    .prepare<[], { id: string; name: string }>(
      "SELECT id, name FROM organizations WHERE slug IS NULL OR slug = ''",
    )
    .all()
  for (const row of rows) {
    db.prepare('UPDATE organizations SET slug = ? WHERE id = ?').run(
      uniqueSlug(db, slugify(row.name)),
      row.id,
    )
  }
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base === '' ? 'org' : base
}

/** Appends -2, -3 … until the slug is free. */
export function uniqueSlug(db: Db, base: string): string {
  let candidate = base
  let n = 1
  while (
    (db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM organizations WHERE slug = ?')
      .get(candidate)?.n ?? 0) > 0
  ) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}
