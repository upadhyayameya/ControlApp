// ---------------------------------------------------------------------------
// The portfolio tree, server side.
//
// Reads are trivial; the care is all in the writes. Moving a group is the one
// operation that can corrupt the structure — a group made its own ancestor
// disconnects everything under it from the tree — so `moveGroup` refuses that
// outright rather than relying on the reader being forgiving about cycles.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { MAX_GROUP_DEPTH, type BuildingGroup, type GroupKind, type User } from '@hbs/shared'
import type { Db } from '../db/index.js'
import { record } from './audit.js'

export interface GroupRow {
  id: string
  organization_id: string
  parent_id: string | null
  name: string
  kind: string
  sort_order: number
  created_at: string
}

export function toGroup(r: GroupRow): BuildingGroup {
  return {
    id: r.id,
    organizationId: r.organization_id,
    parentId: r.parent_id,
    name: r.name,
    kind: (r.kind as GroupKind) ?? 'phase',
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

export class GroupError extends Error {
  constructor(
    override readonly message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'GroupError'
  }
}

export function listGroups(db: Db, organizationId: string | null): BuildingGroup[] {
  const rows = organizationId
    ? db
        .prepare<[string], GroupRow>(
          'SELECT * FROM building_groups WHERE organization_id = ? ORDER BY sort_order, name',
        )
        .all(organizationId)
    : db
        .prepare<[], GroupRow>('SELECT * FROM building_groups ORDER BY sort_order, name')
        .all()
  return rows.map(toGroup)
}

export function createGroup(
  db: Db,
  input: {
    organizationId: string
    name: string
    parentId: string | null
    kind?: GroupKind
    actor: User
  },
): BuildingGroup {
  const parent = input.parentId === null ? null : requireGroup(db, input.organizationId, input.parentId)
  if (parent && depthOf(db, parent.id) + 1 >= MAX_GROUP_DEPTH) {
    throw new GroupError(`Groups can nest ${MAX_GROUP_DEPTH} levels deep at most.`)
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  // A root is a portfolio; anything nested defaults to a phase. The caller can
  // override, which is what 'group' is for.
  const kind: GroupKind = input.kind ?? (parent === null ? 'portfolio' : 'phase')

  const nextOrder =
    db
      .prepare<[string, string | null], { next: number | null }>(
        `SELECT MAX(sort_order) + 1 AS next FROM building_groups
         WHERE organization_id = ? AND parent_id IS ?`,
      )
      .get(input.organizationId, input.parentId)?.next ?? 0

  db.prepare(
    `INSERT INTO building_groups (id, organization_id, parent_id, name, kind, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.organizationId, input.parentId, input.name.trim(), kind, nextOrder, now)

  record(db, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'group.created',
    targetType: 'group',
    targetId: id,
    targetLabel: input.name.trim(),
    detail: parent ? `under ${parent.name}` : 'as a portfolio',
  })

  return toGroup(db.prepare<[string], GroupRow>('SELECT * FROM building_groups WHERE id = ?').get(id)!)
}

export function updateGroup(
  db: Db,
  input: {
    organizationId: string
    groupId: string
    name?: string
    parentId?: string | null
    sortOrder?: number
    actor: User
  },
): BuildingGroup {
  const group = requireGroup(db, input.organizationId, input.groupId)

  if (input.parentId !== undefined) {
    moveGroup(db, input.organizationId, group, input.parentId)
  }

  const sets: string[] = []
  const params: Array<string | number> = []
  if (input.name !== undefined) {
    sets.push('name = ?')
    params.push(input.name.trim())
  }
  if (input.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    params.push(input.sortOrder)
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE building_groups SET ${sets.join(', ')} WHERE id = ?`).run(
      ...params,
      group.id,
    )
  }

  record(db, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'group.updated',
    targetType: 'group',
    targetId: group.id,
    targetLabel: input.name?.trim() ?? group.name,
  })

  return toGroup(
    db.prepare<[string], GroupRow>('SELECT * FROM building_groups WHERE id = ?').get(group.id)!,
  )
}

/**
 * Re-parent a group.
 *
 * The check that matters: a group cannot be moved under itself or under one of
 * its own descendants. That would make it its own ancestor, and everything
 * beneath it would drop out of the tree — visible to the customer as buildings
 * that simply vanished.
 */
function moveGroup(
  db: Db,
  organizationId: string,
  group: BuildingGroup,
  parentId: string | null,
): void {
  if (parentId === group.id) {
    throw new GroupError('A group cannot be moved inside itself.')
  }

  if (parentId !== null) {
    const parent = requireGroup(db, organizationId, parentId)
    if (descendantsOf(db, group.id).has(parent.id)) {
      throw new GroupError(`"${parent.name}" sits inside "${group.name}", so it cannot become its parent.`)
    }
    if (depthOf(db, parent.id) + 1 + heightOf(db, group.id) >= MAX_GROUP_DEPTH) {
      throw new GroupError(`That move would nest groups more than ${MAX_GROUP_DEPTH} levels deep.`)
    }
  }

  db.prepare('UPDATE building_groups SET parent_id = ?, kind = ? WHERE id = ?').run(
    parentId,
    parentId === null ? 'portfolio' : group.kind === 'portfolio' ? 'phase' : group.kind,
    group.id,
  )
}

/**
 * Delete a group. Children and buildings are detached rather than deleted —
 * the foreign keys are ON DELETE SET NULL — so a mis-click cannot take a
 * phase's buildings with it. They resurface as unfiled, which is visible and
 * recoverable.
 */
export function deleteGroup(
  db: Db,
  input: { organizationId: string; groupId: string; actor: User },
): { detachedGroups: number; detachedBuildings: number } {
  const group = requireGroup(db, input.organizationId, input.groupId)

  const detachedGroups =
    db
      .prepare<[string], { n: number }>(
        'SELECT COUNT(*) AS n FROM building_groups WHERE parent_id = ?',
      )
      .get(group.id)?.n ?? 0
  const detachedBuildings =
    db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM buildings WHERE group_id = ?')
      .get(group.id)?.n ?? 0

  db.prepare('DELETE FROM building_groups WHERE id = ?').run(group.id)

  record(db, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'group.deleted',
    targetType: 'group',
    targetId: group.id,
    targetLabel: group.name,
    detail:
      detachedGroups + detachedBuildings > 0
        ? `${detachedBuildings} building(s) and ${detachedGroups} group(s) are now unfiled`
        : undefined,
  })

  return { detachedGroups, detachedBuildings }
}

export function assignBuilding(
  db: Db,
  input: { organizationId: string; buildingId: string; groupId: string | null; actor: User },
): void {
  const building = db
    .prepare<[string, string], { id: string; name: string }>(
      'SELECT id, name FROM buildings WHERE id = ? AND organization_id = ?',
    )
    .get(input.buildingId, input.organizationId)
  if (!building) throw new GroupError('No such building.', 404)

  const group = input.groupId === null ? null : requireGroup(db, input.organizationId, input.groupId)

  db.prepare('UPDATE buildings SET group_id = ? WHERE id = ?').run(input.groupId, building.id)

  record(db, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'building.filed',
    targetType: 'building',
    targetId: building.id,
    targetLabel: building.name,
    detail: group ? `filed under ${group.name}` : 'unfiled',
  })
}

// --- Internals ------------------------------------------------------------

function requireGroup(db: Db, organizationId: string, groupId: string): BuildingGroup {
  const row = db
    .prepare<[string, string], GroupRow>(
      'SELECT * FROM building_groups WHERE id = ? AND organization_id = ?',
    )
    .get(groupId, organizationId)
  // Same 404 for "does not exist" and "belongs to another tenant": a customer
  // probing ids should not be able to tell which ones are real.
  if (!row) throw new GroupError('No such group.', 404)
  return toGroup(row)
}

/** Every group beneath this one, at any depth. */
function descendantsOf(db: Db, groupId: string): Set<string> {
  const out = new Set<string>()
  let frontier = [groupId]
  for (let depth = 0; depth < MAX_GROUP_DEPTH && frontier.length > 0; depth++) {
    const placeholders = frontier.map(() => '?').join(',')
    const children = db
      .prepare<string[], { id: string }>(
        `SELECT id FROM building_groups WHERE parent_id IN (${placeholders})`,
      )
      .all(...frontier)
    frontier = []
    for (const child of children) {
      if (out.has(child.id)) continue
      out.add(child.id)
      frontier.push(child.id)
    }
  }
  return out
}

/** How far this group sits below a root. */
function depthOf(db: Db, groupId: string): number {
  let depth = 0
  let current: string | null = groupId
  const seen = new Set<string>()
  while (current !== null && depth < MAX_GROUP_DEPTH) {
    if (seen.has(current)) break
    seen.add(current)
    const row: { parent_id: string | null } | undefined = db
      .prepare<[string], { parent_id: string | null }>(
        'SELECT parent_id FROM building_groups WHERE id = ?',
      )
      .get(current)
    if (!row?.parent_id) break
    current = row.parent_id
    depth++
  }
  return depth
}

/** How many levels of groups sit beneath this one. */
function heightOf(db: Db, groupId: string): number {
  let height = 0
  let frontier = [groupId]
  for (let depth = 0; depth < MAX_GROUP_DEPTH && frontier.length > 0; depth++) {
    const placeholders = frontier.map(() => '?').join(',')
    const children = db
      .prepare<string[], { id: string }>(
        `SELECT id FROM building_groups WHERE parent_id IN (${placeholders})`,
      )
      .all(...frontier)
    if (children.length === 0) break
    height++
    frontier = children.map((c) => c.id)
  }
  return height
}
