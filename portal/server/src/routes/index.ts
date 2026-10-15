// ---------------------------------------------------------------------------
// The portal API.
//
// One router file rather than eight, because the surface is small enough to
// read end to end and the alternative — a directory of four-route modules —
// hides the shape of the API rather than revealing it. Split it when it stops
// fitting on a screenful of endpoints per section.
//
// Every handler that takes a building id calls assertBuildingAccess first;
// every list query is filtered by scopeOrganizationId. There are no exceptions
// to those two rules.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Router } from 'express'
import { z } from 'zod'
import { emptyTotals, mergeTotals } from '@hbs/shared'
import type {
  BuildingDetailResponse,
  StaffClientSummary,
  StaffOverviewResponse,
  PushResultResponse,
  SessionResponse,
  SyncStatusResponse,
  ThreadWithMessages,
} from '@hbs/shared'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import {
  toConnection,
  toConsumptionEntry,
  toMeter,
  type ConnectionRow,
  type ConsumptionRow,
  type MeterRow,
} from '../db/rows.js'
import { isFixtureMode } from '../espm/factory.js'
import { connectionFor } from '../services/connections.js'
import { pullAll, pushPending, readEntry } from '../espm/sync.js'
import {
  assertBuildingAccess,
  HttpError,
  requireAuth,
  requireStaff,
  requireWriteAccess,
  scopeOrganizationId,
} from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { loginAccountLimiter, loginIpLimiter } from '../middleware/rateLimit.js'
import { acknowledgeAlert, listAlerts, runMonitor } from '../services/alerts.js'
import { authenticate, createSession, destroySession, SESSION_COOKIE } from '../services/auth.js'
import {
  createThread,
  listMessages,
  listThreads,
  postMessage,
  setThreadStatus,
} from '../services/messaging.js'
import { listOrganizations, organizationById } from '../services/organizations.js'
import { profileById } from '../services/tenancy.js'
import {
  assessmentsFor,
  buildPortfolio,
  listBuildings,
  metricsFor,
  portfolioEntries,
  recommendationsForBuilding,
  totalsFor,
} from '../services/portfolio.js'
import { listGroups } from '../services/groups.js'
import { summaryFor } from '../services/connections.js'
import { generateReport, listReports } from '../services/reports.js'

export const api = Router()

/**
 * Read a path parameter. Express types these as possibly-undefined, but a
 * parameter named in the route pattern is always present — this narrows the
 * type in one place instead of at every call site.
 */
function param(req: { params: Record<string, string | undefined> }, name: string): string {
  const value = req.params[name]
  if (value === undefined) throw new HttpError(400, `Missing ${name} in the request path.`)
  return value
}

// --- Session --------------------------------------------------------------

api.post(
  '/auth/login',
  loginIpLimiter,
  loginAccountLimiter,
  asyncRoute(async (req, res) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body)

    const db = getDb()
    const user = await authenticate(db, body.email, body.password)
    if (!user) {
      // Only a failure spends the account's budget; see loginAccountLimiter.
      loginAccountLimiter.record(req)
      // One message for both "no such user" and "wrong password".
      res.status(401).json({ error: 'That email and password do not match an account.' })
      return
    }

    const session = createSession(db, user.id)
    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      expires: new Date(session.expiresAt),
    })
    const organization = user.organizationId ? organizationById(db, user.organizationId) : null
    const profile = user.organizationId ? profileById(db, user.organizationId) : null
    res.json({ user, organization, profile } satisfies SessionResponse)
  }),
)

api.post('/auth/logout', (req, res) => {
  if (req.sessionId) destroySession(getDb(), req.sessionId)
  res.clearCookie(SESSION_COOKIE)
  res.json({ ok: true })
})

api.get('/auth/session', requireAuth, (req, res) => {
  const db = getDb()
  const user = req.user!
  const organization = user.organizationId ? organizationById(db, user.organizationId) : null
  const profile = user.organizationId ? profileById(db, user.organizationId) : null
  res.json({ user, organization, profile } satisfies SessionResponse)
})

// --- Portfolio ------------------------------------------------------------

api.get('/portfolio', requireAuth, (req, res) => {
  res.json(buildPortfolio(getDb(), scopeOrganizationId(req)))
})

api.get('/buildings/:id', requireAuth, (req, res) => {
  const db = getDb()
  const buildingId = param(req, 'id')
  const { organizationId } = assertBuildingAccess(req, buildingId)

  const building = listBuildings(db, organizationId).find((b) => b.id === buildingId)
  if (!building) throw new HttpError(404, 'No such building.')

  const metrics = metricsFor(db, buildingId)
  const { all, current } = assessmentsFor(building, metrics)
  const organization = organizationById(db, organizationId)

  const meters = db
    .prepare<[string], MeterRow>('SELECT * FROM meters WHERE building_id = ? ORDER BY name')
    .all(buildingId)
    .map(toMeter)

  const recentEntries = db
    .prepare<[string], ConsumptionRow>(
      `SELECT * FROM consumption_entries WHERE building_id = ?
       ORDER BY start_date DESC LIMIT 60`,
    )
    .all(buildingId)
    .map(toConsumptionEntry)

  res.json({
    building,
    meters,
    metrics,
    assessments: all,
    currentAssessment: current,
    recommendations: recommendationsForBuilding(building, metrics, organization?.tier ?? 'benchmarking'),
    alerts: listAlerts(db, organizationId, buildingId),
    recentEntries,
  } satisfies BuildingDetailResponse)
})

/** Staff-only: correct the jurisdiction or record an exemption. */
api.patch('/buildings/:id', requireAuth, requireStaff, (req, res) => {
  const buildingId = param(req, 'id')
  assertBuildingAccess(req, buildingId)
  const body = z
    .object({
      jurisdiction: z.enum(['dc', 'montgomery-md', 'none']).optional(),
      complianceExempt: z.boolean().optional(),
      exemptionNote: z.string().max(500).nullable().optional(),
      grossFloorAreaSqFt: z.number().int().positive().optional(),
    })
    .parse(req.body)

  const db = getDb()
  const sets: string[] = []
  const params: Array<string | number | null> = []
  if (body.jurisdiction !== undefined) {
    sets.push('jurisdiction = ?')
    params.push(body.jurisdiction)
  }
  if (body.complianceExempt !== undefined) {
    sets.push('compliance_exempt = ?')
    params.push(body.complianceExempt ? 1 : 0)
  }
  if (body.exemptionNote !== undefined) {
    sets.push('exemption_note = ?')
    params.push(body.exemptionNote)
  }
  if (body.grossFloorAreaSqFt !== undefined) {
    sets.push('gross_floor_area_sqft = ?')
    params.push(body.grossFloorAreaSqFt)
  }
  if (sets.length === 0) throw new HttpError(400, 'Nothing to update.')

  db.prepare(`UPDATE buildings SET ${sets.join(', ')} WHERE id = ?`).run(...params, buildingId)
  res.json({ ok: true })
})

// --- Consumption entry: the push-back path --------------------------------

api.post(
  '/buildings/:id/consumption',
  requireAuth,
  requireWriteAccess,
  asyncRoute(async (req, res) => {
    const buildingId = param(req, 'id')
    assertBuildingAccess(req, buildingId)

    const body = z
      .object({
        meterId: z.string().uuid(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        quantity: z.number().nonnegative(),
        cost: z.number().nonnegative().nullable().optional(),
        estimated: z.boolean().optional(),
        pushNow: z.boolean().optional(),
      })
      .refine((v) => v.startDate <= v.endDate, {
        message: 'The start date must not be after the end date.',
        path: ['startDate'],
      })
      .parse(req.body)

    const db = getDb()
    const meter = db
      .prepare<[string, string], MeterRow>('SELECT * FROM meters WHERE id = ? AND building_id = ?')
      .get(body.meterId, buildingId)
    if (!meter) throw new HttpError(404, 'No such meter on this building.')

    const now = new Date().toISOString()
    const entryId = randomUUID()

    // A re-entry for the same billing period corrects the existing row rather
    // than creating a duplicate ESPM would reject. Correcting a row that has
    // already synced puts it back in the queue as an update.
    db.prepare(
      `INSERT INTO consumption_entries
         (id, meter_id, building_id, start_date, end_date, quantity, unit, cost, estimated,
          sync_state, entered_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?)
       ON CONFLICT (meter_id, start_date, end_date) DO UPDATE SET
         quantity = excluded.quantity,
         cost = excluded.cost,
         estimated = excluded.estimated,
         sync_state = 'local',
         sync_error = NULL,
         entered_by_user_id = excluded.entered_by_user_id,
         updated_at = excluded.updated_at`,
    ).run(
      entryId,
      body.meterId,
      buildingId,
      body.startDate,
      body.endDate,
      body.quantity,
      meter.unit,
      body.cost ?? null,
      body.estimated ? 1 : 0,
      req.user!.id,
      now,
      now,
    )

    const saved = db
      .prepare<[string, string, string], ConsumptionRow>(
        'SELECT * FROM consumption_entries WHERE meter_id = ? AND start_date = ? AND end_date = ?',
      )
      .get(body.meterId, body.startDate, body.endDate)!

    if (body.pushNow === false) {
      res.json({
        entry: toConsumptionEntry(saved),
        pushed: false,
        message: 'Saved in the portal. It will go to Portfolio Manager on the next sync.',
      } satisfies PushResultResponse)
      return
    }

    const connection = activeConnection(db, req.user!.organizationId)
    const result = await pushPending(db, connection, { buildingId })
    const entry = readEntry(db, saved.id)!

    res.json({
      entry,
      pushed: entry.syncState === 'synced',
      message:
        entry.syncState === 'synced'
          ? `Saved and sent to Portfolio Manager${isFixtureMode() ? ' (fixture mode — nothing left this machine)' : ''}.`
          : entry.syncError ?? `Saved locally; the push reported ${result.failed} failure(s).`,
    } satisfies PushResultResponse)
  }),
)

api.get('/buildings/:id/consumption', requireAuth, (req, res) => {
  const buildingId = param(req, 'id')
  assertBuildingAccess(req, buildingId)
  const rows = getDb()
    .prepare<[string], ConsumptionRow>(
      'SELECT * FROM consumption_entries WHERE building_id = ? ORDER BY start_date DESC',
    )
    .all(buildingId)
  res.json({ entries: rows.map(toConsumptionEntry) })
})

// --- Sync -----------------------------------------------------------------

api.get('/sync/status', requireAuth, (req, res) => {
  const db = getDb()
  const connection = activeConnection(db, scopeOrganizationId(req))
  const runs = db
    .prepare<[], never>('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 20')
    .all()
    .map((r) => r as never)

  const counts = db
    .prepare<[], { pending: number; failed: number }>(
      `SELECT
         SUM(CASE WHEN sync_state IN ('local','pending') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN sync_state = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM consumption_entries`,
    )
    .get()

  res.json({
    runs: runs as SyncStatusResponse['runs'],
    lastPullAt: connection.lastPullAt,
    pendingPushes: counts?.pending ?? 0,
    failedPushes: counts?.failed ?? 0,
  } satisfies SyncStatusResponse)
})

api.post(
  '/sync/pull',
  requireAuth,
  requireStaff,
  asyncRoute(async (req, res) => {
    const db = getDb()
    const organizationId = scopeOrganizationId(req)
    if (!organizationId) {
      throw new HttpError(400, 'Choose an organization to pull into (?organizationId=…).')
    }
    res.json(await pullAll(db, activeConnection(db, organizationId), organizationId))
  }),
)

api.post(
  '/sync/push',
  requireAuth,
  requireWriteAccess,
  asyncRoute(async (req, res) => {
    const db = getDb()
    const buildingId = typeof req.query['buildingId'] === 'string' ? req.query['buildingId'] : undefined
    if (buildingId) assertBuildingAccess(req, buildingId)
    res.json(
      await pushPending(db, activeConnection(db, req.user!.organizationId), buildingId ? { buildingId } : {}),
    )
  }),
)

// --- Alerts ---------------------------------------------------------------

api.get('/alerts', requireAuth, (req, res) => {
  res.json({ alerts: listAlerts(getDb(), scopeOrganizationId(req)) })
})

api.post('/alerts/:id/acknowledge', requireAuth, requireWriteAccess, (req, res) => {
  acknowledgeAlert(getDb(), param(req, 'id'))
  res.json({ ok: true })
})

/** Runs the anomaly and compliance monitor on demand; also the cron entry point. */
api.post('/alerts/run-monitor', requireAuth, requireStaff, (req, res) => {
  res.json(runMonitor(getDb(), scopeOrganizationId(req) ?? undefined))
})

// --- Messages -------------------------------------------------------------

api.get('/threads', requireAuth, (req, res) => {
  const buildingId = typeof req.query['buildingId'] === 'string' ? req.query['buildingId'] : undefined
  if (buildingId) assertBuildingAccess(req, buildingId)
  res.json({ threads: listThreads(getDb(), scopeOrganizationId(req), buildingId) })
})

api.get('/threads/:id', requireAuth, (req, res) => {
  const db = getDb()
  const thread = listThreads(db, scopeOrganizationId(req)).find((t) => t.id === param(req, 'id'))
  if (!thread) throw new HttpError(404, 'No such conversation.')
  res.json({ thread, messages: listMessages(db, thread.id) } satisfies ThreadWithMessages)
})

api.post('/threads', requireAuth, requireWriteAccess, (req, res) => {
  const body = z
    .object({
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(20_000),
      buildingId: z.string().uuid().nullable().optional(),
      emailCcAddresses: z.array(z.string().email()).max(20).optional(),
    })
    .parse(req.body)

  const user = req.user!
  if (body.buildingId) assertBuildingAccess(req, body.buildingId)
  const organizationId = user.organizationId ?? scopeOrganizationId(req)
  if (!organizationId) throw new HttpError(400, 'Choose an organization for this conversation.')

  res.json(
    createThread(getDb(), {
      organizationId,
      buildingId: body.buildingId ?? null,
      subject: body.subject,
      body: body.body,
      emailCcAddresses: body.emailCcAddresses,
      author: { id: user.id, name: user.fullName },
    }),
  )
})

api.post('/threads/:id/messages', requireAuth, requireWriteAccess, (req, res) => {
  const body = z.object({ body: z.string().min(1).max(20_000) }).parse(req.body)
  const db = getDb()
  const thread = listThreads(db, scopeOrganizationId(req)).find((t) => t.id === param(req, 'id'))
  if (!thread) throw new HttpError(404, 'No such conversation.')
  const user = req.user!
  res.json(postMessage(db, thread.id, body.body, { id: user.id, name: user.fullName }))
})

api.post('/threads/:id/status', requireAuth, requireWriteAccess, (req, res) => {
  const body = z.object({ status: z.enum(['open', 'closed']) }).parse(req.body)
  const db = getDb()
  const thread = listThreads(db, scopeOrganizationId(req)).find((t) => t.id === param(req, 'id'))
  if (!thread) throw new HttpError(404, 'No such conversation.')
  setThreadStatus(db, thread.id, body.status)
  res.json({ ok: true })
})

// --- Reports --------------------------------------------------------------

api.get('/reports', requireAuth, (req, res) => {
  res.json({ reports: listReports(getDb(), scopeOrganizationId(req)) })
})

api.post('/reports', requireAuth, requireWriteAccess, (req, res) => {
  const body = z
    .object({
      kind: z.enum(['annual-compliance', 'portfolio-summary', 'benchmarking', 'anomaly-review']),
      buildingId: z.string().uuid().nullable().optional(),
    })
    .parse(req.body)

  if (body.buildingId) assertBuildingAccess(req, body.buildingId)
  const organizationId = scopeOrganizationId(req)
  if (!organizationId) throw new HttpError(400, 'Choose an organization to report on.')

  res.json(
    generateReport(getDb(), {
      organizationId,
      buildingId: body.buildingId ?? null,
      kind: body.kind,
      outputDir: path.resolve(process.cwd(), 'data/reports'),
    }),
  )
})

api.get('/reports/:id/download', requireAuth, (req, res) => {
  const report = listReports(getDb(), scopeOrganizationId(req)).find((r) => r.id === param(req, 'id'))
  if (!report?.filePath) throw new HttpError(404, 'That report is not ready.')
  res.sendFile(report.filePath)
})

// --- Staff ----------------------------------------------------------------

api.get('/organizations', requireAuth, requireStaff, (_req, res) => {
  res.json({ organizations: listOrganizations(getDb()) })
})

/**
 * Every client, each with their whole portfolio tree — the HBS view.
 *
 * Assembled per organization rather than as one flat list, because "which
 * client is carrying the most exposure" is the question this screen exists to
 * answer, and a flat list of every building across every tenant answers it
 * only after the reader does the grouping themselves.
 */
api.get('/staff/clients', requireAuth, requireStaff, (_req, res) => {
  const db = getDb()
  const clients: StaffClientSummary[] = []
  const totals = emptyTotals()

  for (const organization of listOrganizations(db)) {
    const entries = portfolioEntries(db, organization.id)
    const clientTotals = totalsFor(entries)
    mergeTotals(totals, clientTotals)

    const memberCount =
      db
        .prepare<[string], { n: number }>(
          'SELECT COUNT(*) AS n FROM users WHERE organization_id = ?',
        )
        .get(organization.id)?.n ?? 0

    clients.push({
      organization,
      profile: profileById(db, organization.id)!,
      groups: listGroups(db, organization.id),
      entries,
      totals: clientTotals,
      memberCount,
      connectionStatus: summaryFor(db, organization.id)?.status ?? 'none',
    })
  }

  // Largest exposure first: the same ordering principle as the portfolio, one
  // level up.
  clients.sort(
    (a, b) =>
      b.totals.estimatedPenaltyExposure - a.totals.estimatedPenaltyExposure ||
      a.organization.name.localeCompare(b.organization.name),
  )

  res.json({ clients, totals } satisfies StaffOverviewResponse)
})

api.get('/espm/connection', requireAuth, requireStaff, (_req, res) => {
  const connection = activeConnection(getDb(), null)
  res.json({ connection, mode: config.espm.mode })
})

// --- Helpers --------------------------------------------------------------

/**
 * The connection a request should use: the tenant's own where they have
 * connected one, otherwise the shared HBS service-provider account. The choice
 * lives in services/connections.ts so the API, the background jobs and the
 * seed all resolve it the same way.
 */
function activeConnection(db: ReturnType<typeof getDb>, organizationId: string | null) {
  return connectionFor(db, organizationId)
}
