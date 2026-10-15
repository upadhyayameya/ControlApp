// ---------------------------------------------------------------------------
// The monitor: what the portal notices on its own.
//
// This is the "twice a month, check the data for anomalies and usage spikes"
// job from the notes, plus the compliance and deadline watching a customer
// would otherwise have to remember. `runMonitor` is idempotent — every finding
// has a stable dedupe key, so running it hourly or monthly produces the same
// alert list, updated rather than duplicated.
//
// Anomaly detection is deliberately simple and explainable: a reading is
// flagged against the same month in previous years (which controls for
// weather and occupancy far better than comparing to last month) using a
// median and a robust spread. A building manager can check the claim by hand,
// which matters more here than statistical sophistication.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { cyclesFor, currentAssessment, type Alert, type AlertSeverity } from '@hbs/shared'
import type { Db } from '../db/index.js'
import { toAlert, type AlertRow, type ConsumptionRow, type MeterRow } from '../db/rows.js'
import { listBuildings, metricsFor, latestMetric, today } from './portfolio.js'

/** A reading this many robust deviations from its seasonal norm is flagged. */
const SPIKE_THRESHOLD = 3.5
/** Below this many prior samples for a month, we do not have a norm to judge against. */
const MIN_SAMPLES = 2
/** Warn this far ahead of a compliance deadline. */
const DEADLINE_WARNING_DAYS = 365

export interface MonitorResult {
  created: number
  updated: number
  findings: string[]
}

export function runMonitor(db: Db, organizationId?: string): MonitorResult {
  const result: MonitorResult = { created: 0, updated: 0, findings: [] }
  const buildings = listBuildings(db, organizationId ?? null)

  for (const building of buildings) {
    const metrics = metricsFor(db, building.id)
    const latest = latestMetric(metrics)

    // --- Compliance shortfall ---
    const assessment = currentAssessment(building, latest, today())
    if (assessment?.status === 'non-compliant') {
      const penalty = assessment.estimatedPenalty
      const money = penalty
        ? ` Estimated exposure ${usd(penalty.low)}–${usd(penalty.high)}${
            penalty.verified ? '' : ' (provisional — penalty rates pending verification)'
          }.`
        : ''
      upsert(db, result, {
        organizationId: building.organizationId,
        buildingId: building.id,
        kind: 'compliance-shortfall',
        severity: 'critical',
        title: `${building.name} is below the ${cycleNoun(assessment.cycleLabel)}`,
        detail:
          `Current ${assessment.metric.replace(/-/g, ' ')} is ${fmt(assessment.currentValue)} against a ` +
          `target of ${fmt(assessment.targetValue)}, due ${assessment.complianceDate}.${money}`,
        dedupeKey: `compliance:${building.id}:${assessment.cycleId}`,
      })
    } else if (assessment?.status === 'at-risk') {
      upsert(db, result, {
        organizationId: building.organizationId,
        buildingId: building.id,
        kind: 'compliance-shortfall',
        severity: 'warning',
        title: `${building.name} is only just meeting the ${cycleNoun(assessment.cycleLabel)}`,
        detail:
          `It clears the target of ${fmt(assessment.targetValue)} with very little margin. ` +
          'A single bad year would put it over.',
        dedupeKey: `compliance:${building.id}:${assessment.cycleId}`,
      })
    }

    // --- Missing or stale data ---
    if (!latest) {
      upsert(db, result, {
        organizationId: building.organizationId,
        buildingId: building.id,
        kind: 'missing-data',
        severity: 'warning',
        title: `${building.name} has no benchmarking data`,
        detail: 'No annual metrics are on record, so this building cannot be assessed or reported.',
        dedupeKey: `missing:${building.id}`,
      })
    } else if (latest.year < new Date().getUTCFullYear() - 2) {
      upsert(db, result, {
        organizationId: building.organizationId,
        buildingId: building.id,
        kind: 'missing-data',
        severity: 'warning',
        title: `${building.name} data is ${new Date().getUTCFullYear() - latest.year} years out of date`,
        detail: `The most recent full year on record is ${latest.year}. Benchmarking submissions need current data.`,
        dedupeKey: `stale:${building.id}`,
      })
    }

    // --- Deadlines ---
    for (const cycle of cyclesFor(building.jurisdiction)) {
      const days = daysUntil(cycle.complianceDate)
      if (days > 0 && days <= DEADLINE_WARNING_DAYS && building.grossFloorAreaSqFt >= cycle.coverageMinSqFt) {
        upsert(db, result, {
          organizationId: building.organizationId,
          buildingId: building.id,
          kind: 'deadline-approaching',
          severity: days <= 90 ? 'warning' : 'info',
          title: `${building.name}: ${cycle.label} deadline in ${Math.round(days)} days`,
          detail: `${building.name} must meet the standard by ${cycle.complianceDate}.`,
          dedupeKey: `deadline:${building.id}:${cycle.id}`,
        })
      }
    }

    // --- Consumption anomalies ---
    for (const finding of detectAnomalies(db, building.id)) {
      upsert(db, result, {
        organizationId: building.organizationId,
        buildingId: building.id,
        kind: 'usage-spike',
        severity: 'warning',
        title: `Unusual usage on ${finding.meterName}`,
        detail: finding.detail,
        dedupeKey: `spike:${finding.entryId}`,
      })
    }
  }

  // --- Failed pushes ---
  for (const row of failedPushes(db, organizationId)) {
    upsert(db, result, {
      organizationId: row.organization_id,
      buildingId: row.building_id,
      kind: 'sync-failure',
      severity: 'warning',
      title: `${row.n} entr${row.n === 1 ? 'y' : 'ies'} failed to reach Portfolio Manager`,
      detail: 'Open the building’s data tab to see the reason and retry.',
      dedupeKey: `syncfail:${row.building_id}`,
    })
  }

  return result
}

// --- Anomaly detection ----------------------------------------------------

interface AnomalyFinding {
  entryId: string
  meterName: string
  detail: string
}

/**
 * Compare each reading against the same calendar month in other years.
 *
 * Median and MAD rather than mean and standard deviation, because a single
 * genuine spike would otherwise inflate the spread enough to hide itself.
 */
export function detectAnomalies(db: Db, buildingId: string): AnomalyFinding[] {
  const meters = db
    .prepare<[string], MeterRow>('SELECT * FROM meters WHERE building_id = ? AND active = 1')
    .all(buildingId)

  const findings: AnomalyFinding[] = []

  for (const meter of meters) {
    const entries = db
      .prepare<[string], ConsumptionRow>(
        'SELECT * FROM consumption_entries WHERE meter_id = ? ORDER BY start_date',
      )
      .all(meter.id)

    // Bucket by calendar month so each reading is judged against its own season.
    const byMonth = new Map<number, ConsumptionRow[]>()
    for (const entry of entries) {
      const month = Number(entry.start_date.slice(5, 7))
      const list = byMonth.get(month) ?? []
      list.push(entry)
      byMonth.set(month, list)
    }

    for (const [month, rows] of byMonth) {
      if (rows.length < MIN_SAMPLES + 1) continue
      const usages = rows.map((r) => r.quantity)
      const med = median(usages)
      const mad = median(usages.map((u) => Math.abs(u - med)))
      // A perfectly flat history has zero spread; fall back to a 15% band so a
      // genuine step change is still caught without flagging rounding noise.
      const spread = mad > 0 ? mad * 1.4826 : med * 0.15
      if (spread <= 0) continue

      for (const row of rows) {
        const deviations = (row.quantity - med) / spread
        if (deviations < SPIKE_THRESHOLD) continue
        const pct = med > 0 ? ((row.quantity - med) / med) * 100 : 0
        findings.push({
          entryId: row.id,
          meterName: meter.name,
          detail:
            `${row.start_date} to ${row.end_date} used ${fmtNum(row.quantity)} ${meter.unit}, ` +
            `about ${Math.round(pct)}% above the usual ${monthName(month)} figure of ` +
            `${fmtNum(med)}. Worth checking for a billing error, a stuck override, or equipment left running.`,
        })
      }
    }
  }

  return findings
}

// --- Alert storage --------------------------------------------------------

interface UpsertInput {
  organizationId: string
  buildingId: string | null
  kind: Alert['kind']
  severity: AlertSeverity
  title: string
  detail: string
  dedupeKey: string
}

/**
 * Insert or refresh one alert.
 *
 * An existing alert keeps its acknowledgement unless its wording changed —
 * re-acknowledging the same unchanged condition every fortnight would train
 * people to ignore the list, but a materially different message deserves to be
 * seen again.
 */
function upsert(db: Db, result: MonitorResult, input: UpsertInput): void {
  const existing = db
    .prepare<[string], AlertRow>('SELECT * FROM alerts WHERE dedupe_key = ?')
    .get(input.dedupeKey)

  if (!existing) {
    db.prepare(
      `INSERT INTO alerts (id, organization_id, building_id, kind, severity, title, detail, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.organizationId,
      input.buildingId,
      input.kind,
      input.severity,
      input.title,
      input.detail,
      input.dedupeKey,
      new Date().toISOString(),
    )
    result.created++
    result.findings.push(input.title)
    return
  }

  const changed = existing.title !== input.title || existing.detail !== input.detail
  db.prepare(
    `UPDATE alerts SET severity = ?, title = ?, detail = ?, acknowledged_at = ? WHERE id = ?`,
  ).run(
    input.severity,
    input.title,
    input.detail,
    changed ? null : existing.acknowledged_at,
    existing.id,
  )
  if (changed) {
    result.updated++
    result.findings.push(input.title)
  }
}

export function listAlerts(db: Db, organizationId: string | null, buildingId?: string): Alert[] {
  const clauses: string[] = []
  const params: string[] = []
  if (organizationId) {
    clauses.push('organization_id = ?')
    params.push(organizationId)
  }
  if (buildingId) {
    clauses.push('building_id = ?')
    params.push(buildingId)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return db
    .prepare<string[], AlertRow>(
      `SELECT * FROM alerts ${where} ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         created_at DESC`,
    )
    .all(...params)
    .map(toAlert)
}

export function acknowledgeAlert(db: Db, alertId: string): void {
  db.prepare('UPDATE alerts SET acknowledged_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    alertId,
  )
}

function failedPushes(db: Db, organizationId?: string) {
  return db
    .prepare<string[], { organization_id: string; building_id: string; n: number }>(
      `SELECT b.organization_id, c.building_id, COUNT(*) AS n
       FROM consumption_entries c
       JOIN buildings b ON b.id = c.building_id
       WHERE c.sync_state = 'failed'
         ${organizationId ? 'AND b.organization_id = ?' : ''}
       GROUP BY c.building_id`,
    )
    .all(...(organizationId ? [organizationId] : []))
}

// --- Formatting -----------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

/**
 * Cycle labels are inconsistent about whether they already say "standard"
 * ("DC BEPS Cycle 1" does not, "Montgomery County Final Standard (2035)"
 * does), so append the word only when it is missing.
 */
function cycleNoun(cycleLabel: string): string {
  return /standard/i.test(cycleLabel) ? cycleLabel : `${cycleLabel} standard`
}

function daysUntil(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - Date.now()) / 86_400_000
}

function fmt(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 10) / 10)
}

function fmtNum(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function monthName(month: number): string {
  return (
    [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ][month - 1] ?? `month ${month}`
  )
}
