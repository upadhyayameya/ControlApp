// ---------------------------------------------------------------------------
// The audit trail.
//
// Written on state changes only — never on reads, which would bury the entries
// that matter. `actorLabel` is denormalised on purpose: an audit entry has to
// stay readable after the user who caused it is deleted, and a dangling id
// would make the record useless exactly when someone needs it most.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuditEvent, User } from '@hbs/shared'
import type { Db } from '../db/index.js'

export interface AuditRow {
  id: string
  organization_id: string | null
  actor_user_id: string | null
  actor_label: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  detail: string | null
  created_at: string
}

export type AuditAction =
  | 'organization.created'
  | 'organization.updated'
  | 'member.invited'
  | 'member.invite_revoked'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'espm.connected'
  | 'espm.disconnected'
  | 'espm.pull'
  | 'espm.push'
  | 'building.updated'
  | 'building.filed'
  | 'group.created'
  | 'group.updated'
  | 'group.deleted'
  | 'consumption.entered'
  | 'report.generated'
  | 'plan.change_requested'

export function record(
  db: Db,
  input: {
    organizationId: string | null
    actor: Pick<User, 'id' | 'fullName'> | { id: null; fullName: string }
    action: AuditAction
    targetType?: string
    targetId?: string
    targetLabel?: string
    detail?: string
  },
): void {
  db.prepare(
    `INSERT INTO audit_events
       (id, organization_id, actor_user_id, actor_label, action, target_type, target_id, target_label, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.organizationId,
    input.actor.id,
    input.actor.fullName,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.targetLabel ?? null,
    input.detail ?? null,
    new Date().toISOString(),
  )
}

export function listAudit(db: Db, organizationId: string, limit = 100): AuditEvent[] {
  return db
    .prepare<[string, number], AuditRow>(
      'SELECT * FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(organizationId, limit)
    .map(toAuditEvent)
}

export function toAuditEvent(r: AuditRow): AuditEvent {
  return {
    id: r.id,
    organizationId: r.organization_id,
    actorLabel: r.actor_label,
    action: r.action,
    targetType: r.target_type,
    targetLabel: r.target_label,
    detail: r.detail,
    createdAt: r.created_at,
  }
}
