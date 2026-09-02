// ---------------------------------------------------------------------------
// The platform API: signing up, the team, the connection, the plan, the trail.
//
// Split from routes/index.ts because it answers a different question. Those
// routes serve one customer's buildings; these serve the account that owns
// them, and almost every one is admin-only.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { z } from 'zod'
import type { Request, Response } from 'express'
import {
  planFor,
  PLANS,
  type AuditResponse,
  type ConnectEspmRequest,
  type InvitePreview,
  type OrgOverviewResponse,
  type SessionResponse,
} from '@hbs/shared'
import { config } from '../config.js'
import { onboardingFor } from '../services/tenancy.js'
import { getDb } from '../db/index.js'
import { HttpError, requireAuth, requireWriteAccess } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { listAudit, record } from '../services/audit.js'
import { assignBuilding, createGroup, deleteGroup, updateGroup } from '../services/groups.js'
import { createSession, SESSION_COOKIE } from '../services/auth.js'
import {
  connectOwnAccount,
  ConnectionError,
  disconnect,
  summaryFor,
} from '../services/connections.js'
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  InvitationError,
  listInvitations,
  listMembers,
  previewInvitation,
  removeMember,
  revokeInvitation,
} from '../services/invitations.js'
import { profileById, signUp, updateProfile, usageFor } from '../services/tenancy.js'
import { organizationById } from '../services/organizations.js'

export const platform = Router()

/**
 * The organization the signed-in user administers.
 *
 * Staff have no tenant of their own, so these routes are for customers. A
 * staff member who needs to act on a tenant does it through the staff console,
 * where the action is attributed to them.
 */
function requireOwnOrganization(req: Request): string {
  const organizationId = req.user?.organizationId
  if (!organizationId) {
    throw new HttpError(403, 'This is an account setting for a customer organization.')
  }
  return organizationId
}

function requireAdmin(req: Request): void {
  if (req.user?.role !== 'customer_admin') {
    throw new HttpError(403, 'Only an account admin can change this.')
  }
}

/** Signing in after signup or accepting an invite — same cookie, same shape. */
function establishSession(res: Response, userId: string): void {
  const session = createSession(getDb(), userId)
  res.cookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    expires: new Date(session.expiresAt),
  })
}

// --- Signing up -----------------------------------------------------------

platform.post(
  '/auth/signup',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        organizationName: z.string().min(2).max(120),
        fullName: z.string().min(2).max(120),
        email: z.string().email(),
        // Long rather than complex: length is what actually resists guessing,
        // and composition rules mostly produce predictable substitutions.
        password: z.string().min(10).max(200),
      })
      .parse(req.body)

    const { user, profile } = await signUp(getDb(), body)
    establishSession(res, user.id)

    res.json({
      user,
      organization: organizationById(getDb(), profile.id),
      profile,
    } satisfies SessionResponse)
  }),
)

// --- Invitations, from the invited person's side --------------------------

platform.get('/invitations/:token', (req, res) => {
  const token = req.params['token']
  if (!token) throw new HttpError(400, 'Missing invitation token.')
  res.json(previewInvitation(getDb(), token) satisfies InvitePreview)
})

platform.post(
  '/invitations/accept',
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        token: z.string().min(10),
        fullName: z.string().min(2).max(120),
        password: z.string().min(10).max(200),
      })
      .parse(req.body)

    const user = await acceptInvitation(getDb(), body)
    establishSession(res, user.id)

    res.json({
      user,
      organization: user.organizationId ? organizationById(getDb(), user.organizationId) : null,
      profile: user.organizationId ? profileById(getDb(), user.organizationId) : null,
    } satisfies SessionResponse)
  }),
)

// --- The account overview -------------------------------------------------

platform.get('/org', requireAuth, (req, res) => {
  const db = getDb()
  const organizationId = requireOwnOrganization(req)
  const profile = profileById(db, organizationId)
  if (!profile) throw new HttpError(404, 'No such organization.')

  res.json({
    profile,
    usage: usageFor(db, profile),
    onboarding: onboardingFor(db, profile),
    members: listMembers(db, organizationId),
    // Only an admin sees who has been invited but has not yet joined.
    invitations: req.user?.role === 'customer_admin' ? listInvitations(db, organizationId) : [],
    connection: summaryFor(db, organizationId),
  } satisfies OrgOverviewResponse)
})

platform.patch('/org', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  const body = z
    .object({
      name: z.string().min(2).max(120).optional(),
      billingEmail: z.string().email().nullable().optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      logoMark: z.string().max(3).nullable().optional(),
    })
    .parse(req.body)

  res.json(updateProfile(getDb(), organizationId, req.user!, body))
})

// --- The team -------------------------------------------------------------

platform.post('/org/invitations', requireAuth, (req, res) => {
  const db = getDb()
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)

  const body = z
    .object({
      email: z.string().email(),
      role: z.enum(['customer_admin', 'customer_viewer']),
    })
    .parse(req.body)

  // The seat limit is enforced where the seat is actually taken, counting
  // outstanding invitations — otherwise an admin can invite past the plan and
  // the refusal lands on the invited person instead.
  const profile = profileById(db, organizationId)!
  const plan = planFor(profile.tier)
  if (plan.limits.maxUsers !== null) {
    const pending = listInvitations(db, organizationId).filter((i) => i.state === 'pending').length
    const members = listMembers(db, organizationId).length
    if (members + pending >= plan.limits.maxUsers) {
      throw new HttpError(
        402,
        `The ${plan.name} plan covers ${plan.limits.maxUsers} people, and you have ${members} with ${pending} invited. Upgrade to add more.`,
      )
    }
  }

  res.json(createInvitation(db, { organizationId, ...body, invitedBy: req.user! }))
})

platform.delete('/org/invitations/:id', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  const id = req.params['id']
  if (!id) throw new HttpError(400, 'Missing invitation id.')
  revokeInvitation(getDb(), organizationId, id, req.user!)
  res.json({ ok: true })
})

platform.patch('/org/members/:id', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  const id = req.params['id']
  if (!id) throw new HttpError(400, 'Missing member id.')
  const body = z.object({ role: z.enum(['customer_admin', 'customer_viewer']) }).parse(req.body)
  changeMemberRole(getDb(), organizationId, id, body.role, req.user!)
  res.json({ ok: true })
})

platform.delete('/org/members/:id', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  const id = req.params['id']
  if (!id) throw new HttpError(400, 'Missing member id.')
  removeMember(getDb(), organizationId, id, req.user!)
  res.json({ ok: true })
})

// --- The Portfolio Manager connection -------------------------------------

platform.get('/org/connection', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  res.json({ connection: summaryFor(getDb(), organizationId) })
})

platform.post(
  '/org/connection',
  requireAuth,
  asyncRoute(async (req, res) => {
    const db = getDb()
    const organizationId = requireOwnOrganization(req)
    requireAdmin(req)

    const profile = profileById(db, organizationId)!
    const plan = planFor(profile.tier)
    if (!plan.limits.ownEspmConnection) {
      throw new HttpError(
        402,
        `Connecting your own ENERGY STAR account is part of the Compliance plan. On ${plan.name}, share your properties with the HBS account instead.`,
      )
    }

    const body = z
      .object({
        username: z.string().min(1).max(200),
        password: z.string().min(1).max(200),
        environment: z.enum(['test', 'live']),
      })
      .parse(req.body) satisfies ConnectEspmRequest

    res.json(
      await connectOwnAccount(db, {
        organizationId,
        organizationName: profile.name,
        actor: req.user!,
        ...body,
      }),
    )
  }),
)

platform.delete('/org/connection', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  disconnect(getDb(), organizationId, req.user!)
  res.json({ ok: true })
})

// --- Plans ----------------------------------------------------------------

platform.get('/plans', (_req, res) => {
  res.json({ plans: PLANS })
})

/**
 * Changing plan raises a request rather than charging a card. There is no
 * payment processor wired up, and pretending otherwise in the UI would be
 * worse than saying so.
 */
platform.post('/org/plan', requireAuth, (req, res) => {
  const db = getDb()
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  const body = z
    .object({ tier: z.enum(['benchmarking', 'compliance', 'managed']), note: z.string().max(1000).optional() })
    .parse(req.body)

  record(db, {
    organizationId,
    actor: req.user!,
    action: 'plan.change_requested',
    targetType: 'plan',
    targetLabel: body.tier,
    detail: body.note,
  })

  res.json({
    ok: true,
    message:
      'Thanks — we have your request and someone from HBS will confirm the change and the billing details.',
  })
})

// --- The portfolio tree ---------------------------------------------------
//
// Portfolios and phases are the same entity at different depths, so one set of
// routes serves both. Every one resolves the organization from the session
// rather than the body: a customer cannot file a building into another
// tenant's phase by guessing an id.

platform.post('/groups', requireAuth, requireWriteAccess, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  const body = z
    .object({
      name: z.string().min(1).max(120),
      parentId: z.string().uuid().nullable().optional(),
      kind: z.enum(['portfolio', 'phase', 'group']).optional(),
    })
    .parse(req.body)

  res.json(
    createGroup(getDb(), {
      organizationId,
      name: body.name,
      parentId: body.parentId ?? null,
      kind: body.kind,
      actor: req.user!,
    }),
  )
})

platform.patch('/groups/:id', requireAuth, requireWriteAccess, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  const groupId = req.params['id']
  if (!groupId) throw new HttpError(400, 'Missing group id.')

  const body = z
    .object({
      name: z.string().min(1).max(120).optional(),
      parentId: z.string().uuid().nullable().optional(),
      sortOrder: z.number().int().optional(),
    })
    .parse(req.body)

  res.json(updateGroup(getDb(), { organizationId, groupId, actor: req.user!, ...body }))
})

platform.delete('/groups/:id', requireAuth, requireWriteAccess, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  const groupId = req.params['id']
  if (!groupId) throw new HttpError(400, 'Missing group id.')
  res.json(deleteGroup(getDb(), { organizationId, groupId, actor: req.user! }))
})

platform.post('/buildings/:id/group', requireAuth, requireWriteAccess, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  const buildingId = req.params['id']
  if (!buildingId) throw new HttpError(400, 'Missing building id.')
  const body = z.object({ groupId: z.string().uuid().nullable() }).parse(req.body)

  assignBuilding(getDb(), { organizationId, buildingId, groupId: body.groupId, actor: req.user! })
  res.json({ ok: true })
})

// --- The audit trail ------------------------------------------------------

platform.get('/org/audit', requireAuth, (req, res) => {
  const organizationId = requireOwnOrganization(req)
  requireAdmin(req)
  res.json({ events: listAudit(getDb(), organizationId) } satisfies AuditResponse)
})

// Re-export so the error handler can translate these into status codes.
export { ConnectionError, InvitationError }
