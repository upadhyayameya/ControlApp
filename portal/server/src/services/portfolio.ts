// ---------------------------------------------------------------------------
// Reading the portfolio: buildings joined to their metrics, judged against
// BEPS, and totalled.
//
// The compliance verdict is computed on every read rather than stored. That
// costs microseconds and buys correctness: when a standard is corrected in
// shared/beps/standards.ts, every screen is right on the next refresh with no
// backfill and no stale rows.
// ---------------------------------------------------------------------------

import {
  assessBuildingAllCycles,
  currentAssessment,
  recommendationsFor,
  type Building,
  type ComplianceAssessment,
  type MetricYear,
  type PortfolioEntry,
  type PortfolioResponse,
  type PortfolioTotals,
  type Recommendation,
  type ServiceTier,
} from '@hbs/shared'
import type { Db } from '../db/index.js'
import {
  toBuilding,
  toMetricYear,
  type BuildingRow,
  type MetricYearRow,
} from '../db/rows.js'

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function listBuildings(db: Db, organizationId: string | null): Building[] {
  const rows = organizationId
    ? db
        .prepare<[string], BuildingRow>(
          'SELECT * FROM buildings WHERE organization_id = ? ORDER BY name',
        )
        .all(organizationId)
    : db.prepare<[], BuildingRow>('SELECT * FROM buildings ORDER BY name').all()
  return rows.map(toBuilding)
}

export function metricsFor(db: Db, buildingId: string): MetricYear[] {
  return db
    .prepare<[string], MetricYearRow>(
      'SELECT * FROM metric_years WHERE building_id = ? ORDER BY year',
    )
    .all(buildingId)
    .map(toMetricYear)
}

/** The most recent year we have anything for. Drives every headline number. */
export function latestMetric(metrics: MetricYear[]): MetricYear | null {
  return metrics.length === 0 ? null : (metrics[metrics.length - 1] ?? null)
}

export function buildPortfolio(db: Db, organizationId: string | null): PortfolioResponse {
  const buildings = listBuildings(db, organizationId)
  const now = today()

  const entries: PortfolioEntry[] = buildings.map((building) => {
    const metrics = metricsFor(db, building.id)
    const latest = latestMetric(metrics)
    return {
      building,
      latestMetric: latest,
      assessment: currentAssessment(building, latest, now),
      openAlerts: countOpenAlerts(db, building.id),
    }
  })

  return { entries, totals: totalsFor(entries) }
}

function countOpenAlerts(db: Db, buildingId: string): number {
  const row = db
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM alerts WHERE building_id = ? AND acknowledged_at IS NULL',
    )
    .get(buildingId)
  return row?.n ?? 0
}

export function totalsFor(entries: PortfolioEntry[]): PortfolioTotals {
  const totals: PortfolioTotals = {
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
    switch (assessment?.status) {
      case 'compliant':
        totals.compliant++
        break
      case 'at-risk':
        totals.atRisk++
        break
      case 'non-compliant':
        totals.nonCompliant++
        break
      case 'insufficient-data':
        totals.insufficientData++
        break
      default:
        // 'exempt' and buildings with no jurisdiction are counted in none of
        // the compliance buckets — they are not at risk of anything.
        break
    }

    const penalty = assessment?.estimatedPenalty
    if (penalty) {
      totals.estimatedPenaltyExposure += penalty.amount
      // One unverified constant makes the whole total unverified. The UI shows
      // a range and a caveat rather than a number that looks like a quote.
      if (!penalty.verified) totals.exposureVerified = false
    }
  }

  return totals
}

export function assessmentsFor(
  building: Building,
  metrics: MetricYear[],
): { all: ComplianceAssessment[]; current: ComplianceAssessment | null } {
  const latest = latestMetric(metrics)
  return {
    all: assessBuildingAllCycles(building, latest),
    current: currentAssessment(building, latest, today()),
  }
}

/**
 * A building counts as missing data when its latest year has no energy figure
 * at all, or when the most recent year we hold is more than one year stale.
 * Both are reasons a benchmarking submission would be rejected.
 */
export function hasMissingData(metrics: MetricYear[]): boolean {
  const latest = latestMetric(metrics)
  if (!latest) return true
  if (latest.siteEui === null && latest.totalSiteEnergyKbtu === null) return true
  return latest.year < new Date().getUTCFullYear() - 2
}

export function recommendationsForBuilding(
  building: Building,
  metrics: MetricYear[],
  tier: ServiceTier,
): Recommendation[] {
  const assessment = currentAssessment(building, latestMetric(metrics), today())
  if (!assessment) return []
  return recommendationsFor(assessment, tier, hasMissingData(metrics))
}
