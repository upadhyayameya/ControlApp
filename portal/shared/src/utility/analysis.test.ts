// Tests for the utility account analysis.
//
// What is covered here is what would quietly produce a wrong number in front
// of a customer: the unit conversions, the allocation of a bill that straddles
// two months, the difference between a blended and a marginal rate, and the
// rules that keep water, on-site generation and unrecognised fuels out of a
// site-energy total.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Building, ConsumptionEntry, Meter, MeterType, MetricYear } from '../types.js'
import { analyzeUtilityAccounts, fitRate } from './analysis.js'
import { toKbtu } from './units.js'

const SQFT = 100_000

function building(overrides: Partial<Building> = {}): Building {
  return {
    id: 'b1',
    organizationId: 'org1',
    espmPropertyId: 1,
    name: 'Test Building',
    addressLine1: null,
    city: 'Washington',
    state: 'DC',
    postalCode: null,
    propertyType: 'Office',
    grossFloorAreaSqFt: SQFT,
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

function meter(id: string, type: MeterType, unit: string, overrides: Partial<Meter> = {}): Meter {
  return {
    id,
    buildingId: 'b1',
    espmMeterId: null,
    name: `${type} meter`,
    type,
    unit,
    active: true,
    ...overrides,
  }
}

function bill(
  meterId: string,
  startDate: string,
  endDate: string,
  quantity: number,
  cost: number | null = null,
  overrides: Partial<ConsumptionEntry> = {},
): ConsumptionEntry {
  return {
    id: `${meterId}-${startDate}`,
    meterId,
    buildingId: 'b1',
    startDate,
    endDate,
    quantity,
    unit: '',
    cost,
    estimated: false,
    espmConsumptionId: null,
    syncState: 'remote',
    syncError: null,
    enteredByUserId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Twelve monthly bills through 2024 on one meter. */
function year2024(meterId: string, quantity: number, cost: number | null = null): ConsumptionEntry[] {
  const out: ConsumptionEntry[] = []
  for (let m = 1; m <= 12; m++) {
    const start = `2024-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(Date.UTC(2024, m, 0)).getUTCDate()
    out.push(bill(meterId, start, `2024-${String(m).padStart(2, '0')}-${lastDay}`, quantity, cost))
  }
  return out
}

// --- Conversions ----------------------------------------------------------

test('billed units convert on the factors ENERGY STAR publishes', () => {
  // Thermal Energy Conversions, Figure 3, U.S. property assumptions.
  assert.equal(toKbtu(1, 'kWh (thousand Watt-hours)', 'Electric - Grid'), 3.412)
  assert.equal(toKbtu(1, 'therms', 'Natural Gas'), 100)
  assert.equal(toKbtu(1, 'Gallons (US)', 'Fuel Oil No. 2'), 138)
  assert.equal(toKbtu(1, 'Gallons (US)', 'Propane'), 92)
  assert.equal(toKbtu(1, 'kLbs (thousand pounds)', 'District Steam'), 1_194)
  assert.equal(toKbtu(1, 'Ton Hours', 'District Chilled Water'), 12)
  // Water is not energy, whatever unit it is billed in.
  assert.equal(toKbtu(1_000, 'Gallons (US)', 'Potable Water'), null)
  // An unknown fuel has no factor, and must not be guessed at.
  assert.equal(toKbtu(1, 'kWh (thousand Watt-hours)', 'Unknown'), null)
  // A unit outside the table is reported rather than assumed.
  assert.equal(toKbtu(1, 'barrels', 'Fuel Oil No. 2'), null)
})

// --- Allocation -----------------------------------------------------------

test('a bill straddling two months is split by day, not dumped in one', () => {
  // 14 Dec to 11 Jan is 18 days of December and 11 of January, 29 in all.
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('m1', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: [bill('m1', '2023-12-14', '2024-01-11', 29_000, 2_900)],
    asOf: '2024-02-01',
  })
  const dec = a.monthly.find((m) => m.key === '2023-12')!
  const jan = a.monthly.find((m) => m.key === '2024-01')!
  assert.equal(dec.days, 18)
  assert.equal(jan.days, 11)
  // 29,000 kWh over 29 days is 1,000 kWh/day = 3,412 kBtu/day.
  assert.ok(Math.abs(dec.kbtu - 18 * 3_412) < 0.01, `December got ${dec.kbtu}`)
  assert.ok(Math.abs(jan.kbtu - 11 * 3_412) < 0.01, `January got ${jan.kbtu}`)
  // Cost splits the same way, so neither month carries the whole bill.
  assert.ok(Math.abs(dec.cost - 2_900 * (18 / 29)) < 0.01)
  // And the two calendar years each get their share.
  assert.equal(a.annual.length, 2)
})

// --- Rates ----------------------------------------------------------------

test('the marginal rate separates the per-unit charge from the fixed charge', () => {
  // Cost built as $500/month standing charge plus $0.11/kWh, so the blended
  // rate must come out above the marginal rate — that difference is exactly
  // what makes a blended rate the wrong number for sizing a retrofit.
  const bills = [10_000, 12_000, 9_000, 15_000, 11_000, 20_000, 8_000].map((q) => ({
    quantity: q,
    cost: 500 + 0.11 * q,
  }))
  const fit = fitRate(bills)!
  assert.ok(Math.abs(fit.marginalRate - 0.11) < 1e-9, `marginal ${fit.marginalRate}`)
  assert.ok(Math.abs(fit.fixedChargePerBill - 500) < 1e-6, `fixed ${fit.fixedChargePerBill}`)
  assert.ok(fit.rSquared > 0.999)

  const totalCost = bills.reduce((s, b) => s + b.cost, 0)
  const totalQty = bills.reduce((s, b) => s + b.quantity, 0)
  assert.ok(totalCost / totalQty > fit.marginalRate)
})

test('a rate is not fitted from too few bills, and never from flat usage', () => {
  const few = [1, 2, 3, 4, 5].map((i) => ({ quantity: 1_000 * i, cost: 100 * i }))
  assert.equal(fitRate(few), null)
  // Identical usage every month: the slope is unidentifiable, so no guess.
  const flat = Array.from({ length: 8 }, () => ({ quantity: 1_000, cost: 150 }))
  assert.equal(fitRate(flat), null)
})

// --- What belongs in a site-energy total ----------------------------------

test('water is billed and reported but never counted as energy', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [
      meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
      meter('w', 'Potable Water', 'Gallons (US)'),
    ],
    entries: [...year2024('e', 100_000, 12_000), ...year2024('w', 50_000, 400)],
    asOf: '2025-01-01',
  })
  // Energy: 1.2M kWh × 3.412 = 4,094,400 kBtu over the window.
  assert.ok(Math.abs(a.siteEnergyKbtu - 1_200_000 * 3.412) < 1, `${a.siteEnergyKbtu}`)
  assert.equal(a.waterGallons, 600_000)
  // The water bill must not appear in energy cost, and must appear in water cost.
  assert.equal(a.energyCost, 144_000)
  assert.equal(a.waterCost, 4_800)
  // The EUI is energy only; adding gallons to it would be nonsense.
  assert.ok(Math.abs(a.siteEui! - (1_200_000 * 3.412) / SQFT) < 0.01)
  assert.equal(a.waterGallonsPerSqFt, 6)
  assert.ok(!a.fuelMix.some((f) => f.type === 'Potable Water'))
})

test('on-site solar is reported apart from purchased energy', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [
      meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
      meter('s', 'Electric - Solar', 'kWh (thousand Watt-hours)'),
    ],
    entries: [...year2024('e', 90_000, 10_000), ...year2024('s', 10_000, null)],
    asOf: '2025-01-01',
  })
  // Site energy is the purchased 90,000/month only.
  assert.ok(Math.abs(a.siteEnergyKbtu - 1_080_000 * 3.412) < 1)
  assert.ok(Math.abs(a.onsiteGenerationKbtu - 120_000 * 3.412) < 1)
  assert.ok(Math.abs(a.onsiteGenerationShare! - 120_000 / 1_200_000) < 1e-9)
  // Fuel mix answers "what does this building buy", so grid is 100% of it.
  const grid = a.fuelMix.find((f) => f.type === 'Electric - Grid')!
  assert.ok(Math.abs(grid.shareOfSiteEnergy - 1) < 1e-9)
})

test('an unrecognised fuel or unit is excluded from totals and reported loudly', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [
      meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
      meter('x', 'Unknown', 'widgets'),
      meter('o', 'Fuel Oil No. 2', 'barrels'),
    ],
    entries: [...year2024('e', 100_000, 12_000), ...year2024('x', 5, 99), ...year2024('o', 500, 1_500)],
    asOf: '2025-01-01',
  })
  assert.ok(Math.abs(a.siteEnergyKbtu - 1_200_000 * 3.412) < 1, 'only the electric meter counts')
  assert.equal(a.meters.find((m) => m.meterId === 'x')!.totalKbtu, null)
  assert.equal(a.meters.find((m) => m.meterId === 'o')!.totalKbtu, null)
  // But their usage and cost are still visible, so nothing is hidden.
  assert.equal(a.meters.find((m) => m.meterId === 'o')!.totalCost, 18_000)
  const kinds = a.findings.map((f) => f.kind)
  assert.ok(kinds.includes('unknown-meter-type'))
  assert.ok(kinds.includes('unconvertible-unit'))
  for (const f of a.findings.filter((x) => x.kind === 'unknown-meter-type' || x.kind === 'unconvertible-unit')) {
    assert.equal(f.severity, 'critical')
  }
})

// --- Findings -------------------------------------------------------------

test('a missing bill is critical and a few missing days is not', () => {
  const entries = year2024('e', 100_000, 12_000).filter((b) => !b.startDate.startsWith('2024-03'))
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries,
    asOf: '2025-01-01',
  })
  const gap = a.findings.find((f) => f.kind === 'gap')!
  assert.equal(gap.severity, 'critical')
  assert.equal(gap.periodStart, '2024-03-01')
  assert.equal(gap.periodEnd, '2024-03-31')
  assert.match(gap.message, /cost the whole benchmark year/)

  // A short gap is worth noting, not alarming.
  const short = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: [
      bill('e', '2024-01-01', '2024-01-28', 90_000, 9_000),
      bill('e', '2024-02-01', '2024-02-29', 95_000, 9_500),
    ],
    asOf: '2024-03-01',
  })
  assert.equal(short.findings.find((f) => f.kind === 'gap')!.severity, 'warning')
})

test('a shared read date is not an overlap, but real double-counting is', () => {
  const shared = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: [
      bill('e', '2024-01-01', '2024-01-31', 90_000, 9_000),
      bill('e', '2024-01-31', '2024-02-29', 95_000, 9_500),
    ],
    asOf: '2024-03-01',
  })
  assert.equal(shared.findings.filter((f) => f.kind === 'overlap').length, 0)

  const real = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: [
      bill('e', '2024-01-01', '2024-01-31', 90_000, 9_000),
      bill('e', '2024-01-23', '2024-02-22', 95_000, 9_500),
    ],
    asOf: '2024-03-01',
  })
  const overlap = real.findings.find((f) => f.kind === 'overlap')!
  assert.equal(overlap.magnitude, 9)
  assert.equal(overlap.severity, 'warning')
})

test('an exact duplicate period is critical, since it inflates the total', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: [
      bill('e', '2024-01-01', '2024-01-31', 90_000, 9_000),
      bill('e', '2024-01-01', '2024-01-31', 90_000, 9_000, { id: 'dupe' }),
    ],
    asOf: '2024-02-15',
  })
  assert.equal(a.findings.find((f) => f.kind === 'duplicate-period')!.severity, 'critical')
})

test('a meter in use with no recent reading is flagged, with the date', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 100_000, 12_000),
    asOf: '2025-09-01',
  })
  const stale = a.findings.find((f) => f.kind === 'stale-meter')!
  assert.match(stale.message, /2024-12-31/)
  assert.ok(stale.magnitude! > 120)
})

test('year-on-year comparison is per day, and separates a rate rise from a usage rise', () => {
  const entries = [
    ...year2024('e', 100_000, 10_000),
    // Same month a year later: usage flat, cost up 60% — a rate story.
    bill('e', '2025-06-01', '2025-06-30', 100_000, 16_000),
  ]
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries,
    asOf: '2025-07-01',
  })
  const cost = a.findings.find((f) => f.kind === 'cost-spike')
  assert.ok(cost, 'expected a cost spike with usage flat')
  assert.match(cost!.message, /rate or demand charges/)
  assert.equal(a.findings.find((f) => f.kind === 'usage-spike'), undefined)
})

// --- Reconciliation -------------------------------------------------------

function metric(year: number, overrides: Partial<MetricYear> = {}): MetricYear {
  return {
    id: `m${year}`,
    buildingId: 'b1',
    year,
    energyStarScore: 50,
    siteEui: 40.944,
    sourceEui: null,
    weatherNormalizedSiteEui: null,
    totalGhgEmissions: null,
    ghgIntensity: null,
    waterUseIntensity: null,
    totalSiteEnergyKbtu: 1_200_000 * 3.412,
    source: 'espm',
    recordedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

test('bills that match ESPM are reported as agreeing', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 100_000, 12_000),
    metrics: [metric(2024)],
    asOf: '2025-01-15',
  })
  assert.equal(a.reconciliation!.verdict, 'agrees')
  assert.ok(Math.abs(a.reconciliation!.variancePct!) < 0.001)
  // The EUI from the bills must match the one ESPM reports.
  assert.ok(Math.abs(a.reconciliation!.meterSiteEui! - a.reconciliation!.espmSiteEui!) < 0.01)
})

test('a material gap against ESPM is called out, and names the likely cause', () => {
  // Bills total 30% below what ESPM reports for the year.
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 70_000, 8_000),
    metrics: [metric(2024)],
    asOf: '2025-01-15',
  })
  const r = a.reconciliation!
  assert.equal(r.verdict, 'material-variance')
  assert.ok(r.variancePct! < -25)
  assert.match(r.note, /meter is likely missing/)
  // And it reaches the findings list as critical, not just the summary.
  assert.ok(a.findings.some((f) => f.kind === 'espm-variance' && f.severity === 'critical'))
})

test('a part-year of bills is not compared against an annual ESPM figure', () => {
  // Five months of bills would look 60% short for a reason that says nothing
  // about the data, so there is nothing to compare.
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 100_000, 12_000).slice(0, 5),
    metrics: [metric(2024)],
    asOf: '2024-06-15',
  })
  assert.equal(a.reconciliation, null)
})

test('ESPM reporting no total is a stated limitation, not a variance', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 100_000, 12_000),
    metrics: [metric(2024, { totalSiteEnergyKbtu: null })],
    asOf: '2025-01-15',
  })
  assert.equal(a.reconciliation!.verdict, 'cannot-compare')
  assert.equal(a.reconciliation!.variancePct, null)
})

// --- Base load ------------------------------------------------------------

test('base load is read off the mildest month and the period is named', () => {
  // 500 kWh/day baseline, with summer months at triple.
  const entries = year2024('e', 15_000, 1_500).map((b, i) => {
    const summer = i >= 5 && i <= 7
    return summer ? { ...b, quantity: 45_000 } : b
  })
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries,
    asOf: '2025-01-01',
  })
  const base = a.baseLoad!
  // February has the fewest days, so the lowest total, but the daily rate
  // ties with the other mild months — the point is it is not a summer month.
  assert.ok(base.baseShare > 0.5 && base.baseShare < 0.8, `base share ${base.baseShare}`)
  assert.ok(base.basePeriodStart < '2024-06-01' || base.basePeriodStart > '2024-08-31')
  assert.ok(Math.abs(base.baseShare + base.variableShare - 1) < 1e-9)
})

// --- Score ----------------------------------------------------------------

test('clean data scores 100 and each problem costs something', () => {
  const clean = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 100_000, 12_000),
    asOf: '2025-01-15',
  })
  assert.equal(clean.findings.length, 0)
  assert.equal(clean.dataQualityScore, 100)

  const messy = analyzeUtilityAccounts({
    building: building(),
    meters: [meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)')],
    entries: year2024('e', 100_000, 12_000).filter((b) => !b.startDate.startsWith('2024-03')),
    asOf: '2025-01-15',
  })
  assert.ok(messy.dataQualityScore < 100)
  // Findings are ordered worst first, so a UI can show the top three.
  assert.equal(messy.findings[0]!.severity, 'critical')
})

// --- Findings that would mislead -----------------------------------------

test('a month with a missing bill is not compared year on year', () => {
  // This is a real false positive, found against live data: one month's gas
  // bill never arrived, so that month's mix shifted towards much pricier
  // electricity and the engine reported a 43% "cost spike". The arithmetic
  // was right and the conclusion was nonsense — it pointed the customer at
  // their supplier when the problem was the missing bill flagged two lines
  // above.
  const elec = year2024('e', 100_000, 10_000)
  const gas = year2024('g', 50_000, 5_000)
  const entries = [
    ...elec,
    ...gas,
    // A year later: March gas never arrived, everything else is flat.
    ...Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0')
      const lastDay = new Date(Date.UTC(2025, i + 1, 0)).getUTCDate()
      return bill('e', `2025-${m}-01`, `2025-${m}-${lastDay}`, 100_000, 10_000)
    }),
    ...Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0')
      const lastDay = new Date(Date.UTC(2025, i + 1, 0)).getUTCDate()
      return bill('g', `2025-${m}-01`, `2025-${m}-${lastDay}`, 50_000, 5_000)
    }).filter((b) => !b.startDate.startsWith('2025-03')),
  ]
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [
      meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
      meter('g', 'Natural Gas', 'therms'),
    ],
    entries,
    asOf: '2026-01-15',
  })
  // The gap itself must still be reported — loudly.
  assert.ok(a.findings.some((f) => f.kind === 'gap' && f.severity === 'critical'))
  // But March must not be reported as a spike of any kind.
  for (const f of a.findings) {
    if (f.kind === 'usage-spike' || f.kind === 'cost-spike') {
      assert.ok(!f.periodStart?.startsWith('2025-03'), `${f.kind} reported for a month with a gap`)
    }
  }
})

test('every meter going quiet on the same date is one finding, not one each', () => {
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [
      meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
      meter('g', 'Natural Gas', 'therms'),
      meter('w', 'Potable Water', 'Gallons (US)'),
    ],
    entries: [...year2024('e', 100_000, 10_000), ...year2024('g', 50_000, 5_000), ...year2024('w', 20_000, 300)],
    asOf: '2025-09-01',
  })
  const stale = a.findings.filter((f) => f.kind === 'stale-meter')
  assert.equal(stale.length, 1, 'three meters stopping together is one fact')
  assert.equal(stale[0]!.meterId, null, 'it is a building-level finding')
  // And it names the real suspect rather than blaming a meter.
  assert.match(stale[0]!.message, /data feed/)
  assert.match(stale[0]!.message, /2024-12-31/)
})

test('meters that go quiet months apart stay separate findings', () => {
  // One account closing is not a broken feed, and collapsing them would hide
  // which meter actually stopped.
  const gas = year2024('g', 50_000, 5_000).filter((b) => b.startDate < '2024-04')
  const a = analyzeUtilityAccounts({
    building: building(),
    meters: [
      meter('e', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
      meter('g', 'Natural Gas', 'therms'),
    ],
    entries: [...year2024('e', 100_000, 10_000), ...gas],
    asOf: '2025-09-01',
  })
  const stale = a.findings.filter((f) => f.kind === 'stale-meter')
  assert.equal(stale.length, 2)
  assert.ok(stale.every((f) => f.meterId !== null))
})
