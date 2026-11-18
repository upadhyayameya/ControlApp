// ---------------------------------------------------------------------------
// Utility account analysis.
//
// Everything in this file works from the bills themselves — one row per meter
// per billing period — rather than from the annual figures ESPM reports. That
// is the whole point of it. ESPM tells a customer their site EUI was 113.3;
// the bills tell them which meter drove it, what they paid per unit, that the
// gas meter has no reading for March, that two electric bills overlap by nine
// days, and that the blended rate they are quoting their board is a third
// below the marginal rate they actually pay for the next kWh.
//
// Three rules hold throughout:
//
//  1. Bills are allocated to calendar months by day, never by whichever month
//     the period happens to end in. A bill running 14 December to 11 January
//     is 18 days of December and 11 of January. This is also how Portfolio
//     Manager annualizes (Thermal Energy Conversions, Figure 1, step 1), so
//     portal annual totals and ESPM annual totals are built the same way and
//     a difference between them means something.
//  2. Nothing is invented. A meter in a unit the conversion table does not
//     cover is reported as unconvertible and left out of energy totals; a
//     missing cost makes a rate null rather than zero; a derived figure that
//     cannot be computed is null, and the UI shows the gap.
//  3. Every problem found in the data is reported as a finding with the meter
//     and period attached, because "your gas bills are missing March 2024" is
//     the actionable version of "your EUI looks low".
// ---------------------------------------------------------------------------

import type { Building, ConsumptionEntry, Meter, MeterType, MetricYear } from '../types.js'
import { isConvertible, isEnergyMeter, toGallons, toKbtu } from './units.js'

// --- Findings -------------------------------------------------------------

export type UtilityFindingKind =
  /** No bill covers a stretch of days between two bills on the same meter. */
  | 'gap'
  /** Two bills on one meter cover some of the same days; usage is double-counted. */
  | 'overlap'
  /** Two bills cover exactly the same period. */
  | 'duplicate-period'
  /** Usage recorded with no cost, so this meter's rates are incomplete. */
  | 'missing-cost'
  /** ESPM flagged the reading as estimated rather than billed. */
  | 'estimated-reading'
  | 'zero-usage'
  /** Negative usage: a credit, a correction, or a meter reset. */
  | 'negative-usage'
  /** The billed unit is not in the conversion table, so this fuel is excluded. */
  | 'unconvertible-unit'
  /** The meter's fuel is unrecognised, so it is excluded from every total. */
  | 'unknown-meter-type'
  /** No reading for long enough that the meter looks abandoned. */
  | 'stale-meter'
  /** A billing period too short or too long to be a monthly bill. */
  | 'implausible-period'
  /** Usage well above the same month a year earlier. */
  | 'usage-spike'
  /** Cost well above the same month a year earlier, beyond what usage explains. */
  | 'cost-spike'
  /** Meter totals and ESPM's own annual figure disagree. */
  | 'espm-variance'

export type FindingSeverity = 'info' | 'warning' | 'critical'

export interface UtilityFinding {
  kind: UtilityFindingKind
  severity: FindingSeverity
  meterId: string | null
  meterName: string | null
  /** One sentence, written to be shown to a customer as-is. */
  message: string
  periodStart?: string
  periodEnd?: string
  /** The number behind the finding, for sorting: days, dollars or percent. */
  magnitude?: number
}

// --- Results --------------------------------------------------------------

export interface RateFit {
  /** $ per billed unit for the next unit consumed: the slope of cost on usage. */
  marginalRate: number
  /** $ per bill that does not move with usage: the intercept. */
  fixedChargePerBill: number
  /** r² of the fit. Below ~0.8 the split between the two is not trustworthy. */
  rSquared: number
  billsUsed: number
}

export interface MeterRollup {
  meterId: string
  espmMeterId: number | null
  name: string
  type: MeterType
  unit: string
  active: boolean
  isEnergy: boolean
  billCount: number
  firstPeriodStart: string | null
  lastPeriodEnd: string | null
  /** Days actually covered by bills, with overlaps counted once. */
  daysCovered: number
  totalQuantity: number
  /** Null when the unit is not convertible, or the meter is not energy. */
  totalKbtu: number | null
  /** Null when no bill on this meter carried a cost. */
  totalCost: number | null
  billsWithCost: number
  /** Total cost ÷ total quantity, over bills that have both. */
  blendedRate: number | null
  /** Null unless there are enough costed bills to fit a line. */
  rate: RateFit | null
  shareOfSiteEnergy: number | null
  shareOfEnergyCost: number | null
  findings: UtilityFinding[]
}

export interface FuelSlice {
  type: MeterType
  kbtu: number
  shareOfSiteEnergy: number
  cost: number | null
  shareOfEnergyCost: number | null
  blendedRatePerKbtu: number | null
  meterCount: number
}

export interface PeriodRollup {
  /** 'YYYY-MM' for a month, 'YYYY' for a year. */
  key: string
  kbtu: number
  cost: number
  /** Days of the period that bills actually cover, for per-day comparisons. */
  days: number
  waterGallons: number
  waterCost: number
}

export interface BaseLoadSplit {
  /** Average daily kBtu in the lowest-usage billing period seen. */
  baseDailyKbtu: number
  /** Share of total energy that the base rate alone would account for. */
  baseShare: number
  /** The rest: load that moves with weather and occupancy. */
  variableShare: number
  /** The period the base was taken from, so a customer can sanity-check it. */
  basePeriodStart: string
  basePeriodEnd: string
}

export interface EspmReconciliation {
  year: number
  /** Site energy from the bills, allocated to this calendar year by day. */
  meterKbtu: number
  /** What ESPM reports for the same year. */
  espmKbtu: number | null
  /** Signed percent: positive means the bills total more than ESPM says. */
  variancePct: number | null
  /** EUI computed from the bills. */
  meterSiteEui: number | null
  espmSiteEui: number | null
  /** On-site generation in the same year, the usual explanation for a gap. */
  onsiteGenerationKbtu: number
  /** Days of the year no bill covers on at least one active energy meter. */
  uncoveredDays: number
  verdict: 'agrees' | 'minor-variance' | 'material-variance' | 'cannot-compare'
  note: string
}

export interface UtilityAnalysis {
  buildingId: string
  buildingName: string
  grossFloorAreaSqFt: number
  /** Window the headline figures cover: the most recent 12 months of bills. */
  windowStart: string | null
  windowEnd: string | null
  meters: MeterRollup[]
  /** Headline energy figures over the window. */
  siteEnergyKbtu: number
  siteEui: number | null
  energyCost: number | null
  energyCostPerSqFt: number | null
  /** Blended cost of a unit of delivered energy, across fuels. */
  blendedCostPerKbtu: number | null
  fuelMix: FuelSlice[]
  onsiteGenerationKbtu: number
  onsiteGenerationShare: number | null
  waterGallons: number
  waterCost: number | null
  waterGallonsPerSqFt: number | null
  baseLoad: BaseLoadSplit | null
  /** Full history by calendar year, oldest first. */
  annual: PeriodRollup[]
  /** Full history by month, oldest first — the series the charts draw. */
  monthly: PeriodRollup[]
  reconciliation: EspmReconciliation | null
  findings: UtilityFinding[]
  /** 0–100. Starts at 100 and loses points per finding; see `scoreFor`. */
  dataQualityScore: number
}

// --- Dates ----------------------------------------------------------------

const DAY_MS = 86_400_000

function parseDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Inclusive day count: a bill from the 1st to the 31st covers 31 days. */
function periodDays(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((parseDay(endIso) - parseDay(startIso)) / DAY_MS) + 1)
}

/** Inclusive overlap in days between two periods; 0 when they do not touch. */
function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = Math.max(parseDay(aStart), parseDay(bStart))
  const end = Math.min(parseDay(aEnd), parseDay(bEnd))
  if (end < start) return 0
  return Math.round((end - start) / DAY_MS) + 1
}

/**
 * The first day of the 12-month window ending on `endIso`.
 *
 * Calendar arithmetic, not 365 days: a window ending 31 December 2024 starts
 * 1 January 2024, and subtracting a fixed number of days gets that wrong in
 * a leap year, clipping a day off the oldest bill and quietly understating
 * every total the window produces.
 */
function oneYearBack(endIso: string): string {
  const d = new Date(parseDay(endIso))
  return toIso(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()) + DAY_MS)
}

/** The calendar months a bill touches, with how many of its days fall in each. */
function monthSlices(startIso: string, endIso: string): Array<{ key: string; days: number }> {
  const out: Array<{ key: string; days: number }> = []
  const start = parseDay(startIso)
  const end = parseDay(endIso)
  if (end < start) return out
  let cursor = new Date(start)
  while (cursor.getTime() <= end) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const monthStart = Date.UTC(y, m, 1)
    const monthEnd = Date.UTC(y, m + 1, 0)
    const from = Math.max(start, monthStart)
    const to = Math.min(end, monthEnd)
    out.push({
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      days: Math.round((to - from) / DAY_MS) + 1,
    })
    cursor = new Date(Date.UTC(y, m + 1, 1))
  }
  return out
}

// --- Rate fitting ---------------------------------------------------------

/**
 * Least squares of cost on usage across a meter's bills.
 *
 * The blended rate (total cost ÷ total usage) is the number everyone quotes
 * and the wrong one for a decision: it buries fixed charges in the per-unit
 * figure, so it overstates what a kWh of savings is worth. The slope here is
 * what a saved unit is actually worth, and the intercept is what the customer
 * pays before consuming anything. Both are needed to size a retrofit.
 *
 * Returns null below six costed bills — a line through four points is a
 * number, not evidence.
 */
export function fitRate(bills: Array<{ quantity: number; cost: number }>): RateFit | null {
  const points = bills.filter((b) => Number.isFinite(b.quantity) && Number.isFinite(b.cost) && b.quantity > 0)
  if (points.length < 6) return null
  const n = points.length
  const meanX = points.reduce((s, p) => s + p.quantity, 0) / n
  const meanY = points.reduce((s, p) => s + p.cost, 0) / n
  let sxx = 0
  let sxy = 0
  for (const p of points) {
    sxx += (p.quantity - meanX) ** 2
    sxy += (p.quantity - meanX) * (p.cost - meanY)
  }
  // Every bill has the same usage: the slope is unidentifiable.
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = meanY - slope * meanX
  let ssTot = 0
  let ssRes = 0
  for (const p of points) {
    const predicted = intercept + slope * p.quantity
    ssTot += (p.cost - meanY) ** 2
    ssRes += (p.cost - predicted) ** 2
  }
  return {
    marginalRate: slope,
    fixedChargePerBill: intercept,
    rSquared: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    billsUsed: n,
  }
}

// --- Per-meter ------------------------------------------------------------

/** Bills too short or too long to be a monthly bill, in days. */
const MIN_PLAUSIBLE_DAYS = 20
const MAX_PLAUSIBLE_DAYS = 45
/** No reading for this long and the meter is treated as stale. */
const STALE_DAYS = 120
/**
 * A gap this long has swallowed a whole bill. Set below the length of a short
 * month on purpose: a missing February bill leaves a 29-day hole, and a
 * threshold above that would treat the most common case of all — one bill
 * never arriving — as a minor gap.
 */
const MISSING_BILL_DAYS = 25
/** Year-on-year change that gets reported. */
const SPIKE_PCT = 40

function rollupMeter(
  meter: Meter,
  bills: ConsumptionEntry[],
  asOf: string,
): MeterRollup {
  const sorted = [...bills].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const findings: UtilityFinding[] = []
  const add = (
    kind: UtilityFindingKind,
    severity: FindingSeverity,
    message: string,
    extra: Partial<UtilityFinding> = {},
  ) => findings.push({ kind, severity, meterId: meter.id, meterName: meter.name, message, ...extra })

  const energy = isEnergyMeter(meter.type)
  const convertible = sorted.length > 0 && isConvertible(meter.unit, meter.type)

  if (meter.type === 'Unknown') {
    add(
      'unknown-meter-type',
      'critical',
      `"${meter.name}" has a fuel type this portal does not recognise, so its readings are excluded from every energy and emissions figure. Check the meter in Portfolio Manager.`,
    )
  } else if (energy && sorted.length > 0 && !convertible) {
    add(
      'unconvertible-unit',
      'critical',
      `"${meter.name}" is billed in ${meter.unit}, which is not in the ENERGY STAR conversion table, so it is excluded from energy totals. Its usage and cost are still shown.`,
    )
  }

  let totalQuantity = 0
  let totalKbtu = 0
  let totalCost = 0
  let billsWithCost = 0
  let costedQuantity = 0
  const costedBills: Array<{ quantity: number; cost: number }> = []

  for (const b of sorted) {
    totalQuantity += b.quantity
    const kbtu = toKbtu(b.quantity, b.unit || meter.unit, meter.type)
    if (kbtu !== null) totalKbtu += kbtu
    if (b.cost !== null) {
      totalCost += b.cost
      billsWithCost++
      costedQuantity += b.quantity
      costedBills.push({ quantity: b.quantity, cost: b.cost })
    }

    const days = periodDays(b.startDate, b.endDate)
    if (days > 0 && (days < MIN_PLAUSIBLE_DAYS || days > MAX_PLAUSIBLE_DAYS)) {
      add(
        'implausible-period',
        'info',
        `A bill on "${meter.name}" covers ${days} days (${b.startDate} to ${b.endDate}), which is not a normal monthly period. Check it was entered as billed.`,
        { periodStart: b.startDate, periodEnd: b.endDate, magnitude: days },
      )
    }
    if (b.quantity < 0) {
      add(
        'negative-usage',
        'warning',
        `"${meter.name}" has negative usage for ${b.startDate} to ${b.endDate}. That is usually a credit or a corrected reading; it reduces the annual total.`,
        { periodStart: b.startDate, periodEnd: b.endDate, magnitude: b.quantity },
      )
    } else if (b.quantity === 0) {
      add(
        'zero-usage',
        'info',
        `"${meter.name}" recorded no usage for ${b.startDate} to ${b.endDate}.`,
        { periodStart: b.startDate, periodEnd: b.endDate },
      )
    }
    if (b.estimated) {
      add(
        'estimated-reading',
        'info',
        `The reading on "${meter.name}" for ${b.startDate} to ${b.endDate} is an estimate, not a billed figure.`,
        { periodStart: b.startDate, periodEnd: b.endDate },
      )
    }
  }

  if (sorted.length > 0 && billsWithCost === 0) {
    add(
      'missing-cost',
      'warning',
      `No bill on "${meter.name}" has a cost, so this meter contributes nothing to cost, rate or savings figures.`,
    )
  } else if (sorted.length > 0 && billsWithCost < sorted.length) {
    const missing = sorted.length - billsWithCost
    add(
      'missing-cost',
      'info',
      `${missing} of ${sorted.length} bills on "${meter.name}" have no cost recorded, so its rates are computed from the rest.`,
      { magnitude: missing },
    )
  }

  // Gaps, overlaps and duplicates between consecutive bills.
  let coveredDays = 0
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!
    coveredDays += periodDays(current.startDate, current.endDate)
    const next = sorted[i + 1]
    if (!next) continue

    if (current.startDate === next.startDate && current.endDate === next.endDate) {
      add(
        'duplicate-period',
        'critical',
        `Two bills on "${meter.name}" cover exactly ${current.startDate} to ${current.endDate}. One is a duplicate and is inflating this meter's totals.`,
        { periodStart: current.startDate, periodEnd: current.endDate },
      )
      continue
    }

    const overlap = overlapDays(current.startDate, current.endDate, next.startDate, next.endDate)
    // A single shared day is a billing convention, not an error: plenty of
    // utilities print the read date as both the end of one period and the
    // start of the next. Two or more days is double-counted usage.
    if (overlap > 1) {
      coveredDays -= overlap - 1
      add(
        'overlap',
        'warning',
        `Bills on "${meter.name}" overlap by ${overlap} days around ${next.startDate}, so that usage is counted twice.`,
        { periodStart: next.startDate, periodEnd: current.endDate, magnitude: overlap },
      )
      continue
    }

    const gap = Math.round((parseDay(next.startDate) - parseDay(current.endDate)) / DAY_MS) - 1
    if (gap >= 2) {
      add(
        'gap',
        gap >= MISSING_BILL_DAYS ? 'critical' : 'warning',
        gap >= MISSING_BILL_DAYS
          ? `"${meter.name}" has no bills for ${gap} days (${toIso(parseDay(current.endDate) + DAY_MS)} to ${toIso(parseDay(next.startDate) - DAY_MS)}) — at least one whole bill is missing, so annual totals and the EUI are understated.`
          : `"${meter.name}" has a ${gap}-day gap between bills around ${current.endDate}.`,
        {
          periodStart: toIso(parseDay(current.endDate) + DAY_MS),
          periodEnd: toIso(parseDay(next.startDate) - DAY_MS),
          magnitude: gap,
        },
      )
    }
  }

  const last = sorted[sorted.length - 1]
  if (meter.active && last) {
    const sinceDays = Math.round((parseDay(asOf) - parseDay(last.endDate)) / DAY_MS)
    if (sinceDays > STALE_DAYS) {
      add(
        'stale-meter',
        'warning',
        `"${meter.name}" is marked in use but its last bill ended ${last.endDate}, ${sinceDays} days ago. Either readings have stopped arriving or the meter should be closed out.`,
        { magnitude: sinceDays },
      )
    }
  }
  if (meter.active && sorted.length === 0) {
    add(
      'stale-meter',
      'warning',
      `"${meter.name}" is marked in use but has no readings at all.`,
    )
  }

  return {
    meterId: meter.id,
    espmMeterId: meter.espmMeterId,
    name: meter.name,
    type: meter.type,
    unit: meter.unit,
    active: meter.active,
    isEnergy: energy,
    billCount: sorted.length,
    firstPeriodStart: sorted[0]?.startDate ?? null,
    lastPeriodEnd: last?.endDate ?? null,
    daysCovered: coveredDays,
    totalQuantity,
    totalKbtu: energy && convertible ? totalKbtu : null,
    totalCost: billsWithCost > 0 ? totalCost : null,
    billsWithCost,
    blendedRate: billsWithCost > 0 && costedQuantity > 0 ? totalCost / costedQuantity : null,
    rate: fitRate(costedBills),
    shareOfSiteEnergy: null, // filled in once the building total is known
    shareOfEnergyCost: null,
    findings,
  }
}

// --- Series ---------------------------------------------------------------

function buildSeries(
  meters: Meter[],
  byMeter: Map<string, ConsumptionEntry[]>,
  granularity: 'month' | 'year',
): PeriodRollup[] {
  const acc = new Map<string, PeriodRollup>()
  const slot = (key: string): PeriodRollup => {
    let row = acc.get(key)
    if (!row) {
      row = { key, kbtu: 0, cost: 0, days: 0, waterGallons: 0, waterCost: 0 }
      acc.set(key, row)
    }
    return row
  }

  for (const meter of meters) {
    for (const bill of byMeter.get(meter.id) ?? []) {
      const total = periodDays(bill.startDate, bill.endDate)
      if (total === 0) continue
      const kbtu = toKbtu(bill.quantity, bill.unit || meter.unit, meter.type)
      const gallons = meter.type === 'Potable Water' ? toGallons(bill.quantity, bill.unit || meter.unit) : null
      // Spread the bill across the calendar periods it touches, in proportion
      // to the days falling in each. Attributing the whole bill to the month
      // it ends in is what makes a December-to-January bill look like a
      // January spike, and it is why monthly series built that way cannot be
      // compared year on year.
      for (const slice of monthSlices(bill.startDate, bill.endDate)) {
        const key = granularity === 'month' ? slice.key : slice.key.slice(0, 4)
        const row = slot(key)
        const share = slice.days / total
        if (kbtu !== null) row.kbtu += kbtu * share
        if (bill.cost !== null) {
          if (meter.type === 'Potable Water') row.waterCost += bill.cost * share
          else row.cost += bill.cost * share
        }
        if (gallons !== null) row.waterGallons += gallons * share
        if (isEnergyMeter(meter.type)) row.days += slice.days
      }
    }
  }
  return [...acc.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Every 'YYYY-MM' touched by a gap, on either side of a comparison.
 *
 * A month missing a bill on one meter is not comparable with anything. The
 * case that forced this: a building whose gas bill for one March never
 * arrived reported a 43% "cost spike" for that month — the gas was missing,
 * so the month's mix shifted towards much pricier electricity and cost per
 * unit rose. The arithmetic was right and the conclusion was nonsense, and it
 * pointed a customer at their supplier when the actual problem was a missing
 * bill the report already flagged two lines above.
 */
function monthsWithGaps(findings: UtilityFinding[]): Set<string> {
  const out = new Set<string>()
  for (const f of findings) {
    if (f.kind !== 'gap' && f.kind !== 'overlap' && f.kind !== 'duplicate-period') continue
    if (!f.periodStart) continue
    const end = f.periodEnd ?? f.periodStart
    for (const slice of monthSlices(f.periodStart, end)) out.add(slice.key)
  }
  return out
}

/** Year-on-year comparison of the same calendar month. */
function spikeFindings(monthly: PeriodRollup[], unreliable: Set<string>): UtilityFinding[] {
  const out: UtilityFinding[] = []
  const index = new Map(monthly.map((m) => [m.key, m]))
  for (const row of monthly) {
    const [y, m] = row.key.split('-')
    const prior = index.get(`${Number(y) - 1}-${m}`)
    if (!prior || prior.kbtu <= 0 || row.days === 0 || prior.days === 0) continue
    // Either side being incomplete makes the comparison meaningless.
    if (unreliable.has(row.key) || unreliable.has(prior.key)) continue
    // Per-day, so a 28-day February is not compared against a 31-day one.
    const now = row.kbtu / row.days
    const then = prior.kbtu / prior.days
    const changePct = ((now - then) / then) * 100
    if (changePct >= SPIKE_PCT) {
      out.push({
        kind: 'usage-spike',
        severity: changePct >= 100 ? 'warning' : 'info',
        meterId: null,
        meterName: null,
        message: `Energy use in ${row.key} ran ${changePct.toFixed(0)}% above the same month a year earlier, per day. Worth checking against occupancy or a schedule change before it shows up in the annual figure.`,
        periodStart: `${row.key}-01`,
        magnitude: changePct,
      })
    }
    if (prior.cost > 0 && row.cost > 0) {
      const costChange = ((row.cost / row.days - prior.cost / prior.days) / (prior.cost / prior.days)) * 100
      // Only report cost separately when it outran usage: that is a rate or
      // a demand-charge story, not a consumption one, and it needs a
      // different conversation with the supplier.
      if (costChange >= SPIKE_PCT && costChange - changePct >= 15) {
        out.push({
          kind: 'cost-spike',
          severity: 'warning',
          meterId: null,
          meterName: null,
          message: `Energy cost in ${row.key} ran ${costChange.toFixed(0)}% above the same month a year earlier while usage rose ${changePct.toFixed(0)}%. The difference is rate or demand charges, not consumption.`,
          periodStart: `${row.key}-01`,
          magnitude: costChange,
        })
      }
    }
  }
  return out
}

function baseLoadFor(meters: Meter[], byMeter: Map<string, ConsumptionEntry[]>): BaseLoadSplit | null {
  // Base load is read off the lowest-usage billing period on the building's
  // electric meters: whatever runs in the mildest month runs all year.
  const electric = meters.filter((m) => m.type === 'Electric - Grid')
  const bills: Array<{ dailyKbtu: number; start: string; end: string; days: number }> = []
  for (const meter of electric) {
    for (const b of byMeter.get(meter.id) ?? []) {
      const days = periodDays(b.startDate, b.endDate)
      const kbtu = toKbtu(b.quantity, b.unit || meter.unit, meter.type)
      if (days < MIN_PLAUSIBLE_DAYS || kbtu === null || kbtu <= 0) continue
      bills.push({ dailyKbtu: kbtu / days, start: b.startDate, end: b.endDate, days })
    }
  }
  if (bills.length < 6) return null
  const lowest = bills.reduce((a, b) => (b.dailyKbtu < a.dailyKbtu ? b : a))
  const totalKbtu = bills.reduce((s, b) => s + b.dailyKbtu * b.days, 0)
  const totalDays = bills.reduce((s, b) => s + b.days, 0)
  if (totalKbtu <= 0) return null
  const baseShare = Math.min(1, (lowest.dailyKbtu * totalDays) / totalKbtu)
  return {
    baseDailyKbtu: lowest.dailyKbtu,
    baseShare,
    variableShare: 1 - baseShare,
    basePeriodStart: lowest.start,
    basePeriodEnd: lowest.end,
  }
}

// --- ESPM reconciliation --------------------------------------------------

function reconcile(
  annual: PeriodRollup[],
  metrics: MetricYear[],
  sqft: number,
  onsiteByYear: Map<string, number>,
  coveredDaysByYear: Map<string, number>,
): EspmReconciliation | null {
  // Compare the most recent calendar year that has both bills and an ESPM
  // figure. Only complete years are worth comparing: a partial year always
  // looks short against ESPM's annualized number for reasons that say nothing
  // about the data.
  const candidates = annual
    .filter((row) => (coveredDaysByYear.get(row.key) ?? 0) >= 350)
    .sort((a, b) => b.key.localeCompare(a.key))
  for (const row of candidates) {
    const year = Number(row.key)
    const metric = metrics.find((m) => m.year === year)
    if (!metric) continue
    const onsite = onsiteByYear.get(row.key) ?? 0
    const uncovered = Math.max(0, 365 - (coveredDaysByYear.get(row.key) ?? 0))
    const meterEui = sqft > 0 ? row.kbtu / sqft : null
    if (metric.totalSiteEnergyKbtu === null || metric.totalSiteEnergyKbtu <= 0) {
      return {
        year,
        meterKbtu: row.kbtu,
        espmKbtu: null,
        variancePct: null,
        meterSiteEui: meterEui,
        espmSiteEui: metric.siteEui,
        onsiteGenerationKbtu: onsite,
        uncoveredDays: uncovered,
        verdict: 'cannot-compare',
        note: `ESPM reports no total site energy for ${year}, so the bills cannot be checked against it. The figures here come from the bills alone.`,
      }
    }
    const variancePct = ((row.kbtu - metric.totalSiteEnergyKbtu) / metric.totalSiteEnergyKbtu) * 100
    const abs = Math.abs(variancePct)
    const verdict = abs <= 2 ? 'agrees' : abs <= 10 ? 'minor-variance' : 'material-variance'
    let note: string
    if (verdict === 'agrees') {
      note = `Bills and ESPM agree for ${year} to within ${abs.toFixed(1)}%. The meter-level figures below can be relied on.`
    } else {
      const onsiteShare = metric.totalSiteEnergyKbtu > 0 ? (onsite / metric.totalSiteEnergyKbtu) * 100 : 0
      const parts = [
        `The bills total ${variancePct > 0 ? 'more' : 'less'} than ESPM reports for ${year}, by ${abs.toFixed(1)}%.`,
      ]
      if (uncovered > 5) {
        parts.push(`${uncovered} days of ${year} have no bill on at least one meter, which would explain a shortfall.`)
      }
      if (onsiteShare >= 1) {
        parts.push(
          `On-site generation is ${onsiteShare.toFixed(1)}% of the ESPM total; whether ESPM counts it in site energy for this property is the other thing to check.`,
        )
      }
      if (uncovered <= 5 && onsiteShare < 1) {
        parts.push('Neither missing bills nor on-site generation accounts for it, so a meter is likely missing from the portal or duplicated in ESPM.')
      }
      note = parts.join(' ')
    }
    return {
      year,
      meterKbtu: row.kbtu,
      espmKbtu: metric.totalSiteEnergyKbtu,
      variancePct,
      meterSiteEui: meterEui,
      espmSiteEui: metric.siteEui,
      onsiteGenerationKbtu: onsite,
      uncoveredDays: uncovered,
      verdict,
      note,
    }
  }
  return null
}

/**
 * One stale meter is a meter problem. Every meter stale at once is a feed
 * problem, and saying it three times says it worse than saying it once.
 *
 * The distinction matters because the remedies differ: a single meter that
 * stopped reporting usually means an account closed or a meter was replaced,
 * while a whole building going quiet on the same date means the data stopped
 * arriving — a broken utility download, an expired Portfolio Manager share,
 * or a sync that has not run. Listing it per meter buries that.
 */
function collapseStaleMeters(rollups: MeterRollup[]): UtilityFinding[] {
  const all = rollups.flatMap((r) => r.findings)
  const stale = all.filter((f) => f.kind === 'stale-meter')
  const activeWithBills = rollups.filter((r) => r.active && r.billCount > 0)
  if (stale.length < 2 || stale.length < activeWithBills.length) return all

  // Only collapse when they stopped together; meters that went quiet months
  // apart are separate stories and stay separate findings.
  const lastDates = activeWithBills.map((r) => r.lastPeriodEnd).filter((d): d is string => d !== null)
  const spreadDays =
    lastDates.length > 1
      ? Math.round(
          (parseDay(lastDates.reduce((a, b) => (a > b ? a : b))) -
            parseDay(lastDates.reduce((a, b) => (a < b ? a : b)))) /
            DAY_MS,
        )
      : 0
  if (spreadDays > 45) return all

  const latest = lastDates.reduce((a, b) => (a > b ? a : b))
  const days = Math.max(...stale.map((f) => f.magnitude ?? 0))
  return [
    ...all.filter((f) => f.kind !== 'stale-meter'),
    {
      kind: 'stale-meter',
      severity: 'warning',
      meterId: null,
      meterName: null,
      message: `No meter on this building has a bill after ${latest}, ${Math.round(days)} days ago — all ${stale.length} stopped together. That points at the data feed rather than at any one meter: check the utility download, the Portfolio Manager share, and whether the sync is running.`,
      magnitude: days,
    },
  ]
}

// --- Score ----------------------------------------------------------------

const PENALTY: Record<FindingSeverity, number> = { critical: 15, warning: 6, info: 1 }

/**
 * A single number for "can I trust this building's data", so a portfolio view
 * can sort by it. Deliberately blunt: the findings themselves are what someone
 * acts on, and a score that tried to be subtle would just be harder to explain.
 */
export function scoreFor(findings: UtilityFinding[]): number {
  const lost = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0)
  return Math.max(0, Math.min(100, 100 - lost))
}

// --- Entry point ----------------------------------------------------------

/**
 * Analyse one building's utility accounts.
 *
 * `asOf` is passed in rather than read from the clock so the result is
 * reproducible: the same bills always produce the same findings, which is what
 * makes the output testable and a report re-runnable.
 */
export function analyzeUtilityAccounts(input: {
  building: Building
  meters: Meter[]
  entries: ConsumptionEntry[]
  metrics?: MetricYear[]
  asOf: string
}): UtilityAnalysis {
  const { building, meters, entries, asOf } = input
  const metrics = input.metrics ?? []
  const sqft = building.grossFloorAreaSqFt

  const byMeter = new Map<string, ConsumptionEntry[]>()
  for (const e of entries) {
    const list = byMeter.get(e.meterId)
    if (list) list.push(e)
    else byMeter.set(e.meterId, [e])
  }

  const rollups = meters.map((m) => rollupMeter(m, byMeter.get(m.id) ?? [], asOf))

  // Headline figures cover the most recent 12 months of bills rather than a
  // calendar year, because that is the span a customer has data for; the
  // calendar-year series is reported separately for compliance.
  const allEnd = rollups.map((r) => r.lastPeriodEnd).filter((d): d is string => d !== null)
  const windowEnd = allEnd.length > 0 ? allEnd.sort().slice(-1)[0]! : null
  const windowStart = windowEnd ? oneYearBack(windowEnd) : null

  const inWindow = (e: ConsumptionEntry, m: Meter): number => {
    if (!windowStart || !windowEnd) return 0
    const total = periodDays(e.startDate, e.endDate)
    if (total === 0) return 0
    void m
    return overlapDays(e.startDate, e.endDate, windowStart, windowEnd) / total
  }

  let siteEnergyKbtu = 0
  let energyCost = 0
  let energyCostSeen = false
  let onsiteGenerationKbtu = 0
  let waterGallons = 0
  let waterCost = 0
  let waterCostSeen = false
  const fuelAcc = new Map<MeterType, { kbtu: number; cost: number; costSeen: boolean; meters: Set<string> }>()

  for (const meter of meters) {
    for (const bill of byMeter.get(meter.id) ?? []) {
      const share = inWindow(bill, meter)
      if (share <= 0) continue
      const kbtu = toKbtu(bill.quantity, bill.unit || meter.unit, meter.type)
      const cost = bill.cost === null ? null : bill.cost * share
      if (meter.type === 'Potable Water') {
        const gallons = toGallons(bill.quantity, bill.unit || meter.unit)
        if (gallons !== null) waterGallons += gallons * share
        if (cost !== null) {
          waterCost += cost
          waterCostSeen = true
        }
        continue
      }
      if (!isEnergyMeter(meter.type)) continue
      let slice = fuelAcc.get(meter.type)
      if (!slice) {
        slice = { kbtu: 0, cost: 0, costSeen: false, meters: new Set() }
        fuelAcc.set(meter.type, slice)
      }
      slice.meters.add(meter.id)
      if (kbtu !== null) {
        slice.kbtu += kbtu * share
        if (meter.type === 'Electric - Solar') onsiteGenerationKbtu += kbtu * share
        else siteEnergyKbtu += kbtu * share
      }
      if (cost !== null) {
        slice.cost += cost
        slice.costSeen = true
        energyCost += cost
        energyCostSeen = true
      }
    }
  }

  // Grid-supplied energy is the denominator for fuel mix: on-site generation
  // is reported as its own line rather than diluting the shares, since the
  // question a fuel mix answers is what the building buys.
  const fuelMix: FuelSlice[] = [...fuelAcc.entries()]
    .map(([type, v]): FuelSlice => ({
      type,
      kbtu: v.kbtu,
      shareOfSiteEnergy: siteEnergyKbtu > 0 ? v.kbtu / siteEnergyKbtu : 0,
      cost: v.costSeen ? v.cost : null,
      shareOfEnergyCost: v.costSeen && energyCost > 0 ? v.cost / energyCost : null,
      blendedRatePerKbtu: v.costSeen && v.kbtu > 0 ? v.cost / v.kbtu : null,
      meterCount: v.meters.size,
    }))
    .sort((a, b) => b.kbtu - a.kbtu)

  for (const r of rollups) {
    if (r.totalKbtu !== null && siteEnergyKbtu > 0 && r.type !== 'Electric - Solar') {
      // Share over the meter's whole history against a 12-month total would
      // be meaningless, so shares come from the window's fuel slices.
      const slice = fuelAcc.get(r.type)
      r.shareOfSiteEnergy = slice && slice.kbtu > 0 ? slice.kbtu / siteEnergyKbtu : null
    }
    if (r.totalCost !== null && energyCost > 0 && r.isEnergy) {
      const slice = fuelAcc.get(r.type)
      r.shareOfEnergyCost = slice && slice.costSeen ? slice.cost / energyCost : null
    }
  }

  const monthly = buildSeries(meters, byMeter, 'month')
  const annual = buildSeries(meters, byMeter, 'year')

  // Per-year on-site generation and bill coverage, for reconciliation.
  const onsiteByYear = new Map<string, number>()
  const coveredByYear = new Map<string, number>()
  for (const meter of meters) {
    if (!isEnergyMeter(meter.type)) continue
    for (const bill of byMeter.get(meter.id) ?? []) {
      const total = periodDays(bill.startDate, bill.endDate)
      if (total === 0) continue
      const kbtu = toKbtu(bill.quantity, bill.unit || meter.unit, meter.type)
      for (const slice of monthSlices(bill.startDate, bill.endDate)) {
        const year = slice.key.slice(0, 4)
        if (meter.type === 'Electric - Solar' && kbtu !== null) {
          onsiteByYear.set(year, (onsiteByYear.get(year) ?? 0) + kbtu * (slice.days / total))
        }
        // Coverage is measured on the largest single meter's coverage rather
        // than the sum, which would exceed 365 on any multi-meter building.
        if (meter.type === 'Electric - Grid') {
          coveredByYear.set(year, (coveredByYear.get(year) ?? 0) + slice.days)
        }
      }
    }
  }

  const reconciliation = reconcile(annual, metrics, sqft, onsiteByYear, coveredByYear)

  const meterFindings = collapseStaleMeters(rollups)
  const findings: UtilityFinding[] = [
    ...meterFindings,
    ...spikeFindings(monthly, monthsWithGaps(meterFindings)),
  ]
  if (reconciliation && reconciliation.verdict === 'material-variance') {
    findings.push({
      kind: 'espm-variance',
      severity: 'critical',
      meterId: null,
      meterName: null,
      message: reconciliation.note,
      magnitude: reconciliation.variancePct ?? undefined,
    })
  }
  const severityRank: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 }
  findings.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || (b.magnitude ?? 0) - (a.magnitude ?? 0),
  )

  return {
    buildingId: building.id,
    buildingName: building.name,
    grossFloorAreaSqFt: sqft,
    windowStart,
    windowEnd,
    meters: rollups,
    siteEnergyKbtu,
    siteEui: sqft > 0 && siteEnergyKbtu > 0 ? siteEnergyKbtu / sqft : null,
    energyCost: energyCostSeen ? energyCost : null,
    energyCostPerSqFt: energyCostSeen && sqft > 0 ? energyCost / sqft : null,
    blendedCostPerKbtu: energyCostSeen && siteEnergyKbtu > 0 ? energyCost / siteEnergyKbtu : null,
    fuelMix,
    onsiteGenerationKbtu,
    onsiteGenerationShare:
      siteEnergyKbtu + onsiteGenerationKbtu > 0
        ? onsiteGenerationKbtu / (siteEnergyKbtu + onsiteGenerationKbtu)
        : null,
    waterGallons,
    waterCost: waterCostSeen ? waterCost : null,
    waterGallonsPerSqFt: sqft > 0 && waterGallons > 0 ? waterGallons / sqft : null,
    baseLoad: baseLoadFor(meters, byMeter),
    annual,
    monthly,
    reconciliation,
    findings,
    dataQualityScore: scoreFor(findings),
  }
}
