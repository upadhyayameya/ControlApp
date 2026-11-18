// Tests for the compliance engine. The money math and the direction handling
// are the parts that would quietly produce a wrong number in front of a
// customer, so those are what is covered here.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Building, MetricYear } from '../types.js'
import { assessBuilding, assessBuildingAllCycles, currentAssessment, estimatePenalty } from './engine.js'
import { CYCLES, cycleById, mocoGroupFor, penaltyFor, standardFor } from './standards.js'

function building(overrides: Partial<Building> = {}): Building {
  return {
    id: 'b1',
    organizationId: 'org1',
    espmPropertyId: 1000,
    name: 'Test Building',
    addressLine1: null,
    city: 'Washington',
    state: 'DC',
    postalCode: null,
    propertyType: 'Office',
    grossFloorAreaSqFt: 100_000,
    yearBuilt: 1990,
    jurisdiction: 'dc',
    groupId: null,
    complianceExempt: false,
    exemptionNote: null,
    lastSyncedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function metric(overrides: Partial<MetricYear> = {}): MetricYear {
  return {
    id: 'm1',
    buildingId: 'b1',
    year: 2024,
    energyStarScore: 80,
    siteEui: 60,
    sourceEui: 140,
    weatherNormalizedSiteEui: 58,
    totalGhgEmissions: 500,
    ghgIntensity: 5,
    waterUseIntensity: 20,
    totalSiteEnergyKbtu: 6_000_000,
    source: 'espm',
    recordedAt: '2025-01-15T00:00:00Z',
    ...overrides,
  }
}

const dcCycle1 = cycleById('dc-cycle-1')!

test('a score above the DC standard is compliant', () => {
  const a = assessBuilding(building(), metric({ energyStarScore: 90 }), dcCycle1)
  assert.equal(a.status, 'compliant')
  assert.equal(a.metric, 'energy-star-score')
  assert.ok(a.gap !== null && a.gap < 0, 'gap should be negative when above target')
  assert.equal(a.estimatedPenalty, null)
})

test('a score below the DC standard is non-compliant and carries a penalty', () => {
  const target = standardFor('dc', 'dc-cycle-1', 'Office')!.targetValue
  const a = assessBuilding(building(), metric({ energyStarScore: target - 20 }), dcCycle1)
  assert.equal(a.status, 'non-compliant')
  assert.equal(a.gap, 20)
  assert.ok(a.estimatedPenalty, 'expected a penalty estimate')
  assert.ok(a.estimatedPenalty!.amount > 0)
  assert.ok(a.estimatedPenalty!.low < a.estimatedPenalty!.amount)
  assert.ok(a.estimatedPenalty!.high > a.estimatedPenalty!.amount)
})

test('sitting just above the standard reports at-risk, not compliant', () => {
  const target = standardFor('dc', 'dc-cycle-1', 'Office')!.targetValue
  // Within the 5% margin above the target.
  const a = assessBuilding(building(), metric({ energyStarScore: target + 1 }), dcCycle1)
  assert.equal(a.status, 'at-risk')
})

test('an EUI standard runs the other way: lower is better', () => {
  const cycle = cycleById('moco-g2-interim')!
  const b = building({ jurisdiction: 'montgomery-md', state: 'MD', city: 'Rockville' })
  const target = standardFor('montgomery-md', 'moco-g2-interim', 'Office')!.targetValue

  const under = assessBuilding(b, metric({ weatherNormalizedSiteEui: target - 20 }), cycle)
  assert.equal(under.status, 'compliant')

  const over = assessBuilding(b, metric({ weatherNormalizedSiteEui: target + 20 }), cycle)
  assert.equal(over.status, 'non-compliant')
  assert.equal(over.gap, 20)
})

test('weather-normalized site EUI is preferred over raw site EUI', () => {
  const cycle = cycleById('moco-g2-interim')!
  const b = building({ jurisdiction: 'montgomery-md' })
  const a = assessBuilding(b, metric({ siteEui: 999, weatherNormalizedSiteEui: 42 }), cycle)
  assert.equal(a.currentValue, 42)
})

test('a building under the coverage threshold is exempt, not compliant', () => {
  const a = assessBuilding(building({ grossFloorAreaSqFt: 20_000 }), metric(), dcCycle1)
  assert.equal(a.status, 'exempt')
  assert.match(a.notes.join(' '), /coverage threshold/)
})

test('missing metrics report insufficient-data rather than passing', () => {
  const a = assessBuilding(building(), null, dcCycle1)
  assert.equal(a.status, 'insufficient-data')
  assert.equal(a.estimatedPenalty, null)

  const b = assessBuilding(building(), metric({ energyStarScore: null }), dcCycle1)
  assert.equal(b.status, 'insufficient-data')
})

test('an explicit exemption wins over the numbers', () => {
  const a = assessBuilding(
    building({ complianceExempt: true, exemptionNote: 'Approved hardship exemption.' }),
    metric({ energyStarScore: 1 }),
    dcCycle1,
  )
  assert.equal(a.status, 'exempt')
  assert.equal(a.estimatedPenalty, null)
})

test('gap-scaled penalties grow with the size of the shortfall', () => {
  const schedule = penaltyFor('dc', 'dc-cycle-1')!
  const small = estimatePenalty(100_000, 2, schedule)
  const large = estimatePenalty(100_000, 30, schedule)
  assert.ok(large.amount > small.amount)
  // Beyond fullPenaltyGapPct the rate saturates rather than growing forever.
  const huge = estimatePenalty(100_000, 300, schedule)
  assert.equal(huge.amount, large.amount)
})

test('a schedule not read off the published rule is never flagged verified', () => {
  // 'secondary-source' is better than a placeholder and still not the rule, so
  // it must not clear the caveat the UI keys off.
  const schedule = penaltyFor('dc', 'dc-cycle-1')!
  assert.equal(schedule.verification, 'secondary-source')
  const est = estimatePenalty(100_000, 30, schedule)
  assert.equal(est.verified, false)
  assert.ok((est.high - est.low) / est.amount > 0.4, 'the band should still be wide')
})

test('DC exposure is capped per building', () => {
  const schedule = penaltyFor('dc', 'dc-cycle-1')!
  // A tower far past the standard would otherwise produce a headline figure
  // larger than anything DC can actually levy.
  const huge = estimatePenalty(5_000_000, 100, schedule)
  assert.equal(huge.amount, 7_500_000)
})

test('Montgomery County is a daily fine, not a per-square-foot payment', () => {
  const schedule = penaltyFor('montgomery-md', 'moco-g2-interim')!
  assert.equal(schedule.model.kind, 'per-day')
  // The whole point of the correction: exposure does not scale with area.
  const small = estimatePenalty(30_000, 40, schedule)
  const large = estimatePenalty(310_000, 40, schedule)
  assert.equal(small.amount, large.amount)
  assert.ok(large.amount <= 5_000, `expected the county cap, got ${large.amount}`)
})

test('currentAssessment picks the next cycle whose deadline has not passed', () => {
  const a = currentAssessment(building(), metric(), '2025-06-01')
  assert.equal(a?.cycleId, 'dc-cycle-1')
  const b = currentAssessment(building(), metric(), '2028-06-01')
  assert.equal(b?.cycleId, 'dc-cycle-2')
})

test('every cycle has a penalty schedule on file', () => {
  for (const cycle of CYCLES) {
    assert.ok(
      penaltyFor(cycle.jurisdiction, cycle.id),
      `no penalty schedule for ${cycle.id}`,
    )
  }
})

test('a Montgomery County building is judged on its own size-and-use group only', () => {
  // Groups 1-3 are non-residential, 4-5 multifamily, and the brackets differ,
  // so the same floor area lands on different deadlines by use.
  assert.equal(mocoGroupFor('Office', 300_000)?.id, 'g1')
  assert.equal(mocoGroupFor('Office', 100_000)?.id, 'g2')
  assert.equal(mocoGroupFor('Office', 30_000)?.id, 'g3')
  assert.equal(mocoGroupFor('Multifamily Housing', 300_000)?.id, 'g4')
  assert.equal(mocoGroupFor('Multifamily Housing', 100_000)?.id, 'g5')
  // Under the county's 25,000 ft² floor there is no group at all.
  assert.equal(mocoGroupFor('Office', 20_000), null)
  // Bracket edges belong to the larger group, not both.
  assert.equal(mocoGroupFor('Office', 250_000)?.id, 'g1')
  assert.equal(mocoGroupFor('Office', 50_000)?.id, 'g2')
})

test('a MoCo building sees two deadlines, not every group\'s', () => {
  const office = building({ jurisdiction: 'montgomery-md', grossFloorAreaSqFt: 100_000 })
  const cycles = assessBuildingAllCycles(office, metric()).map((a) => a.cycleId)
  assert.deepEqual(cycles, ['moco-g2-interim', 'moco-g2-final'])

  // Same area, multifamily: a later group, so later deadlines.
  const apartments = building({
    jurisdiction: 'montgomery-md',
    propertyType: 'Multifamily Housing',
    grossFloorAreaSqFt: 100_000,
  })
  const mf = assessBuildingAllCycles(apartments, metric()).map((a) => a.cycleId)
  assert.deepEqual(mf, ['moco-g5-interim', 'moco-g5-final'])
})

test('MoCo deadlines are the June 1 reporting date, not the end of the performance year', () => {
  // The performance period is the full calendar year; the obligation is due to
  // DEP by June 1 of the year after. Quoting December 31 would be five months
  // early and would read as a missed deadline the customer has not missed.
  assert.equal(cycleById('moco-g2-interim')!.periodEnd, '2028-12-31')
  assert.equal(cycleById('moco-g2-interim')!.complianceDate, '2029-06-01')
  assert.equal(cycleById('moco-g5-final')!.complianceDate, '2037-06-01')
})

test('DC score standards are read off the published rule, EUI ceilings included', () => {
  // These are the values in 20 DCMR § 3530.1. Six of them were wrong before
  // they were checked at source, so the test pins the ones that moved most.
  assert.equal(standardFor('dc', 'dc-cycle-1', 'Non-Refrigerated Warehouse')!.targetValue, 19)
  assert.equal(standardFor('dc', 'dc-cycle-1', 'Worship Facility')!.targetValue, 17)
  assert.equal(standardFor('dc', 'dc-cycle-1', 'Office')!.targetValue, 71)
  // 'Other' has no score, so it falls through to its source-EUI ceiling.
  const other = standardFor('dc', 'dc-cycle-1', 'Other')!
  assert.equal(other.metric, 'source-eui')
  assert.equal(other.targetValue, 229.4)
  for (const type of ['Office', 'Worship Facility', 'Other'] as const) {
    assert.equal(standardFor('dc', 'dc-cycle-1', type)!.verification, 'verified')
  }
})

test('an estimate reports which of its two constants is provisional', () => {
  // A dollar figure rests on the standard that decides the shortfall and the
  // rate that prices it. They are verified independently, and the caveat a
  // customer reads is much more useful when it names the one that is actually
  // provisional rather than disclaiming both.
  const schedule = penaltyFor('dc', 'dc-cycle-1')!
  const est = estimatePenalty(100_000, 20, schedule, 'verified')
  assert.equal(est.standardVerified, true, 'DC standards are read off 20 DCMR 3530')
  assert.equal(est.penaltyRateVerified, false, 'the rate is not published in a citable form')
  assert.equal(est.verified, false, 'one unverified constant is enough to caveat the figure')

  // Forgetting to say where the standard came from must not upgrade the
  // figure's provenance.
  assert.equal(estimatePenalty(100_000, 20, schedule).standardVerified, false)
})
