// ---------------------------------------------------------------------------
// The compliance engine: metrics + a standard → a verdict, a gap, and money.
//
// Pure functions only. No database, no clock reads except what is passed in.
// That is deliberate — the same code runs in the API, in the background
// monitoring tools, and in the browser when the customer plays with a
// what-if slider, and all three must agree to the cent.
// ---------------------------------------------------------------------------

import type {
  Building,
  ComplianceAssessment,
  ComplianceStatus,
  MetricYear,
  PenaltyEstimate,
} from '../types.js'
import {
  type BepsCycle,
  type BepsStandard,
  type PenaltyModel,
  type PenaltySchedule,
  cyclesFor,
  penaltyFor,
  standardFor,
} from './standards.js'

/**
 * How close to the target still counts as "at risk" rather than compliant.
 * A building sitting within this band has met the standard on paper but has
 * no margin — one bad winter puts it over, and that is worth flagging.
 */
const AT_RISK_MARGIN_PCT = 5

/** Judge one building against one cycle. */
export function assessBuilding(
  building: Building,
  metric: MetricYear | null,
  cycle: BepsCycle,
): ComplianceAssessment {
  const base = {
    buildingId: building.id,
    jurisdiction: building.jurisdiction,
    cycleId: cycle.id,
    cycleLabel: cycle.label,
    complianceDate: cycle.complianceDate,
  }

  if (building.complianceExempt) {
    return {
      ...base,
      status: 'exempt',
      metric: 'site-eui',
      targetValue: null,
      currentValue: null,
      gap: null,
      percentOfTarget: null,
      estimatedPenalty: null,
      notes: [building.exemptionNote ?? 'Marked exempt from BEPS in the portal.'],
    }
  }

  if (building.grossFloorAreaSqFt < cycle.coverageMinSqFt) {
    return {
      ...base,
      status: 'exempt',
      metric: 'site-eui',
      targetValue: null,
      currentValue: null,
      gap: null,
      percentOfTarget: null,
      estimatedPenalty: null,
      notes: [
        `${fmtSqFt(building.grossFloorAreaSqFt)} ft² is below the ${fmtSqFt(
          cycle.coverageMinSqFt,
        )} ft² coverage threshold for ${cycle.label}.`,
      ],
    }
  }

  const standard = standardFor(building.jurisdiction, cycle.id, building.propertyType)
  if (!standard) {
    return {
      ...base,
      status: 'insufficient-data',
      metric: 'site-eui',
      targetValue: null,
      currentValue: null,
      gap: null,
      percentOfTarget: null,
      estimatedPenalty: null,
      notes: [`No ${cycle.label} standard is on file for property type "${building.propertyType}".`],
    }
  }

  const currentValue = readMetric(metric, standard.metric)
  if (currentValue === null) {
    return {
      ...base,
      status: 'insufficient-data',
      metric: standard.metric,
      targetValue: standard.targetValue,
      currentValue: null,
      gap: null,
      percentOfTarget: null,
      estimatedPenalty: null,
      notes: [
        `No ${metricLabel(standard.metric)} on record${
          metric ? ` for ${metric.year}` : ''
        }. Enter or sync a full year of energy data to see this building's standing.`,
      ],
    }
  }

  const { gap, gapPct, status } = compare(currentValue, standard)
  const notes: string[] = []
  if (standard.note) notes.push(standard.note)
  if (standard.verification !== 'verified') {
    notes.push('Target value is provisional and pending verification against the published rule.')
  }
  if (metric && metric.source === 'portal-entry') {
    notes.push(
      `Based on data entered in the portal for ${metric.year}; ESPM may recompute this once it processes the entry.`,
    )
  }

  const schedule = penaltyFor(building.jurisdiction, cycle.id)
  const estimatedPenalty =
    status === 'non-compliant' && schedule
      ? estimatePenalty(building.grossFloorAreaSqFt, gapPct ?? 0, schedule)
      : null

  return {
    ...base,
    status,
    metric: standard.metric,
    targetValue: standard.targetValue,
    currentValue,
    gap,
    percentOfTarget: percentOfTarget(currentValue, standard),
    estimatedPenalty,
    notes,
  }
}

/** Every cycle that applies to this building, soonest compliance date first. */
export function assessBuildingAllCycles(
  building: Building,
  metric: MetricYear | null,
): ComplianceAssessment[] {
  return cyclesFor(building.jurisdiction)
    .map((cycle) => assessBuilding(building, metric, cycle))
    .sort((a, b) => a.complianceDate.localeCompare(b.complianceDate))
}

/**
 * The cycle the customer should actually be looking at: the next one whose
 * compliance date has not passed. Falls back to the last cycle so a building
 * past every deadline still shows something.
 */
export function currentAssessment(
  building: Building,
  metric: MetricYear | null,
  today: string,
): ComplianceAssessment | null {
  const all = assessBuildingAllCycles(building, metric)
  if (all.length === 0) return null
  return all.find((a) => a.complianceDate >= today) ?? all[all.length - 1] ?? null
}

// --- Internals ------------------------------------------------------------

function readMetric(metric: MetricYear | null, which: BepsStandard['metric']): number | null {
  if (!metric) return null
  switch (which) {
    case 'energy-star-score':
      return metric.energyStarScore
    case 'site-eui':
      // Weather-normalized site EUI is the fairer comparison when we have it —
      // it is what a jurisdiction uses to avoid penalising a cold year.
      return metric.weatherNormalizedSiteEui ?? metric.siteEui
    case 'source-eui':
      return metric.sourceEui
    case 'ghg-intensity':
      return metric.ghgIntensity
  }
}

interface Comparison {
  /** Signed distance to target in the metric's units; positive = falling short. */
  gap: number
  /** Shortfall as a percent of the target; 0 when compliant. */
  gapPct: number | null
  status: ComplianceStatus
}

function compare(current: number, standard: BepsStandard): Comparison {
  const target = standard.targetValue
  // Normalise both directions to "positive gap means the building is short".
  const gap = standard.direction === 'at-or-above' ? target - current : current - target

  if (gap > 0) {
    const gapPct = target === 0 ? 100 : (gap / Math.abs(target)) * 100
    return { gap, gapPct, status: 'non-compliant' }
  }

  // Compliant. Decide whether the margin is thin enough to call at-risk.
  const marginPct = target === 0 ? 100 : (Math.abs(gap) / Math.abs(target)) * 100
  return {
    gap,
    gapPct: null,
    status: marginPct <= AT_RISK_MARGIN_PCT ? 'at-risk' : 'compliant',
  }
}

/**
 * Percent of the target achieved, oriented so 100 always means "exactly at the
 * standard" and higher always means better, whichever way the metric runs.
 */
function percentOfTarget(current: number, standard: BepsStandard): number | null {
  if (standard.targetValue === 0) return null
  const raw =
    standard.direction === 'at-or-above'
      ? (current / standard.targetValue) * 100
      : (standard.targetValue / current) * 100
  return clamp(round(raw, 1), 0, 200)
}

export function estimatePenalty(
  grossFloorAreaSqFt: number,
  gapPct: number,
  schedule: PenaltySchedule,
): PenaltyEstimate {
  const amount = applyPenaltyModel(grossFloorAreaSqFt, gapPct, schedule.model)
  // An unverified schedule gets a deliberately wide band, so nobody mistakes a
  // placeholder for a quote. A verified one still carries ±15% because the
  // final figure depends on the year's audited metrics.
  const spread = schedule.verification === 'verified' ? 0.15 : 0.4
  return {
    amount: round(amount, 0),
    low: round(amount * (1 - spread), 0),
    high: round(amount * (1 + spread), 0),
    basis: schedule.basis,
    verified: schedule.verification === 'verified',
    citationUrl: schedule.citationUrl,
  }
}

function applyPenaltyModel(sqFt: number, gapPct: number, model: PenaltyModel): number {
  switch (model.kind) {
    case 'gap-scaled': {
      const severity = clamp(gapPct / model.fullPenaltyGapPct, 0, 1)
      const rate =
        model.minRatePerSqFt + (model.maxRatePerSqFt - model.minRatePerSqFt) * severity
      const raw = rate * sqFt
      return model.capUsd === null ? raw : Math.min(raw, model.capUsd)
    }
    case 'flat-per-sqft': {
      const raw = model.ratePerSqFt * sqFt
      return model.capUsd === null ? raw : Math.min(raw, model.capUsd)
    }
    case 'per-day':
      return model.ratePerDay * model.maxDays
  }
}

export function metricLabel(metric: BepsStandard['metric']): string {
  switch (metric) {
    case 'energy-star-score':
      return 'ENERGY STAR score'
    case 'site-eui':
      return 'site EUI'
    case 'source-eui':
      return 'source EUI'
    case 'ghg-intensity':
      return 'GHG intensity'
  }
}

export function metricUnit(metric: BepsStandard['metric']): string {
  return metric === 'energy-star-score' ? 'points' : metric === 'ghg-intensity' ? 'kgCO₂e/ft²' : 'kBtu/ft²'
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

function fmtSqFt(n: number): string {
  return n.toLocaleString('en-US')
}
