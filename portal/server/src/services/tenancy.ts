// ---------------------------------------------------------------------------
// Tenants: signing up, the organization profile, plan usage and onboarding.
//
// Signup is the one place a user is created without an existing session, so it
// is also the one place that has to be careful about what an anonymous caller
// can cause: exactly one organization and one admin, inside a transaction, with
// the email uniqueness check and the insert in the same atomic step.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import {
  planFor,
  type OnboardingState,
  type OnboardingStep,
  type OrganizationProfile,
  type PlanStatus,
  type PlanUsage,
  type ServiceTier,
  type User,
} from '@hbs/shared'
import type { Db } from '../db/index.js'
import { slugify, uniqueSlug } from '../db/migrations.js'
import { toUser, type OrganizationRow, type UserRow } from '../db/rows.js'
import { hashPassword } from './auth.js'
import { record } from './audit.js'

/** How long a new organization gets before the plan needs settling. */
const TRIAL_DAYS = 30

/** The tier a self-service signup lands on. */
const SIGNUP_TIER: ServiceTier = 'compliance'

export interface OrganizationProfileRow extends OrganizationRow {
  slug: string | null
  accent_color: string
  logo_mark: string | null
  plan_status: string
  trial_ends_at: string | null
  onboarding_completed_at: string | null
}

export function toProfile(r: OrganizationProfileRow): OrganizationProfile {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug ?? slugify(r.name),
    billingEmail: r.billing_email,
    tier: r.tier as ServiceTier,
    planStatus: (r.plan_status as PlanStatus) ?? 'trialing',
    trialEndsAt: r.trial_ends_at,
    accentColor: r.accent_color ?? '#0B5D66',
    logoMark: r.logo_mark,
    onboardingCompletedAt: r.onboarding_completed_at,
    createdAt: r.created_at,
  }
}

export function profileById(db: Db, organizationId: string): OrganizationProfile | null {
  const row = db
    .prepare<[string], OrganizationProfileRow>('SELECT * FROM organizations WHERE id = ?')
    .get(organizationId)
  return row ? toProfile(row) : null
}

export class SignupError extends Error {
  constructor(
    override readonly message: string,
    readonly field: 'email' | 'organizationName' | 'password',
  ) {
    super(message)
    this.name = 'SignupError'
  }
}

export async function signUp(
  db: Db,
  input: { organizationName: string; fullName: string; email: string; password: string },
): Promise<{ user: User; profile: OrganizationProfile }> {
  const email = input.email.trim().toLowerCase()
  const passwordHash = await hashPassword(input.password)
  const now = new Date().toISOString()
  const organizationId = randomUUID()
  const userId = randomUUID()

  // The uniqueness check and the inserts share a transaction: without that,
  // two simultaneous signups on the same address both see "available" and one
  // fails on the constraint after having already created an organization.
  const run = db.transaction(() => {
    const taken =
      db
        .prepare<[string], { n: number }>(
          'SELECT COUNT(*) AS n FROM users WHERE email = ? COLLATE NOCASE',
        )
        .get(email)?.n ?? 0
    if (taken > 0) {
      throw new SignupError('An account already exists for that email address.', 'email')
    }

    const slug = uniqueSlug(db, slugify(input.organizationName))
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString()

    db.prepare(
      `INSERT INTO organizations
         (id, name, billing_email, tier, created_at, slug, accent_color, plan_status, trial_ends_at)
       VALUES (?, ?, ?, ?, ?, ?, '#0B5D66', 'trialing', ?)`,
    ).run(organizationId, input.organizationName.trim(), email, SIGNUP_TIER, now, slug, trialEndsAt)

    db.prepare(
      `INSERT INTO users (id, organization_id, email, full_name, role, password_hash, created_at)
       VALUES (?, ?, ?, ?, 'customer_admin', ?, ?)`,
    ).run(userId, organizationId, email, input.fullName.trim(), passwordHash, now)

    record(db, {
      organizationId,
      actor: { id: userId, fullName: input.fullName.trim() },
      action: 'organization.created',
      targetType: 'organization',
      targetId: organizationId,
      targetLabel: input.organizationName.trim(),
    })
  })

  run()

  const user = toUser(
    db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(userId)!,
  )
  return { user, profile: profileById(db, organizationId)! }
}

export function updateProfile(
  db: Db,
  organizationId: string,
  actor: User,
  changes: { name?: string; billingEmail?: string | null; accentColor?: string; logoMark?: string | null },
): OrganizationProfile {
  const sets: string[] = []
  const params: Array<string | null> = []

  if (changes.name !== undefined) {
    sets.push('name = ?')
    params.push(changes.name.trim())
  }
  if (changes.billingEmail !== undefined) {
    sets.push('billing_email = ?')
    params.push(changes.billingEmail?.trim().toLowerCase() ?? null)
  }
  if (changes.accentColor !== undefined) {
    // Validated to a hex literal before it reaches CSS. Anything else would let
    // a tenant admin inject arbitrary values into a style attribute.
    if (!/^#[0-9a-fA-F]{6}$/.test(changes.accentColor)) {
      throw new Error('Accent colour must be a hex value such as #0B5D66.')
    }
    sets.push('accent_color = ?')
    params.push(changes.accentColor.toUpperCase())
  }
  if (changes.logoMark !== undefined) {
    const mark = changes.logoMark?.trim().slice(0, 3) ?? null
    sets.push('logo_mark = ?')
    params.push(mark === '' ? null : mark)
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`).run(
      ...params,
      organizationId,
    )
    record(db, {
      organizationId,
      actor,
      action: 'organization.updated',
      targetType: 'organization',
      targetId: organizationId,
      detail: Object.keys(changes).join(', '),
    })
  }

  return profileById(db, organizationId)!
}

export function usageFor(db: Db, profile: OrganizationProfile): PlanUsage {
  const buildings =
    db
      .prepare<[string], { n: number }>(
        'SELECT COUNT(*) AS n FROM buildings WHERE organization_id = ?',
      )
      .get(profile.id)?.n ?? 0
  const users =
    db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM users WHERE organization_id = ?')
      .get(profile.id)?.n ?? 0

  const plan = planFor(profile.tier)
  const exceeded: string[] = []
  if (plan.limits.maxBuildings !== null && buildings > plan.limits.maxBuildings) {
    exceeded.push(
      `${buildings} buildings against a ${plan.name} limit of ${plan.limits.maxBuildings}.`,
    )
  }
  if (plan.limits.maxUsers !== null && users > plan.limits.maxUsers) {
    exceeded.push(`${users} people against a ${plan.name} limit of ${plan.limits.maxUsers}.`)
  }

  return {
    plan,
    status: profile.planStatus,
    trialEndsAt: profile.trialEndsAt,
    buildings,
    users,
    exceeded,
  }
}

/**
 * The onboarding checklist, computed from real state rather than stored flags.
 * A stored flag drifts; this cannot claim a step is done when it is not.
 */
export function onboardingFor(db: Db, profile: OrganizationProfile): OnboardingState {
  const buildings =
    db
      .prepare<[string], { n: number }>(
        'SELECT COUNT(*) AS n FROM buildings WHERE organization_id = ?',
      )
      .get(profile.id)?.n ?? 0

  const unplaced =
    db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) AS n FROM buildings WHERE organization_id = ? AND jurisdiction = 'none'",
      )
      .get(profile.id)?.n ?? 0

  const connection =
    db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) AS n FROM espm_connections WHERE organization_id = ? AND status = 'connected'",
      )
      .get(profile.id)?.n ?? 0

  const members =
    db
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM users WHERE organization_id = ?')
      .get(profile.id)?.n ?? 0

  const steps: OnboardingStep[] = [
    {
      id: 'account',
      title: 'Create your account',
      detail: `${profile.name} is set up.`,
      done: true,
      action: null,
    },
    {
      id: 'connect-espm',
      title: 'Connect Portfolio Manager',
      detail:
        connection > 0
          ? 'Connected. Your properties sync from ENERGY STAR.'
          : 'Link your ENERGY STAR account, or share your properties with HBS.',
      done: connection > 0,
      action: { label: 'Connect', to: '/settings/connection' },
    },
    {
      id: 'buildings',
      title: 'Bring in your buildings',
      detail:
        buildings > 0
          ? `${buildings} building${buildings === 1 ? '' : 's'} in your portfolio.`
          : 'Nothing to measure yet — sync or add your first property.',
      done: buildings > 0,
      action: { label: 'View portfolio', to: '/' },
    },
    {
      id: 'jurisdictions',
      title: 'Confirm which standards apply',
      detail:
        buildings === 0
          ? 'Available once you have buildings.'
          : unplaced === 0
            ? 'Every building is matched to a BEPS jurisdiction.'
            : `${unplaced} building${unplaced === 1 ? ' has' : 's have'} no jurisdiction set.`,
      done: buildings > 0 && unplaced === 0,
      action: { label: 'Review buildings', to: '/' },
    },
    {
      id: 'invite',
      title: 'Invite your team',
      detail:
        members > 1
          ? `${members} people have access.`
          : 'Add the people who need to see this — engineering, finance, ownership.',
      done: members > 1,
      action: { label: 'Invite', to: '/settings/team' },
    },
  ]

  const completedCount = steps.filter((s) => s.done).length
  return { steps, complete: completedCount === steps.length, completedCount }
}
