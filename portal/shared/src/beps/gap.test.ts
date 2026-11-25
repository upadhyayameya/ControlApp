// Tests for the gap-to-action translation.
//
// The risk in this file is a number that looks like advice. A reduction
// percentage, a dollar saving and a projected arrival date are all things a
// customer will act on, so each is tested for the case where it must be
// withheld as well as the case where it can be shown.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ComplianceAssessment, MetricYear } from '../types.js'
import { analyzeGap } from './gap.js'

function assessment(over: Partial<ComplianceAssessment> = {}): ComplianceAssessment {
  return {
    buildingId: 'b1',
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-1',
    cycleLabel: 'DC BEPS Cycle 1',
    complianceDate: '2026-12-31',
    status: 'non-compliant',
    metric: 'energy-star-score',
    targetValue: 71,
    currentValue: 67,
    gap: 4,
    percentOfTarget: 94,
    estimatedPenalty: null,
    notes: [],
    ...over,
  }
}

function metric(year: number, over: Partial<MetricYear> = {}): MetricYear {
  return {
    id: `m${year}`,
    buildingId: 'b1',
    year,
    energyStarScore: 67,
    siteEui: 76.6,
    sourceEui: 160.7,
    weatherNormalizedSiteEui: 76.4,
    totalGhgEmissions: null,
    ghgIntensity: null,
    waterUseIntensity: null,
    totalSiteEnergyKbtu: 14_169_070,
    source: 'espm',
    recordedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

test('a score gap is sized from the published source-EUI standard for the type', () => {
  // An ENERGY STAR score is a percentile and cannot be inverted into energy.
  // DC publishes both a score standard and a source-EUI standard per property
  // type — the same median, two expressions — so the EUI one sizes the work.
  // Office: 160.7 now against a published 153.7, a 4.36% cut.
  const g = analyzeGap({
    assessment: assessment(),
    propertyType: 'Office',
    metrics: [metric(2023), metric(2024), metric(2025)],
    annualSiteKbtu: 14_169_070,
    costPerKbtu: 0.0269,
    costBasis: 'the marginal rate fitted from this building’s bills',
    today: '2026-11-18',
  })
  assert.equal(g.reduction!.method, 'source-eui-equivalent')
  assert.ok(Math.abs(g.reduction!.reductionPct - (160.7 - 153.7) / 160.7) < 1e-9)
  assert.equal(g.reduction!.toValue, 153.7)
  assert.ok(Math.abs(g.reduction!.reductionKbtu! - 0.0435594 * 14_169_070) < 2_000)
  // And it must say out loud that this is an approximation.
  assert.ok(g.notes.some((n) => /percentile/.test(n)))
})

test('the saving is priced at the rate given, and withheld when none is', () => {
  const base = {
    assessment: assessment(),
    propertyType: 'Office' as const,
    metrics: [metric(2023), metric(2024), metric(2025)],
    annualSiteKbtu: 14_169_070,
    today: '2026-11-18',
  }
  const priced = analyzeGap({ ...base, costPerKbtu: 0.0269, costBasis: 'marginal rate' })
  assert.ok(Math.abs(priced.annualSavingUsd! - priced.reduction!.reductionKbtu! * 0.0269) < 1e-6)
  assert.equal(priced.savingBasis, 'marginal rate')

  // No rate means no number. Pricing a saving at an assumed rate would be
  // worse than leaving the question open.
  const unpriced = analyzeGap(base)
  assert.equal(unpriced.annualSavingUsd, null)
  assert.equal(unpriced.savingBasis, null)
})

test('an EUI standard needs no approximation', () => {
  const g = analyzeGap({
    assessment: assessment({
      jurisdiction: 'montgomery-md',
      cycleId: 'moco-g1-interim',
      metric: 'site-eui',
      targetValue: 55,
      currentValue: 69.1,
      gap: 14.1,
      complianceDate: '2029-06-01',
    }),
    propertyType: 'Office',
    metrics: [metric(2023), metric(2024), metric(2025)],
    annualSiteKbtu: 21_000_000,
    today: '2026-11-18',
  })
  assert.equal(g.reduction!.method, 'direct')
  assert.ok(Math.abs(g.reduction!.reductionPct - 14.1 / 69.1) < 1e-9)
  assert.ok(!g.notes.some((n) => /percentile/.test(n)))
})

test('a compliant building is told what it takes to stay there, not what to cut', () => {
  const g = analyzeGap({
    assessment: assessment({ status: 'compliant', currentValue: 93, gap: -22 }),
    propertyType: 'Office',
    metrics: [metric(2023, { energyStarScore: 93 })],
    today: '2026-11-18',
  })
  assert.equal(g.reduction, null)
})

test('the trajectory says where the building lands, and needs three years', () => {
  // Improving two points a year from 63 in 2023 reaches 69 in 2026 — still
  // short of 71, which is the thing worth saying out loud.
  const improving = analyzeGap({
    assessment: assessment(),
    propertyType: 'Office',
    metrics: [
      metric(2023, { energyStarScore: 63 }),
      metric(2024, { energyStarScore: 65 }),
      metric(2025, { energyStarScore: 67 }),
    ],
    today: '2026-11-18',
  })
  assert.ok(Math.abs(improving.trajectory!.perYear - 2) < 1e-9)
  assert.equal(improving.trajectory!.improving, true)
  assert.ok(Math.abs(improving.trajectory!.projectedAtDeadline - 69) < 1e-9)
  assert.equal(improving.trajectory!.arrivesInTime, false)

  // Two readings are a slope, not a trend; a plan built on one warm summer is
  // worse than no plan.
  const tooFew = analyzeGap({
    assessment: assessment(),
    propertyType: 'Office',
    metrics: [metric(2024, { energyStarScore: 65 }), metric(2025, { energyStarScore: 67 })],
    today: '2026-11-18',
  })
  assert.equal(tooFew.trajectory, null)
})

test('a building heading the wrong way is reported as such', () => {
  const g = analyzeGap({
    assessment: assessment(),
    propertyType: 'Office',
    metrics: [
      metric(2023, { energyStarScore: 72 }),
      metric(2024, { energyStarScore: 70 }),
      metric(2025, { energyStarScore: 67 }),
    ],
    today: '2026-11-18',
  })
  assert.equal(g.trajectory!.improving, false)
  assert.ok(g.trajectory!.perYear < 0)
  assert.equal(g.trajectory!.arrivesInTime, false)
})

test('an EUI trend is read off the series the standard is applied to', () => {
  // Montgomery County judges a weather-normalized intensity. Trending the raw
  // site EUI instead would show a building improving or sliding for reasons
  // that are the weather's doing, not the building's.
  const g = analyzeGap({
    assessment: assessment({
      jurisdiction: 'montgomery-md',
      cycleId: 'moco-g1-interim',
      metric: 'site-eui',
      targetValue: 55,
      currentValue: 60,
      complianceDate: '2029-06-01',
    }),
    propertyType: 'Office',
    metrics: [
      metric(2023, { siteEui: 90, weatherNormalizedSiteEui: 64 }),
      metric(2024, { siteEui: 70, weatherNormalizedSiteEui: 62 }),
      metric(2025, { siteEui: 80, weatherNormalizedSiteEui: 60 }),
    ],
    today: '2026-11-18',
  })
  // The normalized series falls 2 a year; the raw one does not.
  assert.ok(Math.abs(g.trajectory!.perYear + 2) < 1e-9)
  assert.equal(g.trajectory!.improving, true)
})

test('days to the deadline are counted, and a passed deadline is flagged', () => {
  const soon = analyzeGap({
    assessment: assessment(),
    propertyType: 'Office',
    metrics: [metric(2025)],
    today: '2026-11-18',
  })
  assert.equal(soon.daysToDeadline, 43)
  assert.equal(soon.deadlinePassed, false)

  const past = analyzeGap({
    assessment: assessment(),
    propertyType: 'Office',
    metrics: [metric(2025)],
    today: '2027-03-01',
  })
  assert.ok(past.daysToDeadline < 0)
  assert.equal(past.deadlinePassed, true)
})
