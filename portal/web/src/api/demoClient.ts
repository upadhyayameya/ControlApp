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
    return settle(detail)
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
