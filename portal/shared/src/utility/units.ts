// ---------------------------------------------------------------------------
// Billed units → kBtu.
//
// Utility bills arrive in whatever unit the supplier prints: kWh, therms,
// gallons, ton hours. Nothing can be added up, compared or turned into an EUI
// until it is in one unit, and getting a factor wrong here is worse than
// getting a BEPS target wrong — a bad target misjudges one building, a bad
// factor misstates every figure derived from that fuel: consumption, cost per
// unit, fuel mix, intensity and the gap to the standard.
//
// VERIFIED 2026-11-18 against EPA's own reference, which is also what
// Portfolio Manager itself applies, so portal totals and ESPM totals are
// computed the same way and any difference between them is real rather than
// an artefact of two conversion tables:
//
//   ENERGY STAR Portfolio Manager, Technical Reference: Thermal Energy
//   Conversions (August 2015), Figure 3 — "Conversion Factors to kBtu by
//   Meter Type for the U.S. and Canada", U.S. property assumptions.
//   https://portfoliomanager.energystar.gov/pdf/reference/Thermal%20Conversions.pdf
//
// U.S. assumptions are used throughout: HBS works in DC and Maryland. The
// Canadian column differs for fuels with an assumed heat content (natural gas
// is 1,031.43 Btu/cf there against 1,026 here), so a Canadian property would
// need its own table rather than this one.
// ---------------------------------------------------------------------------

import type { MeterType } from '../types.js'

/**
 * Factors by meter type and billed unit.
 *
 * Keyed on the unit strings ESPM returns in `unitOfMeasure`, which are the
 * "Input Unit Options" column of Figure 3 verbatim — "kWh (thousand
 * Watt-hours)", not "kWh". Lookup is case- and whitespace-insensitive and
 * also accepts the bare unit, since a reading typed into the portal by hand
 * will not carry ESPM's parenthetical.
 */
const FACTORS: Partial<Record<MeterType, Record<string, number>>> = {
  'Electric - Grid': {
    'kwh (thousand watt-hours)': 3.412,
    kwh: 3.412,
    'mwh (million watt-hours)': 3_412,
    mwh: 3_412,
    'kbtu (thousand btu)': 1,
    kbtu: 1,
    'mbtu/mmbtu (million btu)': 1_000,
    mbtu: 1_000,
    mmbtu: 1_000,
    'gj (billion joules)': 947.817,
    gj: 947.817,
  },
  // Figure 3 gives onsite renewable electricity the same factors as grid
  // purchase: a kWh is a kWh. The two are separate meter types in this portal
  // because of what they *mean* downstream, not because they convert
  // differently.
  'Electric - Solar': {
    'kwh (thousand watt-hours)': 3.412,
    kwh: 3.412,
    'mwh (million watt-hours)': 3_412,
    mwh: 3_412,
    'kbtu (thousand btu)': 1,
    kbtu: 1,
    'gj (billion joules)': 947.817,
    gj: 947.817,
  },
  'Natural Gas': {
    therms: 100,
    therm: 100,
    'ccf (hundred cubic feet)': 102.6,
    ccf: 102.6,
    'cf (cubic feet)': 1.026,
    cf: 1.026,
    'kcf (thousand cubic feet)': 1_026,
    kcf: 1_026,
    'mcf (million cubic feet)': 1_026_000,
    mcf: 1_026_000,
    'cubic meters': 36.303,
    'kbtu (thousand btu)': 1,
    kbtu: 1,
    'mbtu/mmbtu (million btu)': 1_000,
    'gj (billion joules)': 947.817,
  },
  'Fuel Oil No. 2': {
    'gallons (us)': 138,
    gallons: 138,
    'gallons (uk)': 165.726,
    liters: 36.456,
    'kbtu (thousand btu)': 1,
    'mbtu/mmbtu (million btu)': 1_000,
    'gj (billion joules)': 947.817,
  },
  Propane: {
    'gallons (us)': 92,
    gallons: 92,
    'gallons (uk)': 110.484,
    liters: 24.304,
    'cf (cubic feet)': 2.516,
    'ccf (hundred cubic feet)': 251.6,
    'kcf (thousand cubic feet)': 2_516,
    'kbtu (thousand btu)': 1,
    'mbtu/mmbtu (million btu)': 1_000,
    'gj (billion joules)': 947.817,
  },
  'District Steam': {
    lbs: 1.194,
    pounds: 1.194,
    'klbs (thousand pounds)': 1_194,
    klbs: 1_194,
    'mlbs (million pounds)': 1_194_000,
    therms: 100,
    'kbtu (thousand btu)': 1,
    'mbtu/mmbtu (million btu)': 1_000,
    'gj (billion joules)': 947.817,
  },
  'District Chilled Water': {
    'ton hours': 12,
    'ton-hours': 12,
    tonhours: 12,
    'kbtu (thousand btu)': 1,
    'mbtu/mmbtu (million btu)': 1_000,
    'gj (billion joules)': 947.817,
  },
}

/**
 * Water is metered and billed but is not energy, and must never be added into
 * a site-energy total or an EUI. It gets its own rollup instead.
 */
export function isEnergyMeter(type: MeterType): boolean {
  return type !== 'Potable Water' && type !== 'Unknown'
}

/** Normalizes "  kWh (Thousand Watt-Hours) " to "kwh (thousand watt-hours)". */
function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * kBtu for one reading, or null when it cannot be converted.
 *
 * Null is a deliberate outcome, not a failure to handle: a meter in a unit
 * this table does not cover is reported as unconvertible and left out of
 * energy totals, because a guessed factor would silently misstate the
 * building's intensity and every figure built on it. 'Unknown' meter types
 * always return null — the fuel is not known, so neither is the conversion.
 */
export function toKbtu(quantity: number, unit: string, type: MeterType): number | null {
  if (!isEnergyMeter(type)) return null
  const factor = FACTORS[type]?.[normalizeUnit(unit)]
  if (factor === undefined) return null
  return quantity * factor
}

/** True when this meter's readings can be expressed in kBtu. */
export function isConvertible(unit: string, type: MeterType): boolean {
  return isEnergyMeter(type) && FACTORS[type]?.[normalizeUnit(unit)] !== undefined
}

/** Water volume in US gallons, or null if the unit is not a volume we know. */
export function toGallons(quantity: number, unit: string): number | null {
  switch (normalizeUnit(unit)) {
    case 'gallons (us)':
    case 'gallons':
      return quantity
    case 'gallons (uk)':
      // 1 imperial gallon = 1.20095 US gallons.
      return quantity * 1.20095
    case 'ccf (hundred cubic feet)':
    case 'ccf':
      // 1 ft³ = 7.48052 US gallons.
      return quantity * 100 * 7.48052
    case 'cf (cubic feet)':
    case 'cf':
      return quantity * 7.48052
    case 'kgal (thousand gallons)':
    case 'kgal':
      return quantity * 1_000
    case 'cubic meters':
      return quantity * 264.172
    case 'liters':
      return quantity * 0.264172
    default:
      return null
  }
}
