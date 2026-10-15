// Organization reads. Small, but every route that scopes by organization goes
// through here rather than hand-writing the same query.
import type { Organization } from '@hbs/shared'
import type { Db } from '../db/index.js'
import { toOrganization, type OrganizationRow } from '../db/rows.js'

export function organizationById(db: Db, id: string): Organization | null {
  const row = db
    .prepare<[string], OrganizationRow>('SELECT * FROM organizations WHERE id = ?')
    .get(id)
  return row ? toOrganization(row) : null
}

export function listOrganizations(db: Db): Organization[] {
  return db
    .prepare<[], OrganizationRow>('SELECT * FROM organizations ORDER BY name')
    .all()
    .map(toOrganization)
}
