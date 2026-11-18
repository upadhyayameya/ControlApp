// ---------------------------------------------------------------------------
// What closing the gap actually takes.
//
// The compliance engine answers "are you short, and by how much" in the units
// the regulation happens to use. That is the question the rule asks, not the
// question the customer asks. Told they are four ENERGY STAR points below the
// standard, nobody knows whether that is a lighting retrofit or a new chiller,
// what it would cost, what it would save, or whether they will get there on
// their current trajectory anyway.
//
// This translates the gap into the three things a decision needs:
//
//   1. How much energy has to come out, as a percentage and in kBtu.
//   2. What that is worth a year, at the building's own rates rather than an
//      assumed one — and how it compares with the exposure for not doing it.
//   3. Whether the building is closing the gap or widening it, and where it
//      lands on the deadline at the rate it is moving.
//
// Everything here is derived from figures already on the building: the
// published standard, the metrics ESPM computed, and the rates read off the
// building's own bills. Nothing is assumed about plant, occupancy or measures,
// because the portal does not know those and guessing would produce a number
// that looks like advice.
// ---------------------------------------------------------------------------

import type { ComplianceAssessment, MetricYear, PropertyType } from '../types.js'
import { STANDARDS } from './standards.js'

export interface ReductionTarget {
  /**
   * How the reduction was derived.
   *
   * 'direct' — the standard is itself an intensity, so the gap is the
   * reduction. Exact.
   *
   * 'source-eui-equivalent' — the standard is an ENERGY STAR score, which is
   * a percentile and cannot be inverted to an energy quantity. DC publishes,
   * for each property type, both a score standard and a source-EUI standard;
   * they are two expressions of the same median building. Sizing the
   * reduction off the EUI one is therefore a reasonable approximation and
   * *is* an approximation: a score also moves with operating hours, occupancy
   * and equipment counts, so two buildings at the same intensity can score
   * differently. Reported, never hidden.
   */
  method: 'direct' | 'source-eui-equivalent'
  /** Share of current energy that has to come out, 0–1. */
  reductionPct: number
  /** kBtu a year that has to come out, when annual energy is known. */
  reductionKbtu: number | null
  fromValue: number
  toValue: number
  unit: string
}

export interface Trajectory {
  /** Change per year in the standard's metric, from a least-squares fit. */
  perYear: number
  yearsObserved: number
  firstYear: number
  lastYear: number
  /** Where the metric lands on the compliance date at this rate. */
  projectedAtDeadline: number
  /** Whether that projection meets the standard. */
  arrivesInTime: boolean
  /** True when the building is moving the right way at all. */
  improving: boolean
}

export interface GapAnalysis {
  /** Negative once the date has passed. */
  daysToDeadline: number
  deadlinePassed: boolean
  reduction: ReductionTarget | null
  /** Annual energy cost avoided by that reduction, at this building's rates. */
  annualSavingUsd: number | null
  /** Plain sentence naming the rate used, so the figure can be checked. */
  savingBasis: string | null
  trajectory: Trajectory | null
  /** Caveats that belong beside any of the above. */
  notes: string[]
}

const DAY_MS = 86_400_000

function parseDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** The source-EUI standard for a type, used to size a score gap in energy. */
function sourceEuiStandardFor(
  jurisdiction: string,
  cycleId: string,
  propertyType: PropertyType,
): number | null {
  const match =
    STANDARDS.find(
      (s) =>
        s.jurisdiction === jurisdiction &&
        s.cycleId === cycleId &&
        s.propertyType === propertyType &&
        s.metric === 'source-eui',
    ) ??
    STANDARDS.find(
      (s) =>
        s.jurisdiction === jurisdiction &&
        s.cycleId === cycleId &&
        s.propertyType === 'Other' &&
        s.metric === 'source-eui',
    )
  return match?.targetValue ?? null
}

/**
 * Least-squares slope of a metric against year.
 *
 * Two points give a slope but not a trend, so three are required. A portfolio
 * manager shown "you are improving 2 points a year" off two readings will
 * plan against it, and one warm summer would have produced the opposite line.
 */
function fitTrend(points: Array<{ year: number; value: number }>): { slope: number; intercept: number } | null {
  if (points.length < 3) return null
  const n = points.length
  const meanX = points.reduce((s, p) => s + p.year, 0) / n
  const meanY = points.reduce((s, p) => s + p.value, 0) / n
  let sxx = 0
  let sxy = 0
  for (const p of points) {
    sxx += (p.year - meanX) ** 2
    sxy += (p.year - meanX) * (p.value - meanY)
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: meanY - slope * meanX }
}

function metricValue(m: MetricYear, metric: ComplianceAssessment['metric']): number | null {
  switch (metric) {
    case 'energy-star-score':
      return m.energyStarScore
    case 'site-eui':
      // Montgomery County judges a weather-normalized intensity, so the
      // trend has to be read off the same series the standard is applied to.
      return m.weatherNormalizedSiteEui ?? m.siteEui
    case 'source-eui':
      return m.sourceEui
    case 'ghg-intensity':
      return m.ghgIntensity
  }
}

/**
 * Translate a shortfall into energy, money and a trajectory.
 *
 * `costPerKbtu` should be the building's own marginal cost of energy where
 * one could be fitted from its bills; a blended rate overstates what a saved
 * unit is worth. Passing null simply omits the money, which is better than
 * pricing a saving at a rate nobody pays.
 */
export function analyzeGap(input: {
  assessment: ComplianceAssessment
  propertyType: PropertyType
  metrics: MetricYear[]
  /** Total site energy for the latest year, kBtu. */
  annualSiteKbtu?: number | null
  costPerKbtu?: number | null
  costBasis?: string | null
  today: string
}): GapAnalysis {
  const { assessment: a, metrics, today } = input
  const notes: string[] = []

  const daysToDeadline = Math.round((parseDay(a.complianceDate) - parseDay(today)) / DAY_MS)

  // --- How much energy has to come out -----------------------------------

  let reduction: ReductionTarget | null = null
  if (a.status === 'non-compliant' || a.status === 'at-risk') {
    if (a.metric === 'site-eui' || a.metric === 'source-eui' || a.metric === 'ghg-intensity') {
      if (a.currentValue !== null && a.targetValue !== null && a.currentValue > 0) {
        const over = a.currentValue - a.targetValue
        if (over > 0) {
          reduction = {
            method: 'direct',
            reductionPct: over / a.currentValue,
            reductionKbtu:
              input.annualSiteKbtu != null ? (over / a.currentValue) * input.annualSiteKbtu : null,
            fromValue: a.currentValue,
            toValue: a.targetValue,
            unit: a.metric === 'ghg-intensity' ? 'kgCO₂e/ft²' : 'kBtu/ft²',
          }
        }
      }
    } else {
      // A score is a percentile and cannot be inverted into kBtu. The
      // published source-EUI standard for the same property type is the same
      // median expressed as an intensity, so it sizes the reduction.
      const latest = [...metrics].sort((x, y) => y.year - x.year)[0]
      const targetSourceEui = sourceEuiStandardFor(a.jurisdiction, a.cycleId, input.propertyType)
      const currentSourceEui = latest?.sourceEui ?? null
      if (targetSourceEui !== null && currentSourceEui !== null && currentSourceEui > targetSourceEui) {
        const over = currentSourceEui - targetSourceEui
        reduction = {
          method: 'source-eui-equivalent',
          reductionPct: over / currentSourceEui,
          reductionKbtu:
            input.annualSiteKbtu != null ? (over / currentSourceEui) * input.annualSiteKbtu : null,
          fromValue: currentSourceEui,
          toValue: targetSourceEui,
          unit: 'kBtu/ft² source',
        }
        notes.push(
          'The standard here is an ENERGY STAR score, which is a percentile and cannot be converted to kilowatt-hours directly. This reduction is sized from the source-EUI standard the same rule publishes for this property type — the same median expressed as an intensity. A score also moves with operating hours and occupancy, so treat it as the right order of effort rather than an exact requirement.',
        )
      } else if (targetSourceEui !== null && currentSourceEui === null) {
        notes.push(
          'ENERGY STAR reports no source EUI for the latest year, so the score gap cannot be sized in energy terms yet.',
        )
      }
    }
    if (reduction?.reductionKbtu != null) {
      notes.push(
        'The energy figure assumes the reduction comes out of the current fuel mix. Taking it all from one fuel changes both the intensity and the saving.',
      )
    }
  }

  // --- What it is worth ---------------------------------------------------

  const annualSavingUsd =
    reduction?.reductionKbtu != null && input.costPerKbtu != null
      ? reduction.reductionKbtu * input.costPerKbtu
      : null

  // --- Where the building is heading --------------------------------------

  const points = metrics
    .map((m) => ({ year: m.year, value: metricValue(m, a.metric) }))
    .filter((p): p is { year: number; value: number } => p.value !== null)
    .sort((x, y) => x.year - y.year)

  let trajectory: Trajectory | null = null
  const fit = fitTrend(points)
  if (fit && a.targetValue !== null) {
    const deadlineYear = Number(a.complianceDate.slice(0, 4))
    const projected = fit.intercept + fit.slope * deadlineYear
    // For a score, higher is better; for an intensity, lower is.
    const higherIsBetter = a.metric === 'energy-star-score'
    trajectory = {
      perYear: fit.slope,
      yearsObserved: points.length,
      firstYear: points[0]!.year,
      lastYear: points[points.length - 1]!.year,
      projectedAtDeadline: projected,
      arrivesInTime: higherIsBetter ? projected >= a.targetValue : projected <= a.targetValue,
      improving: higherIsBetter ? fit.slope > 0 : fit.slope < 0,
    }
    if (points.length === 3) {
      notes.push('The trend is fitted to three years, which is the fewest worth drawing a line through.')
    }
  } else if (points.length < 3) {
    // Silence here reads as "no trend", when the truth is usually "not enough
    // complete years" — and the reason a year is incomplete is almost always
    // actionable. ENERGY STAR withholds annual energy metrics entirely for a
    // year whose meter data has a hole, so one missing bill costs the whole
    // benchmark year rather than merely skewing it.
    const blank = metrics
      .filter((m) => metricValue(m, a.metric) === null)
      .map((m) => m.year)
      .sort()
    notes.push(
      blank.length > 0
        ? `No trend yet: a line needs three years and ${points.length === 1 ? 'only one has' : `only ${points.length} have`} a usable figure. ENERGY STAR reports none for ${blank.join(', ')}, which it does when a year's meter data has a gap — so a single missing bill costs the whole benchmark year. Filling it in Portfolio Manager would restore the trend.`
        : `No trend yet: a line needs three years of metrics and this building has ${points.length}.`,
    )
  }

  return {
    daysToDeadline,
    deadlinePassed: daysToDeadline < 0,
    reduction,
    annualSavingUsd,
    savingBasis: annualSavingUsd !== null ? (input.costBasis ?? null) : null,
    trajectory,
    notes,
  }
}
