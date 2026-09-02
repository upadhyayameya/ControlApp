// ---------------------------------------------------------------------------
// Team invitations.
//
// The token exists in exactly one place — the link that goes to the invited
// person — and only its hash is stored. That means a database read cannot be
// turned into account access, and it also means the link cannot be recovered
// or re-shown: an admin who loses it revokes and re-invites, which is the
// correct trade for a credential.
//
// Accepting is the second place (after signup) where a user is created without
// a session, so it applies the same care: validate, create, and consume the
// invitation in one transaction.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Invitation, InvitationState, InvitePreview, User } from '@hbs/shared'
import { config } from '../config.js'
import type { Db } from '../db/index.js'
import { toUser, type UserRow } from '../db/rows.js'
import { hashPassword } from './auth.js'
import { record } from './audit.js'
import { generateToken, hashToken } from './secrets.js'

const INVITE_TTL_DAYS = 14

interface InvitationRow {
  id: string
  organization_id: string
  email: string
  role: string
  token_hash: string
  invited_by: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

export class InvitationError extends Error {
  constructor(
    override readonly message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'InvitationError'
  }
}

export function createInvitation(
  db: Db,
  input: {
    organizationId: string
    email: string
    role: 'customer_admin' | 'customer_viewer'
    invitedBy: User
  },
): Invitation {
  const email = input.email.trim().toLowerCase()

  const alreadyMember =
    db
      .prepare<[string, string], { n: number }>(
        'SELECT COUNT(*) AS n FROM users WHERE email = ? COLLATE NOCASE AND organization_id = ?',
      )
      .get(email, input.organizationId)?.n ?? 0
  if (alreadyMember > 0) {
    throw new InvitationError('That person is already on your team.')
  }

  // Re-inviting supersedes any invitation still outstanding, so an address
  // never has two live links.
  db.prepare(
    `UPDATE invitations SET revoked_at = ?
     WHERE organization_id = ? AND email = ? COLLATE NOCASE
       AND accepted_at IS NULL AND revoked_at IS NULL`,
  ).run(new Date().toISOString(), input.organizationId, email)

  const token = generateToken()
  const id = randomUUID()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()

  db.prepare(
    `INSERT INTO invitations
       (id, organization_id, email, role, token_hash, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.organizationId, email, input.role, hashToken(token), input.invitedBy.id, expiresAt, now)

  record(db, {
    organizationId: input.organizationId,
    actor: input.invitedBy,
    action: 'member.invited',
    targetType: 'invitation',
    targetId: id,
    targetLabel: email,
    detail: input.role === 'customer_admin' ? 'as an admin' : 'as a viewer',
  })

  queueInviteEmail(db, email, input.invitedBy.fullName, token)

  return {
    id,
    organizationId: input.organizationId,
    email,
    role: input.role,
    state: 'pending',
    invitedByName: input.invitedBy.fullName,
    expiresAt,
    acceptedAt: null,
    createdAt: now,
    // The only moment the raw token leaves this function.
    inviteUrl: inviteUrl(token),
  }
}

export function listInvitations(db: Db, organizationId: string): Invitation[] {
  return db
    .prepare<[string], InvitationRow & { invited_by_name: string | null }>(
      `SELECT i.*, u.full_name AS invited_by_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.organization_id = ?
       ORDER BY i.created_at DESC`,
    )
    .all(organizationId)
    .map((row) => toInvitation(row, row.invited_by_name))
}

export function revokeInvitation(db: Db, organizationId: string, id: string, actor: User): void {
  const row = db
    .prepare<[string, string], InvitationRow>(
      'SELECT * FROM invitations WHERE id = ? AND organization_id = ?',
    )
    .get(id, organizationId)
  if (!row) throw new InvitationError('No such invitation.', 404)
  if (row.accepted_at) throw new InvitationError('That invitation has already been accepted.')

  db.prepare('UPDATE invitations SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  record(db, {
    organizationId,
    actor,
    action: 'member.invite_revoked',
    targetType: 'invitation',
    targetId: id,
    targetLabel: row.email,
  })
}

/** What the invited person sees before choosing a password. */
export function previewInvitation(db: Db, token: string): InvitePreview {
  const { row, organizationName, invitedByName } = loadUsable(db, token)
  return {
    organizationName,
    email: row.email,
    role: row.role as 'customer_admin' | 'customer_viewer',
    invitedByName,
    expiresAt: row.expires_at,
  }
}

export async function acceptInvitation(
  db: Db,
  input: { token: string; fullName: string; password: string },
): Promise<User> {
  const { row } = loadUsable(db, input.token)
  const passwordHash = await hashPassword(input.password)
  const userId = randomUUID()
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    // Re-check inside the transaction: two people opening the same link at once
    // must not both become members.
    const current = db
      .prepare<[string], InvitationRow>('SELECT * FROM invitations WHERE id = ?')
      .get(row.id)
    if (!current || current.accepted_at || current.revoked_at) {
      throw new InvitationError('That invitation is no longer valid.')
    }

    const taken =
      db
        .prepare<[string], { n: number }>(
          'SELECT COUNT(*) AS n FROM users WHERE email = ? COLLATE NOCASE',
        )
        .get(row.email)?.n ?? 0
    if (taken > 0) {
      throw new InvitationError('An account already exists for that email address.', 409)
    }

    db.prepare(
      `INSERT INTO users (id, organization_id, email, full_name, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, row.organization_id, row.email, input.fullName.trim(), row.role, passwordHash, now)

    db.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ?').run(now, row.id)

    record(db, {
      organizationId: row.organization_id,
      actor: { id: userId, fullName: input.fullName.trim() },
      action: 'member.joined',
      targetType: 'user',
      targetId: userId,
      targetLabel: row.email,
    })
  })

  run()

  return toUser(db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(userId)!)
}

// --- Members --------------------------------------------------------------

export function listMembers(db: Db, organizationId: string): User[] {
  return db
    .prepare<[string], UserRow>(
      'SELECT * FROM users WHERE organization_id = ? ORDER BY full_name',
    )
    .all(organizationId)
    .map(toUser)
}

export function changeMemberRole(
  db: Db,
  organizationId: string,
  userId: string,
  role: 'customer_admin' | 'customer_viewer',
  actor: User,
): void {
  const member = db
    .prepare<[string, string], UserRow>(
      'SELECT * FROM users WHERE id = ? AND organization_id = ?',
    )
    .get(userId, organizationId)
  if (!member) throw new InvitationError('No such team member.', 404)

  if (member.role === 'customer_admin' && role !== 'customer_admin') {
    assertNotLastAdmin(db, organizationId, userId)
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId)
  record(db, {
    organizationId,
    actor,
    action: 'member.role_changed',
    targetType: 'user',
    targetId: userId,
    targetLabel: member.email,
    detail: `${member.role} → ${role}`,
  })
}

export function removeMember(
  db: Db,
  organizationId: string,
  userId: string,
  actor: User,
): void {
  const member = db
    .prepare<[string, string], UserRow>(
      'SELECT * FROM users WHERE id = ? AND organization_id = ?',
    )
    .get(userId, organizationId)
  if (!member) throw new InvitationError('No such team member.', 404)
  if (member.id === actor.id) throw new InvitationError('You cannot remove your own account.')
  if (member.role === 'customer_admin') assertNotLastAdmin(db, organizationId, userId)

  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  record(db, {
    organizationId,
    actor,
    action: 'member.removed',
    targetType: 'user',
    targetId: userId,
    targetLabel: member.email,
  })
}

/**
 * An organization with no admin is unrecoverable by its own people — nobody
 * left can invite, connect, or change the plan. Refusing here is friendlier
 * than a support ticket.
 */
function assertNotLastAdmin(db: Db, organizationId: string, excludingUserId: string): void {
  const others =
    db
      .prepare<[string, string], { n: number }>(
        `SELECT COUNT(*) AS n FROM users
         WHERE organization_id = ? AND role = 'customer_admin' AND id != ?`,
      )
      .get(organizationId, excludingUserId)?.n ?? 0
  if (others === 0) {
    throw new InvitationError(
      'This is the only admin on the account. Make someone else an admin first.',
    )
  }
}

// --- Internals ------------------------------------------------------------

function loadUsable(
  db: Db,
  token: string,
): { row: InvitationRow; organizationName: string; invitedByName: string } {
  const row = db
    .prepare<[string], InvitationRow & { organization_name: string; invited_by_name: string | null }>(
      `SELECT i.*, o.name AS organization_name, u.full_name AS invited_by_name
       FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.token_hash = ?`,
    )
    .get(hashToken(token))

  // One message for every failure mode, so a probe cannot distinguish an
  // unknown token from a revoked or expired one.
  if (!row || row.revoked_at || row.accepted_at || row.expires_at <= new Date().toISOString()) {
    throw new InvitationError('That invitation link is not valid or has expired.', 404)
  }

  return {
    row,
    organizationName: row.organization_name,
    invitedByName: row.invited_by_name ?? 'A colleague',
  }
}

function toInvitation(row: InvitationRow, invitedByName: string | null): Invitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role as 'customer_admin' | 'customer_viewer',
    state: stateOf(row),
    invitedByName: invitedByName ?? 'A colleague',
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  }
}

function stateOf(row: InvitationRow): InvitationState {
  if (row.accepted_at) return 'accepted'
  if (row.revoked_at) return 'revoked'
  if (row.expires_at <= new Date().toISOString()) return 'expired'
  return 'pending'
}

export function inviteUrl(token: string): string {
  return `${config.publicOrigin}/invite/${token}`
}

/**
 * Queued rather than sent, like every other outbound message — the invitation
 * is already durable in the database, so a mail failure loses a notification,
 * not the invitation itself.
 */
function queueInviteEmail(db: Db, email: string, inviterName: string, token: string): void {
  db.prepare(
    `INSERT INTO email_outbox (id, thread_id, to_addresses, subject, body, status, created_at)
     VALUES (?, NULL, ?, ?, ?, 'queued', ?)`,
  ).run(
    randomUUID(),
    JSON.stringify([email]),
    `${inviterName} invited you to the HBS client portal`,
    `${inviterName} has invited you to the HBS client portal.\n\nAccept the invitation:\n${inviteUrl(token)}\n\nThe link expires in ${INVITE_TTL_DAYS} days.`,
    new Date().toISOString(),
  )
}
