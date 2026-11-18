// ---------------------------------------------------------------------------
// The translation layer between Portfolio Manager and the portal's domain.
//
// Everything ESPM-shaped stops here. Two judgement calls live in this file:
// which ESPM property type maps to which of ours, and which jurisdiction a
// building falls under — both of which decide what standard the customer is
// judged against, so both are deliberately explicit rather than inferred.
// ---------------------------------------------------------------------------

import type { Jurisdiction, MeterType, PropertyType } from '@hbs/shared'
import type { EspmMeter, EspmProperty } from './types.js'

/**
 * ESPM has ~80 property types; we carry the ones that appear on the DC and
 * Montgomery County covered-building lists. Anything else becomes 'Other',
 * which has its own (conservative) standard rather than no standard.
 */
const PROPERTY_TYPE_MAP: Record<string, PropertyType> = {
  Office: 'Office',
  'Medical Office': 'Medical Office',
  'Financial Office': 'Office',
  'Multifamily Housing': 'Multifamily Housing',
  'Residence Hall/Dormitory': 'Residence Hall',
  'Senior Living Community': 'Senior Living Community',
  'Senior Care Community': 'Senior Living Community',
  Hotel: 'Hotel',
  'K-12 School': 'K-12 School',
  'Retail Store': 'Retail Store',
  Supermarket: 'Supermarket',
  'Supermarket/Grocery Store': 'Supermarket',
  Hospital: 'Hospital',
  'Hospital (General Medical & Surgical)': 'Hospital',
  'Non-Refrigerated Warehouse': 'Non-Refrigerated Warehouse',
  'Distribution Center': 'Non-Refrigerated Warehouse',
  'Worship Facility': 'Worship Facility',
  'Bank Branch': 'Bank Branch',
}

export function mapPropertyType(espmPrimaryFunction: string): PropertyType {
  return PROPERTY_TYPE_MAP[espmPrimaryFunction.trim()] ?? 'Other'
}

/**
 * Which BEPS regime a building sits under, from its address.
 *
 * Deliberately narrow: only addresses we can place with confidence get a
 * jurisdiction. A Maryland address outside the Montgomery County ZIP ranges
 * returns 'none' rather than being guessed into a standard that would show the
 * customer a fine they do not owe. Staff can override on the building record.
 */
export function inferJurisdiction(
  state: string | undefined,
  city: string | undefined,
  postalCode: string | undefined,
): Jurisdiction {
  const st = state?.trim().toUpperCase()
  if (st === 'DC' || city?.trim().toLowerCase() === 'washington') return 'dc'

  if (st === 'MD') {
    const zip = postalCode?.trim().slice(0, 5)
    if (zip && MONTGOMERY_ZIPS.has(zip)) return 'montgomery-md'
    const town = city?.trim().toLowerCase()
    if (town && MONTGOMERY_CITIES.has(town)) return 'montgomery-md'
  }

  return 'none'
}

/**
 * Montgomery County ZIP prefixes. Not exhaustive — it covers the county's main
 * commercial corridors, and anything missing falls through to 'none' for a
 * human to set, which is the safe direction to be wrong in.
 */
const MONTGOMERY_ZIPS = new Set([
  '20812', '20814', '20815', '20816', '20817', '20818', '20832', '20833', '20837',
  '20838', '20839', '20841', '20842', '20850', '20851', '20852', '20853', '20854',
  '20855', '20860', '20861', '20862', '20866', '20868', '20871', '20872', '20874',
  '20876', '20877', '20878', '20879', '20880', '20882', '20886', '20895', '20896',
  '20899', '20901', '20902', '20903', '20904', '20905', '20906', '20910', '20912',
])

const MONTGOMERY_CITIES = new Set([
  'rockville', 'bethesda', 'silver spring', 'gaithersburg', 'germantown', 'wheaton',
  'takoma park', 'chevy chase', 'potomac', 'olney', 'kensington', 'damascus',
  'poolesville', 'burtonsville', 'clarksburg', 'montgomery village', 'north bethesda',
])

export interface MappedProperty {
  espmPropertyId: number
  name: string
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  propertyType: PropertyType
  grossFloorAreaSqFt: number
  yearBuilt: number | null
  jurisdiction: Jurisdiction
}

export function mapProperty(p: EspmProperty): MappedProperty {
  const addr = p.address ?? {}
  return {
    espmPropertyId: p.id,
    name: p.name,
    addressLine1: addr.address1 ?? null,
    city: addr.city ?? null,
    state: addr.state ?? null,
    postalCode: addr.postalCode ?? null,
    propertyType: mapPropertyType(p.primaryFunction),
    grossFloorAreaSqFt: normalizeFloorArea(p),
    yearBuilt: p.yearBuilt ?? null,
    jurisdiction: inferJurisdiction(addr.state, addr.city, addr.postalCode),
  }
}

/**
 * Gross floor area drives every intensity and every penalty, so a unit we do
 * not recognise must not silently become a square-footage. Square metres are
 * converted; anything else is rejected as 0 and shows up as insufficient data.
 */
function normalizeFloorArea(p: EspmProperty): number {
  const gfa = p.grossFloorArea
  if (!gfa || !Number.isFinite(gfa.value)) return 0
  const units = gfa.units.toLowerCase()
  if (units.includes('square meter') || units.includes('square metre')) {
    return Math.round(gfa.value * 10.7639)
  }
  if (units.includes('square feet') || units.includes('square foot') || units === 'ft2') {
    return Math.round(gfa.value)
  }
  return 0
}

/**
 * ESPM meter type → portal meter type.
 *
 * ⚠ The keys on the left are the strings ESPM actually sends in the <type>
 * element, which are NOT the labels the Portfolio Manager web UI displays.
 * Six of the seven types the HBS test account returns did not match the
 * labels this map was originally written against: ESPM sends "Electric", not
 * "Electric - Grid"; "Fuel Oil No 2" with no period; and water arrives as
 * "Municipally Supplied Potable Water - Indoor" and two siblings. Every one
 * of them fell through to the old `?? 'Electric - Grid'` default, so a live
 * pull booked gallons of water and gallons of fuel oil as kilowatt-hours of
 * purchased electricity — invisibly, because the default always produced a
 * plausible-looking row.
 *
 * Verified 2026-11-18 by reading <type> off every meter of the six EPA sample
 * properties in ESPM's test environment. The display labels are kept as
 * aliases so hand-written fixtures and older rows keep working.
 */
const METER_TYPE_MAP: Record<string, MeterType> = {
  // --- Strings observed from live ESPM ---
  Electric: 'Electric - Grid',
  'Electric on Site Solar': 'Electric - Solar',
  'Natural Gas': 'Natural Gas',
  'Fuel Oil No 2': 'Fuel Oil No. 2',
  'Municipally Supplied Potable Water - Indoor': 'Potable Water',
  'Municipally Supplied Potable Water - Outdoor': 'Potable Water',
  'Municipally Supplied Potable Water - Mixed Indoor/Outdoor': 'Potable Water',
  // --- Display-label aliases, and types not present in the sample account ---
  'Electric - Grid': 'Electric - Grid',
  'Electric on Site Wind': 'Electric - Solar',
  'Fuel Oil No. 2': 'Fuel Oil No. 2',
  'District Steam': 'District Steam',
  'District Chilled Water': 'District Chilled Water',
  'District Chilled Water - Electric-Driven Chiller': 'District Chilled Water',
  'District Hot Water': 'District Steam',
  Propane: 'Propane',
  'Potable Indoor Water': 'Potable Water',
  'Potable: Indoor': 'Potable Water',
  'Potable: Mixed Indoor/Outdoor': 'Potable Water',
  'Potable Water': 'Potable Water',
}

export interface MappedMeter {
  espmMeterId: number
  name: string
  type: MeterType
  unit: string
  active: boolean
}

export function mapMeter(m: EspmMeter): MappedMeter {
  return {
    espmMeterId: m.id,
    name: m.name,
    type: meterTypeFor(m.type),
    unit: m.unitOfMeasure,
    active: m.inUse,
  }
}

/**
 * The portal type for an ESPM type string.
 *
 * An unrecognised type becomes 'Unknown' — never a guess. ESPM adds meter
 * types, and the portal finding out by mislabelling a customer's bills is the
 * failure this avoids: water still resolves to water from the type string
 * alone, and anything genuinely new is surfaced rather than absorbed.
 */
export function meterTypeFor(espmType: string): MeterType {
  const key = espmType.trim()
  const mapped = METER_TYPE_MAP[key]
  if (mapped) return mapped
  if (isWaterMeter(key)) return 'Potable Water'
  return 'Unknown'
}

/** True when this ESPM meter type is water rather than energy. */
export function isWaterMeter(type: string): boolean {
  return /water/i.test(type) && !/chilled/i.test(type)
}
