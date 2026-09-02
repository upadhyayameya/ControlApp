// Tests for the compliance engine. The money math and the direction handling
// are the parts that would quietly produce a wrong number in front of a
// customer, so those are what is covered here.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Building, MetricYear } from '../types.js'
import { assessBuilding, currentAssessment, estimatePenalty } from './engine.js'
import { CYCLES, cycleById, penaltyFor, standardFor } from './standards.js'

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
  const cycle = cycleById('moco-interim-2030')!
  const b = building({ jurisdiction: 'montgomery-md', state: 'MD', city: 'Rockville' })
  const target = standardFor('montgomery-md', 'moco-interim-2030', 'Office')!.targetValue

  const under = assessBuilding(b, metric({ weatherNormalizedSiteEui: target - 20 }), cycle)
  assert.equal(under.status, 'compliant')

  const over = assessBuilding(b, metric({ weatherNormalizedSiteEui: target + 20 }), cycle)
  assert.equal(over.status, 'non-compliant')
  assert.equal(over.gap, 20)
})

test('weather-normalized site EUI is preferred over raw site EUI', () => {
  const cycle = cycleById('moco-interim-2030')!
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

test('unverified penalty schedules produce a wider band and an unverified flag', () => {
  const schedule = penaltyFor('dc', 'dc-cycle-1')!
  const est = estimatePenalty(100_000, 30, schedule)
  assert.equal(est.verified, false)
  assert.ok((est.high - est.low) / est.amount > 0.5, 'unverified band should be wide')
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
