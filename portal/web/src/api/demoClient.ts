// ---------------------------------------------------------------------------
// The demo API: the portal, running entirely in the browser.
//
// This exists so the portal can be handed to someone as a single file — no
// terminal, no server, no ESPM account — the same way the BAS trainer ships a
// standalone build. It is not a mock of the API: `demo-data.json` holds the
// actual responses the real server produced from the seeded database, captured
// by driving the live endpoints. The UI cannot tell the difference, and the
// demo cannot drift from the application's real output.
//
// What it does add is mutation. Writes are applied to an in-memory copy so the
// interesting paths — entering a reading and watching it reach "Sent to ESPM",
// replying in a thread, dismissing an alert — actually work. Nothing persists
// past a refresh, which is the honest behaviour for a demo.
// ---------------------------------------------------------------------------

import type {
  AcceptInviteRequest,
  AuditEvent,
  AuditResponse,
  ConnectEspmRequest,
  CreateInvitationRequest,
  EspmConnectionSummary,
  Invitation,
  InvitePreview,
  OrganizationProfile,
  OrgOverviewResponse,
  PlanUsage,
  ServiceTier,
  SignupRequest,
  UpdateOrgRequest,
} from '@hbs/shared'
import { onboardingStepsFrom, planFor } from './demoPlatform'
import type {
  Alert,
  BuildingDetailResponse,
  ConsumptionEntry,
  CreateConsumptionRequest,
  CreateThreadRequest,
  Message,
  MessageThread,
  Organization,
  PortfolioResponse,
  PushResultResponse,
  ReportRecord,
  SessionResponse,
  SyncStatusResponse,
  ThreadWithMessages,
  User,
} from '@hbs/shared'
import { ApiError } from './error'
import rawData from './demo-data.json'

interface DemoUserRecord {
  session: SessionResponse
  portfolio: PortfolioResponse
  threadIds: string[]
  alerts: Alert[]
  reports: ReportRecord[]
  syncStatus: SyncStatusResponse | null
  organizations: Organization[]
}

interface DemoData {
  buildings: Record<string, BuildingDetailResponse>
  threads: Record<string, ThreadWithMessages>
  users: Record<string, DemoUserRecord>
  sampleReportHtml: string
}

/**
 * Tenant state the demo mutates: profiles, members, invitations, connections
 * and the audit trail. Seeded from the captured session data so the demo opens
 * on a plausible account rather than an empty one.
 */
interface DemoTenant {
  profile: OrganizationProfile
  members: User[]
  invitations: Invitation[]
  connection: EspmConnectionSummary | null
  audit: AuditEvent[]
}

/** The password the seed script sets on every demo account. */
export const DEMO_PASSWORD = 'PortalDemo123!'

/** Structural copy, so a reload of the page starts from the pristine dataset. */
const data = structuredClone(rawData as unknown as DemoData)

export const DEMO_ACCOUNTS = Object.entries(data.users).map(([email, record]) => ({
  email,
  name: record.session.user.fullName,
  role: record.session.user.role,
  organization: record.session.organization?.name ?? 'All organizations',
}))

let currentEmail: string | null = null
let nextEspmId = 950_000

/** Tenants, keyed by organization id, built from the captured session data. */
const tenants = new Map<string, DemoTenant>()

for (const [email, record] of Object.entries(data.users)) {
  const org = record.session.organization
  const profile = record.session.profile
  if (!org || !profile) continue
  const existing = tenants.get(org.id)
  if (existing) {
    if (!existing.members.some((m) => m.id === record.session.user.id)) {
      existing.members.push(record.session.user)
    }
    continue
  }
  tenants.set(org.id, {
    profile,
    members: [record.session.user],
    invitations: [],
    connection: {
      id: `conn-${org.id}`,
      label: `${org.name} — Portfolio Manager`,
      username: `${profile.slug.replace(/-/g, '_')}_esp`,
      environment: 'test',
      scope: profile.tier === 'benchmarking' ? 'shared-hbs' : 'own-account',
      status: 'connected',
      lastError: null,
      verifiedAt: profile.createdAt,
      lastPullAt: record.syncStatus?.lastPullAt ?? profile.createdAt,
    },
    audit: [
      {
        id: `audit-${org.id}-created`,
        organizationId: org.id,
        actorLabel: record.session.user.fullName,
        action: 'organization.created',
        targetType: 'organization',
        targetLabel: org.name,
        detail: null,
        createdAt: profile.createdAt,
      },
    ],
  })
  void email
}

function currentTenant(): DemoTenant {
  const record = requireUser()
  const orgId = record.session.organization?.id
  const tenant = orgId ? tenants.get(orgId) : undefined
  if (!tenant) {
    throw new ApiError('This is an account setting for a customer organization.', 403)
  }
  return tenant
}

function requireAdmin(): void {
  if (currentRole() !== 'customer_admin') {
    throw new ApiError('Only an account admin can change this.', 403)
  }
}

function logAudit(tenant: DemoTenant, action: string, targetLabel?: string, detail?: string): void {
  tenant.audit.unshift({
    id: uid(),
    organizationId: tenant.profile.id,
    actorLabel: requireUser().session.user.fullName,
    action,
    targetType: null,
    targetLabel: targetLabel ?? null,
    detail: detail ?? null,
    createdAt: now(),
  })
}

function requireUser(): DemoUserRecord {
  if (!currentEmail) throw new ApiError('Not signed in.', 401)
  const record = data.users[currentEmail]
  if (!record) throw new ApiError('Not signed in.', 401)
  return record
}

function currentRole(): User['role'] {
  return requireUser().session.user.role
}

/** Mirrors the server's read-only guard, so the demo refuses what the real one refuses. */
function requireWrite(): void {
  if (currentRole() === 'customer_viewer') {
    throw new ApiError('Your account has read-only access.', 403)
  }
}

function requireStaff(): void {
  if (currentRole() !== 'hbs_staff') {
    throw new ApiError('This action is restricted to HBS staff.', 403)
  }
}

const now = (): string => new Date().toISOString()
const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `demo-${Math.random().toString(36).slice(2)}-${Date.now()}`

/** A touch of latency, so loading states are visible rather than skipped. */
const settle = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 120))

export const demoApi = {
  login: async (email: string, password: string): Promise<SessionResponse> => {
    const key = Object.keys(data.users).find((e) => e.toLowerCase() === email.trim().toLowerCase())
    if (!key || password !== DEMO_PASSWORD) {
      throw new ApiError(
        'That email and password do not match an account.',
        401,
        `This is the static demo — use one of the listed accounts with the password ${DEMO_PASSWORD}.`,
      )
    }
    currentEmail = key
    return settle(data.users[key]!.session)
  },

  logout: async (): Promise<{ ok: true }> => {
    currentEmail = null
    return { ok: true }
  },

  session: async (): Promise<SessionResponse> => settle(requireUser().session),

  portfolio: async (organizationId?: string): Promise<PortfolioResponse> => {
    const record = requireUser()
    // Only staff may narrow to another organization; a customer's scope is
    // fixed, exactly as the server enforces it.
    if (currentRole() !== 'hbs_staff' || !organizationId) return settle(record.portfolio)
    const entries = record.portfolio.entries.filter(
      (e) => e.building.organizationId === organizationId,
    )
    return settle({ entries, totals: recomputeTotals(entries) })
  },

  building: async (id: string): Promise<BuildingDetailResponse> => {
    const record = requireUser()
    const visible = record.portfolio.entries.some((e) => e.building.id === id)
    const detail = data.buildings[id]
    // Same 404 for "does not exist" and "not yours", as the server does.
    if (!visible || !detail) throw new ApiError('No such building.', 404)
    // A fresh object, as the live API would produce. Handing back the same
    // reference makes a state update invisible to React and the screen stops
    // reflecting writes that did in fact happen.
    return settle(structuredClone(detail))
  },

  addConsumption: async (
    buildingId: string,
    body: CreateConsumptionRequest,
  ): Promise<PushResultResponse> => {
    requireWrite()
    const detail = data.buildings[buildingId]
    if (!detail) throw new ApiError('No such building.', 404)
    const meter = detail.meters.find((m) => m.id === body.meterId)
    if (!meter) throw new ApiError('No such meter on this building.', 404)
    if (body.startDate > body.endDate) {
      throw new ApiError('That request was not valid.', 400, 'The start date must not be after the end date.')
    }

    const entry: ConsumptionEntry = {
      id: uid(),
      meterId: body.meterId,
      buildingId,
      startDate: body.startDate,
      endDate: body.endDate,
      quantity: body.quantity,
      unit: meter.unit,
      cost: body.cost ?? null,
      estimated: body.estimated ?? false,
      espmConsumptionId: nextEspmId++,
      syncState: 'synced',
      syncError: null,
      enteredByUserId: requireUser().session.user.id,
      createdAt: now(),
      updatedAt: now(),
    }

    // Re-entering the same billing period corrects in place rather than
    // duplicating — the same conflict rule the server applies.
    const existing = detail.recentEntries.findIndex(
      (e) => e.meterId === entry.meterId && e.startDate === entry.startDate && e.endDate === entry.endDate,
    )
    if (existing >= 0) detail.recentEntries[existing] = entry
    else detail.recentEntries.unshift(entry)

    return settle({
      entry,
      pushed: true,
      message: 'Saved and sent to Portfolio Manager (demo — nothing left your browser).',
    })
  },

  consumption: async (buildingId: string): Promise<{ entries: ConsumptionEntry[] }> =>
    settle({ entries: data.buildings[buildingId]?.recentEntries ?? [] }),

  syncStatus: async (): Promise<SyncStatusResponse> => {
    const record = requireUser()
    return settle(
      record.syncStatus ?? { runs: [], lastPullAt: null, pendingPushes: 0, failedPushes: 0 },
    )
  },

  push: async (
    buildingId?: string,
  ): Promise<{ processed: number; failed: number; messages: string[] }> => {
    requireWrite()
    let processed = 0
    for (const detail of Object.values(data.buildings)) {
      if (buildingId && detail.building.id !== buildingId) continue
      for (const entry of detail.recentEntries) {
        if (entry.syncState === 'local' || entry.syncState === 'failed') {
          entry.syncState = 'synced'
          entry.espmConsumptionId = nextEspmId++
          entry.syncError = null
          processed++
        }
      }
    }
    return settle({ processed, failed: 0, messages: [] })
  },

  pull: async (): Promise<{ processed: number; failed: number; messages: string[] }> => {
    requireStaff()
    return settle({
      processed: 0,
      failed: 0,
      messages: ['This is the static demo — the data is already loaded and no request was made.'],
    })
  },

  alerts: async (): Promise<{ alerts: Alert[] }> => settle({ alerts: requireUser().alerts }),

  acknowledgeAlert: async (id: string): Promise<{ ok: true }> => {
    requireWrite()
    for (const record of Object.values(data.users)) {
      const alert = record.alerts.find((a) => a.id === id)
      if (alert) alert.acknowledgedAt = now()
    }
    for (const detail of Object.values(data.buildings)) {
      const alert = detail.alerts.find((a) => a.id === id)
      if (alert) alert.acknowledgedAt = now()
    }
    return { ok: true }
  },

  runMonitor: async (): Promise<{ created: number; updated: number; findings: string[] }> => {
    requireStaff()
    return settle({
      created: 0,
      updated: 0,
      findings: ['This is the static demo — the monitor has already run against the loaded data.'],
    })
  },

  threads: async (buildingId?: string): Promise<{ threads: MessageThread[] }> => {
    const record = requireUser()
    const threads = record.threadIds
      .map((id) => data.threads[id]?.thread)
      .filter((t): t is MessageThread => t !== undefined)
      .filter((t) => !buildingId || t.buildingId === buildingId)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    return settle({ threads })
  },

  thread: async (id: string): Promise<ThreadWithMessages> => {
    const record = requireUser()
    const thread = data.threads[id]
    if (!thread || !record.threadIds.includes(id)) {
      throw new ApiError('No such conversation.', 404)
    }
    return settle(thread)
  },

  createThread: async (body: CreateThreadRequest): Promise<MessageThread> => {
    requireWrite()
    const user = requireUser().session.user
    const id = uid()
    const thread: MessageThread = {
      id,
      organizationId: user.organizationId ?? 'demo-org',
      buildingId: body.buildingId ?? null,
      subject: body.subject,
      status: 'open',
      emailCcAddresses: (body.emailCcAddresses ?? []).map((a) => a.trim().toLowerCase()),
      createdByUserId: user.id,
      lastMessageAt: now(),
      createdAt: now(),
    }
    data.threads[id] = {
      thread,
      messages: [
        {
          id: uid(),
          threadId: id,
          authorUserId: user.id,
          authorEmail: null,
          authorName: user.fullName,
          body: body.body,
          channel: 'portal',
          createdAt: now(),
        },
      ],
    }
    requireUser().threadIds.unshift(id)
    return settle(thread)
  },

  postMessage: async (threadId: string, body: string): Promise<Message> => {
    requireWrite()
    const entry = data.threads[threadId]
    if (!entry) throw new ApiError('No such conversation.', 404)
    const user = requireUser().session.user
    const message: Message = {
      id: uid(),
      threadId,
      authorUserId: user.id,
      authorEmail: null,
      authorName: user.fullName,
      body,
      channel: 'portal',
      createdAt: now(),
    }
    entry.messages.push(message)
    entry.thread.lastMessageAt = message.createdAt
    entry.thread.status = 'open'
    return settle(message)
  },

  reports: async (): Promise<{ reports: ReportRecord[] }> => settle({ reports: requireUser().reports }),

  generateReport: async (
    kind: ReportRecord['kind'],
    buildingId?: string | null,
  ): Promise<ReportRecord> => {
    requireWrite()
    const record = requireUser()
    const report: ReportRecord = {
      id: uid(),
      organizationId: record.session.organization?.id ?? 'demo-org',
      buildingId: buildingId ?? null,
      kind,
      periodLabel: String(new Date().getUTCFullYear() - 1),
      status: 'ready',
      filePath: 'demo',
      generatedAt: now(),
      createdAt: now(),
    }
    record.reports.unshift(report)
    return settle(report)
  },

  /** Every generated report renders the one captured sample in the demo. */
  reportHtml: async (): Promise<string> => settle(data.sampleReportHtml),

  organizations: async (): Promise<{ organizations: Organization[] }> => {
    requireStaff()
    return settle({ organizations: requireUser().organizations })
  },

  // --- Platform ------------------------------------------------------------

  signup: async (): Promise<SessionResponse> => {
    // Creating a real tenant would need a server. Saying so beats a form that
    // appears to work and silently does nothing.
    throw new ApiError(
      'Sign-up is not available in the static demo.',
      400,
      'Use one of the demo accounts on the sign-in screen.',
    )
  },

  invitePreview: async (): Promise<InvitePreview> => {
    throw new ApiError('Invitation links are not available in the static demo.', 404)
  },

  acceptInvite: async (): Promise<SessionResponse> => {
    throw new ApiError('Invitation links are not available in the static demo.', 404)
  },

  org: async (): Promise<OrgOverviewResponse> => {
    const tenant = currentTenant()
    const record = requireUser()
    const buildings = record.portfolio.entries.length
    const plan = planFor(tenant.profile.tier)

    const usage: PlanUsage = {
      plan,
      status: tenant.profile.planStatus,
      trialEndsAt: tenant.profile.trialEndsAt,
      buildings,
      users: tenant.members.length,
      exceeded: [
        ...(plan.limits.maxBuildings !== null && buildings > plan.limits.maxBuildings
          ? [`${buildings} buildings against a ${plan.name} limit of ${plan.limits.maxBuildings}.`]
          : []),
        ...(plan.limits.maxUsers !== null && tenant.members.length > plan.limits.maxUsers
          ? [`${tenant.members.length} people against a ${plan.name} limit of ${plan.limits.maxUsers}.`]
          : []),
      ],
    }

    const steps = onboardingStepsFrom({
      organizationName: tenant.profile.name,
      connected: tenant.connection?.status === 'connected',
      buildings,
      unplaced: record.portfolio.entries.filter((e) => e.building.jurisdiction === 'none').length,
      members: tenant.members.length,
    })

    return settle({
      profile: tenant.profile,
      usage,
      onboarding: {
        steps,
        complete: steps.every((s) => s.done),
        completedCount: steps.filter((s) => s.done).length,
      },
      members: tenant.members,
      invitations: currentRole() === 'customer_admin' ? tenant.invitations : [],
      connection: tenant.connection,
    })
  },

  updateOrg: async (body: UpdateOrgRequest): Promise<OrganizationProfile> => {
    const tenant = currentTenant()
    requireAdmin()
    if (body.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(body.accentColor)) {
      throw new ApiError('Accent colour must be a hex value such as #0B5D66.', 400)
    }
    tenant.profile = {
      ...tenant.profile,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.billingEmail !== undefined ? { billingEmail: body.billingEmail } : {}),
      ...(body.accentColor !== undefined ? { accentColor: body.accentColor.toUpperCase() } : {}),
      ...(body.logoMark !== undefined ? { logoMark: body.logoMark } : {}),
    }
    // The session carries the profile, so the shell picks up branding at once.
    requireUser().session = { ...requireUser().session, profile: tenant.profile }
    logAudit(tenant, 'organization.updated', tenant.profile.name)
    return settle(tenant.profile)
  },

  createInvitation: async (body: CreateInvitationRequest): Promise<Invitation> => {
    const tenant = currentTenant()
    requireAdmin()
    const email = body.email.trim().toLowerCase()
    if (tenant.members.some((m) => m.email.toLowerCase() === email)) {
      throw new ApiError('That person is already on your team.', 400)
    }
    // Re-inviting supersedes anything outstanding, as the server does.
    for (const existing of tenant.invitations) {
      if (existing.email === email && existing.state === 'pending') existing.state = 'revoked'
    }
    const invitation: Invitation = {
      id: uid(),
      organizationId: tenant.profile.id,
      email,
      role: body.role,
      state: 'pending',
      invitedByName: requireUser().session.user.fullName,
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      acceptedAt: null,
      createdAt: now(),
      inviteUrl: `https://portal.example/invite/${uid()}`,
    }
    tenant.invitations.unshift(invitation)
    logAudit(tenant, 'member.invited', email, body.role === 'customer_admin' ? 'as an admin' : 'as a viewer')
    return settle(invitation)
  },

  revokeInvitation: async (id: string): Promise<{ ok: true }> => {
    const tenant = currentTenant()
    requireAdmin()
    const invitation = tenant.invitations.find((i) => i.id === id)
    if (!invitation) throw new ApiError('No such invitation.', 404)
    invitation.state = 'revoked'
    logAudit(tenant, 'member.invite_revoked', invitation.email)
    return { ok: true }
  },

  changeMemberRole: async (
    id: string,
    role: 'customer_admin' | 'customer_viewer',
  ): Promise<{ ok: true }> => {
    const tenant = currentTenant()
    requireAdmin()
    const member = tenant.members.find((m) => m.id === id)
    if (!member) throw new ApiError('No such team member.', 404)
    if (member.role === 'customer_admin' && role !== 'customer_admin') {
      assertNotLastAdmin(tenant, member.id)
    }
    const previous = member.role
    member.role = role
    logAudit(tenant, 'member.role_changed', member.email, `${previous} → ${role}`)
    return { ok: true }
  },

  removeMember: async (id: string): Promise<{ ok: true }> => {
    const tenant = currentTenant()
    requireAdmin()
    const member = tenant.members.find((m) => m.id === id)
    if (!member) throw new ApiError('No such team member.', 404)
    if (member.id === requireUser().session.user.id) {
      throw new ApiError('You cannot remove your own account.', 400)
    }
    if (member.role === 'customer_admin') assertNotLastAdmin(tenant, member.id)
    tenant.members = tenant.members.filter((m) => m.id !== id)
    logAudit(tenant, 'member.removed', member.email)
    return { ok: true }
  },

  connectEspm: async (body: ConnectEspmRequest): Promise<EspmConnectionSummary> => {
    const tenant = currentTenant()
    requireAdmin()
    if (!planFor(tenant.profile.tier).limits.ownEspmConnection) {
      throw new ApiError(
        `Connecting your own ENERGY STAR account is part of the Compliance plan.`,
        402,
      )
    }
    tenant.connection = {
      id: tenant.connection?.id ?? uid(),
      label: `${tenant.profile.name} — Portfolio Manager`,
      username: body.username,
      environment: body.environment,
      scope: 'own-account',
      status: 'connected',
      lastError: null,
      verifiedAt: now(),
      lastPullAt: tenant.connection?.lastPullAt ?? null,
    }
    logAudit(tenant, 'espm.connected', body.username, `${body.environment} environment`)
    return settle(tenant.connection)
  },

  disconnectEspm: async (): Promise<{ ok: true }> => {
    const tenant = currentTenant()
    requireAdmin()
    if (!tenant.connection) throw new ApiError('There is no connection to remove.', 404)
    logAudit(tenant, 'espm.disconnected', tenant.connection.username)
    tenant.connection = null
    return { ok: true }
  },

  requestPlan: async (tier: ServiceTier): Promise<{ ok: true; message: string }> => {
    const tenant = currentTenant()
    requireAdmin()
    logAudit(tenant, 'plan.change_requested', tier)
    return settle({
      ok: true as const,
      message:
        'Thanks — we have your request and someone from HBS will confirm the change and the billing details.',
    })
  },

  audit: async (): Promise<AuditResponse> => {
    const tenant = currentTenant()
    requireAdmin()
    return settle({ events: tenant.audit })
  },
}

/**
 * An organization with no admin is unrecoverable by its own people, so the
 * demo refuses it exactly as the server does.
 */
function assertNotLastAdmin(tenant: DemoTenant, excludingId: string): void {
  const others = tenant.members.filter((m) => m.role === 'customer_admin' && m.id !== excludingId)
  if (others.length === 0) {
    throw new ApiError(
      'This is the only admin on the account. Make someone else an admin first.',
      400,
    )
  }
}

/** Kept in step with the server's totalsFor, for the staff organization filter. */
function recomputeTotals(entries: PortfolioResponse['entries']): PortfolioResponse['totals'] {
  const totals: PortfolioResponse['totals'] = {
    buildings: entries.length,
    totalSqFt: 0,
    compliant: 0,
    atRisk: 0,
    nonCompliant: 0,
    insufficientData: 0,
    estimatedPenaltyExposure: 0,
    exposureVerified: true,
  }
  for (const { building, assessment } of entries) {
    totals.totalSqFt += building.grossFloorAreaSqFt
    if (assessment?.status === 'compliant') totals.compliant++
    else if (assessment?.status === 'at-risk') totals.atRisk++
    else if (assessment?.status === 'non-compliant') totals.nonCompliant++
    else if (assessment?.status === 'insufficient-data') totals.insufficientData++

    const penalty = assessment?.estimatedPenalty
    if (penalty) {
      totals.estimatedPenaltyExposure += penalty.amount
      if (!penalty.verified) totals.exposureVerified = false
    }
  }
  return totals
}
