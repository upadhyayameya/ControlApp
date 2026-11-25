// ---------------------------------------------------------------------------
// BEPS standards, compliance cycles and penalty models — as data.
//
// ⚠ READ THIS BEFORE SHOWING A NUMBER TO A CUSTOMER ⚠
//
// The *engine* (engine.ts) is exact. The *constants* in this file are not all
// confirmed against the published rules. Every entry carries a `verification`
// field, and anything not marked 'verified' propagates `verified: false` all
// the way into PenaltyEstimate, which the UI renders with a caveat banner
// instead of a hard dollar figure.
//
// The intent is that someone at HBS sits down with the published DOEE and
// Montgomery County DEP tables once, corrects the numbers here, flips the
// flags to 'verified', and the whole portal starts quoting real figures. No
// other file needs to change. Until then the portal is deliberately honest
// about which figures are provisional.
// ---------------------------------------------------------------------------

import type { Building, Jurisdiction, PropertyType } from '../types.js'

/**
 * Provenance of a single constant. Drives the caveat shown in the UI.
 *
 * The middle state matters: a figure two independent commentaries agree on is
 * far better than a placeholder, and still not the published rule. Collapsing
 * those two into "unverified" would waste real information; collapsing them
 * into "verified" would quote a customer a number nobody checked at source.
 */
export type Verification =
  /** Read off the published rule by a human, with the citation below. */
  | 'verified'
  /**
   * Corroborated by independent secondary sources but not yet read at source.
   * Treated as unverified everywhere money is shown — see `isConfirmed`.
   */
  | 'secondary-source'
  /** Plausible placeholder. Must be confirmed before it is quoted to a customer. */
  | 'needs-verification'

/**
 * Whether a constant may be quoted without a caveat. Only the published rule
 * clears this bar, so adding a laxer state above can never silently remove a
 * warning from the UI.
 */
export function isConfirmed(verification: Verification): boolean {
  return verification === 'verified'
}

export interface BepsCycle {
  id: string
  jurisdiction: Jurisdiction
  label: string
  /** Performance period the standard is judged over. */
  periodStart: string
  periodEnd: string
  /** The date by which the building must have met the standard. */
  complianceDate: string
  /** Smallest covered building in this cycle, ft². */
  coverageMinSqFt: number
}

/**
 * The metric a jurisdiction judges a property type on. DC uses the ENERGY STAR
 * score where one exists (the standard being the local median) and falls back
 * to source EUI where it does not; Montgomery County uses site EUI throughout.
 */
export type StandardMetric = 'energy-star-score' | 'site-eui' | 'source-eui' | 'ghg-intensity'

export interface BepsStandard {
  jurisdiction: Jurisdiction
  cycleId: string
  propertyType: PropertyType
  metric: StandardMetric
  /**
   * The threshold. Read together with `direction`: for a score, higher is
   * better and the building must be at or above it; for an EUI, lower is
   * better and the building must be at or below it.
   */
  targetValue: number
  direction: 'at-or-above' | 'at-or-below'
  verification: Verification
  note?: string
}

/**
 * How a jurisdiction converts a shortfall into money.
 *
 * `gap-scaled` is the important one: DC's alternative compliance payment is
 * proportional to how far short the building fell, so a building that missed
 * by 2% does not owe the same as one that missed by 40%.
 */
export type PenaltyModel =
  | {
      kind: 'gap-scaled'
      /** Maximum $/ft² — charged in full only at or beyond `fullPenaltyGapPct`. */
      maxRatePerSqFt: number
      /** Shortfall (% of target) at which the full rate applies. */
      fullPenaltyGapPct: number
      /** Floor on the rate once a building is non-compliant at all. */
      minRatePerSqFt: number
      capUsd: number | null
    }
  | {
      kind: 'flat-per-sqft'
      ratePerSqFt: number
      capUsd: number | null
    }
  | {
      kind: 'per-day'
      ratePerDay: number
      maxDays: number
    }

export interface PenaltySchedule {
  jurisdiction: Jurisdiction
  cycleId: string
  model: PenaltyModel
  verification: Verification
  citationUrl: string | null
  basis: string
}

// --- Cycles ---------------------------------------------------------------

/**
 * Montgomery County phases BEPS in by building use and size, and the phase
 * decides the deadline. This is the part a placeholder cannot fake: a 60,000
 * ft² office is judged on calendar year 2028 while a 60,000 ft² apartment
 * building is judged on 2031, and quoting either the other one's date is a
 * missed deadline or a false alarm.
 *
 * VERIFIED 2026-11-18 against Montgomery County DEP's Building Energy
 * Performance Standards page. Covered buildings are 25,000 ft² and larger.
 *
 * The county also runs a County-owned group (50,000 ft² and up, on the same
 * 2028/2033 dates as Groups 1 and 2). Ownership is not in the schema, so a
 * county-owned building is grouped by size and use like any other; for
 * anything 50,000 ft² and over that lands on the same dates anyway.
 */
export interface MocoGroup {
  id: string
  label: string
  /** Groups 4 and 5 cover multifamily; Groups 1–3 cover everything else. */
  multifamily: boolean
  minSqFt: number
  /** Exclusive upper bound, ft². Null for the largest group in its track. */
  maxSqFt: number | null
  /** Calendar year whose full 12 months are judged against the interim standard. */
  interimYear: number
  /** Calendar year judged against the final standard. */
  finalYear: number
}

export const MOCO_GROUPS: MocoGroup[] = [
  { id: 'g1', label: 'Group 1 · Non-residential 250,000 ft²+', multifamily: false, minSqFt: 250_000, maxSqFt: null, interimYear: 2028, finalYear: 2033 },
  { id: 'g2', label: 'Group 2 · Non-residential 50,000–250,000 ft²', multifamily: false, minSqFt: 50_000, maxSqFt: 250_000, interimYear: 2028, finalYear: 2033 },
  { id: 'g3', label: 'Group 3 · Non-residential 25,000–50,000 ft²', multifamily: false, minSqFt: 25_000, maxSqFt: 50_000, interimYear: 2030, finalYear: 2035 },
  { id: 'g4', label: 'Group 4 · Multifamily 250,000 ft²+', multifamily: true, minSqFt: 250_000, maxSqFt: null, interimYear: 2030, finalYear: 2035 },
  { id: 'g5', label: 'Group 5 · Multifamily 25,000–250,000 ft²', multifamily: true, minSqFt: 25_000, maxSqFt: 250_000, interimYear: 2031, finalYear: 2036 },
]

/**
 * Montgomery County treats these as multifamily for grouping. Residence halls
 * and senior care communities are deliberately NOT here: the county lists them
 * as non-residential property types, and putting them in the multifamily track
 * would push their deadlines two or three years later than they really are.
 */
const MOCO_MULTIFAMILY_TYPES: readonly PropertyType[] = ['Multifamily Housing']

/** The group a building falls in, or null if it is under the 25,000 ft² floor. */
export function mocoGroupFor(propertyType: PropertyType, grossFloorAreaSqFt: number): MocoGroup | null {
  const multifamily = MOCO_MULTIFAMILY_TYPES.includes(propertyType)
  return (
    MOCO_GROUPS.find(
      (g) =>
        g.multifamily === multifamily &&
        grossFloorAreaSqFt >= g.minSqFt &&
        (g.maxSqFt === null || grossFloorAreaSqFt < g.maxSqFt),
    ) ?? null
  )
}

/**
 * Reporting is due to DEP by June 1 of the year after the performance year,
 * so that date — not December 31 of the performance year — is the deadline a
 * customer is actually working to. A Building Performance Improvement Plan is
 * due 90 days before it.
 */
function mocoCycles(): BepsCycle[] {
  return MOCO_GROUPS.flatMap((g) => [
    {
      id: `moco-${g.id}-interim`,
      jurisdiction: 'montgomery-md' as const,
      label: `MoCo Interim · ${g.label.split(' · ')[0]} (CY${g.interimYear})`,
      periodStart: `${g.interimYear}-01-01`,
      periodEnd: `${g.interimYear}-12-31`,
      complianceDate: `${g.interimYear + 1}-06-01`,
      coverageMinSqFt: g.minSqFt,
    },
    {
      id: `moco-${g.id}-final`,
      jurisdiction: 'montgomery-md' as const,
      label: `MoCo Final · ${g.label.split(' · ')[0]} (CY${g.finalYear})`,
      periodStart: `${g.finalYear}-01-01`,
      periodEnd: `${g.finalYear}-12-31`,
      complianceDate: `${g.finalYear + 1}-06-01`,
      coverageMinSqFt: g.minSqFt,
    },
  ])
}

export const CYCLES: BepsCycle[] = [
  {
    id: 'dc-cycle-1',
    jurisdiction: 'dc',
    label: 'DC BEPS Cycle 1',
    periodStart: '2021-01-01',
    periodEnd: '2026-12-31',
    complianceDate: '2026-12-31',
    coverageMinSqFt: 50_000,
  },
  {
    id: 'dc-cycle-2',
    jurisdiction: 'dc',
    label: 'DC BEPS Cycle 2',
    periodStart: '2027-01-01',
    periodEnd: '2032-12-31',
    complianceDate: '2032-12-31',
    coverageMinSqFt: 25_000,
  },
  ...mocoCycles(),
]

// --- DC standards ---------------------------------------------------------
//
// VERIFIED 2026-11-18 against the text of the rulemaking that adds 20 DCMR
// § 3530, "2021 Building energy performance standards (BEPS)". Every value
// below was read off the § 3530.1 table, not inferred and not taken from
// commentary. Six of the previous placeholders were wrong, two of them by
// more than threefold (Non-Refrigerated Warehouse was carried as 71 against
// an actual 19; Worship Facility as 63 against an actual 17), which is
// precisely what this field exists to catch before a number reaches a client.
//
// § 3530.1 sets the standard for buildings not covered by § 3530.2 (hospital
// campuses) or § 3530.3 (college/university campuses), and applies to
// privately-owned buildings ≥ 50,000 ft² GFA and District-owned buildings
// ≥ 10,000 ft² GFA. The "ENERGY STAR Score" column governs property types
// that can receive a score; the "Source EUI" column governs those that
// cannot. All EUI values are kBtu/ft² unless the rule says otherwise.
//
// Primary source read: the § 3530 rulemaking text, mirrored at
// https://services.statescape.com/ssu/Regs/ss_8585818041106816338.htm
// Method and data provenance: DOEE, "Guide to the 2021 BEPS",
// https://doee.dc.gov/sites/default/files/dc/sites/ddoe/publication/attachments/1_Guide%20to%20the%202021%20BEPS.pdf

/**
 * [property type, ENERGY STAR score standard, provenance].
 *
 * § 3530.1. Rows map onto the rule's property-type names as follows:
 * Supermarket → "Supermarket/Grocery Store", Hospital → "Hospital (General
 * Medical & Surgical)", Senior Living Community → "Senior Care Community",
 * Residence Hall → "Residence Hall/Dormitory". 'Other' carries no score in
 * the rule and is governed by its source-EUI ceiling instead.
 */
const DC_SCORE_TARGETS: Array<[PropertyType, number, Verification]> = [
  ['Office', 71, 'verified'],
  ['Multifamily Housing', 66, 'verified'],
  ['Hotel', 54, 'verified'],
  ['K-12 School', 36, 'verified'],
  ['Retail Store', 64, 'verified'],
  ['Hospital', 50, 'verified'],
  ['Supermarket', 64, 'verified'],
  ['Medical Office', 62, 'verified'],
  ['Non-Refrigerated Warehouse', 19, 'verified'],
  ['Worship Facility', 17, 'verified'],
  ['Senior Living Community', 50, 'verified'],
  ['Residence Hall', 56, 'verified'],
  ['Bank Branch', 71, 'verified'],
]

/**
 * Source-EUI ceilings from the same § 3530.1 table, for buildings that cannot
 * receive an ENERGY STAR score. Previously only 'Other' had a fallback, and
 * at a placeholder value of 150 against an actual 229.4; every covered type
 * now carries the published ceiling, so a scoreless building is judged
 * against the rule rather than dropped.
 */
const DC_SOURCE_EUI_TARGETS: Array<[PropertyType, number, Verification]> = [
  ['Office', 153.7, 'verified'],
  ['Multifamily Housing', 110.7, 'verified'],
  ['Hotel', 183.9, 'verified'],
  ['K-12 School', 139, 'verified'],
  ['Retail Store', 401.2, 'verified'],
  ['Hospital', 426.9, 'verified'],
  ['Supermarket', 401.2, 'verified'],
  ['Medical Office', 172, 'verified'],
  ['Non-Refrigerated Warehouse', 103.7, 'verified'],
  ['Worship Facility', 140.3, 'verified'],
  ['Senior Living Community', 213.2, 'verified'],
  ['Residence Hall', 141.4, 'verified'],
  ['Bank Branch', 153.7, 'verified'],
  ['Other', 229.4, 'verified'],
]

/**
 * § 3530.2 sets different figures for buildings on a hospital campus: the
 * score standard is the same 50, but the source-EUI ceiling is 433.9 rather
 * than 426.9, and associated outpatient types shift too (Ambulatory Surgical
 * Center 138.3 against 426.9 on the general table). The portal does not yet
 * know which buildings sit on a hospital campus, so it judges them on the
 * § 3530.1 figures; for a general hospital the score standard is identical
 * either way, and the EUI ceiling it uses is the stricter of the two.
 */
export const DC_HOSPITAL_CAMPUS_SOURCE_EUI = 433.9

// --- Montgomery County standards -----------------------------------------
//
// The county judges a building on NN EUI — Normalized Net Site EUI — which is
// site EUI weather-normalized with parking, EV charging and on-site renewable
// generation factored out. That is not the same quantity as the plain site EUI
// this table was originally written against, and the difference runs in the
// building's favour: a garage or a rooftop array that inflates plain site EUI
// comes out of NN EUI. The engine judges MoCo on the weather-normalized site
// EUI reported by ESPM, which is the closest figure ESPM publishes; it does not
// yet net out parking, EV or renewables, so a building with any of those is
// judged slightly harsher here than the county would judge it.
//
// Missing a Montgomery County standard does not simply produce a fine. The
// building owner must file a Building Performance Improvement Plan (BPIP),
// due 90 days before the June 1 reporting deadline, and the county works the
// plan with the owner. The per-day citations modelled below are the backstop
// for not complying with that process, not the headline cost of missing a
// target — see the note on PENALTIES.
//
// Montgomery County buildings are exempt from Maryland's statewide BEPS under
// HB 49, so a county building is judged against the county standard only and
// must not be double-counted against the state's.
//
// Source read 2026-11-18: https://www.montgomerycountymd.gov/department-environmental-protection/energy/energy-commercial-multifamily/building-energy-performance-standards

/**
 * ⚠ These EUI ceilings are still placeholders.
 *
 * The group schedule and metric above are now read off the county's own
 * material, but the published NN EUI target table by property type is not in
 * hand, so every value below stays 'needs-verification' and every MoCo figure
 * the portal shows carries a caveat. The structure is right; the numbers are
 * not yet quotable.
 */
const MOCO_SITE_EUI: Array<[PropertyType, number, number]> = [
  // [type, interim 2030 target, final 2035 target]  kBtu/ft²/yr
  ['Office', 55, 40],
  ['Multifamily Housing', 50, 38],
  ['Hotel', 68, 52],
  ['K-12 School', 47, 36],
  ['Retail Store', 52, 40],
  ['Supermarket', 180, 140],
  ['Hospital', 175, 140],
  ['Medical Office', 70, 54],
  ['Non-Refrigerated Warehouse', 28, 21],
  ['Worship Facility', 34, 26],
  ['Senior Living Community', 82, 63],
  ['Residence Hall', 60, 46],
  ['Bank Branch', 62, 48],
  ['Other', 65, 50],
]

export const STANDARDS: BepsStandard[] = [
  ...DC_SCORE_TARGETS.map(([propertyType, targetValue, verification]): BepsStandard => ({
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-1',
    propertyType,
    metric: 'energy-star-score',
    targetValue,
    direction: 'at-or-above',
    verification,
    note: 'ENERGY STAR score standard from 20 DCMR § 3530.1 — the District median for this property type in the 2019 benchmarking data.',
  })),
  ...DC_SOURCE_EUI_TARGETS.map(([propertyType, targetValue, verification]): BepsStandard => ({
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-1',
    propertyType,
    metric: 'source-eui',
    targetValue,
    direction: 'at-or-below',
    verification,
    note: 'Source-EUI ceiling from 20 DCMR § 3530.1, used where the building has no ENERGY STAR score.',
  })),
  ...MOCO_GROUPS.flatMap((group) =>
    MOCO_SITE_EUI.flatMap(([propertyType, interim, final]): BepsStandard[] => {
      // Groups 1-3 cover non-residential buildings and 4-5 multifamily, so a
      // multifamily standard under a non-residential group would never match a
      // real building and would only pad the table.
      if (group.multifamily !== (propertyType === 'Multifamily Housing')) return []
      return [
        {
          jurisdiction: 'montgomery-md',
          cycleId: `moco-${group.id}-interim`,
          propertyType,
          metric: 'site-eui',
          targetValue: interim,
          direction: 'at-or-below',
          verification: 'needs-verification',
          note: `${group.label}. Judged on NN EUI over calendar year ${group.interimYear}; reported to DEP by June 1, ${group.interimYear + 1}.`,
        },
        {
          jurisdiction: 'montgomery-md',
          cycleId: `moco-${group.id}-final`,
          propertyType,
          metric: 'site-eui',
          targetValue: final,
          direction: 'at-or-below',
          verification: 'needs-verification',
          note: `${group.label}. Judged on NN EUI over calendar year ${group.finalYear}; reported to DEP by June 1, ${group.finalYear + 1}.`,
        },
      ]
    }),
  ),
]

// --- Penalties ------------------------------------------------------------

// ⚠ Why the DC rate is still 'secondary-source' after a source check.
//
// Checked 2026-11-18. DC Code § 8-1772.21(i) delegates the money entirely:
// DOEE "may impose civil infraction penalties, fines, and fees as sanctions
// for a violation of this section or a regulation issued pursuant to this
// section, pursuant to Chapter 18 of Title 2". It names no rate. The $10/ft²
// figure and the $7.5M cap appear only in commentary, and that commentary
// disagrees with itself on two points that change the number a customer sees:
// whether the payment is assessed annually or once per compliance cycle (a
// 6x difference over Cycle 1), and whether enforcement begins in 2025 or
// 2027. Until the DOEE fine schedule itself is in hand this stays unverified,
// which is the correct outcome rather than a failed one: the engine quotes it
// with a caveat instead of as a bill.
export const PENALTIES: PenaltySchedule[] = [
  {
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-1',
    model: {
      kind: 'gap-scaled',
      maxRatePerSqFt: 10,
      fullPenaltyGapPct: 25,
      minRatePerSqFt: 1.5,
      // $7.5M per building. Without this a large non-compliant property
      // produced a headline figure far above anything DC can actually levy.
      capUsd: 7_500_000,
    },
    verification: 'secondary-source',
    citationUrl: 'https://doee.dc.gov/service/BEPS',
    basis:
      'Alternative compliance payment of up to $10 per ft² of gross floor area, scaled by the percentage of progress made toward the standard, capped at $7,500,000 per building (and per hospital or university campus).',
  },
  {
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-2',
    model: {
      kind: 'gap-scaled',
      maxRatePerSqFt: 10,
      fullPenaltyGapPct: 25,
      minRatePerSqFt: 1.5,
      capUsd: 7_500_000,
    },
    verification: 'needs-verification',
    citationUrl: 'https://doee.dc.gov/service/BEPS',
    basis: 'Assumed to follow the Cycle 1 structure; confirm when Cycle 2 rulemaking is final.',
  },
  // ⚠ Montgomery County does not charge per square foot at all, and a fine is
  // not the first consequence of missing a standard.
  //
  // Missing a target obliges the owner to file a Building Performance
  // Improvement Plan (BPIP), due 90 days before the June 1 reporting deadline.
  // The citations below are the backstop for not complying with that process.
  // No penalty amounts are published on the county's BEPS page, so these
  // figures come from commentary and stay unverified.
  //
  // This was originally modelled as a per-ft² payment like DC's, which was
  // wrong in kind rather than in magnitude: it turned a fine measured in
  // thousands into an exposure figure measured in millions for a large
  // building. A daily civil fine means a 310,000 ft² tower's exposure is the
  // same as a 30,000 ft² one's.
  //
  // Maryland HB 29 may bring county penalties closer to the state's
  // alternative compliance payments, which would make this per-ft² after all.
  // Until that is settled, the smaller and better-sourced model is the honest
  // one: overstating a customer's exposure by three orders of magnitude is a
  // worse failure than understating it.
  ...MOCO_GROUPS.flatMap((group): PenaltySchedule[] => [
    {
      jurisdiction: 'montgomery-md',
      cycleId: `moco-${group.id}-interim`,
      model: { kind: 'per-day', ratePerDay: 500, maxDays: 10 },
      verification: 'needs-verification',
      citationUrl:
        'https://www.montgomerycountymd.gov/department-environmental-protection/energy/energy-commercial-multifamily/building-energy-performance-standards',
      basis:
        'Missing the interim standard requires a Building Performance Improvement Plan, not a payment. Civil citation of $500 per day, capped at $5,000, applies to non-compliance with the process. Not assessed per ft². Amounts not published by the county.',
    },
    {
      jurisdiction: 'montgomery-md',
      cycleId: `moco-${group.id}-final`,
      model: { kind: 'per-day', ratePerDay: 750, maxDays: 10 },
      verification: 'needs-verification',
      citationUrl:
        'https://www.montgomerycountymd.gov/department-environmental-protection/energy/energy-commercial-multifamily/building-energy-performance-standards',
      basis:
        'Repeat civil citation of $750 per day, capped at $5,000. Maryland HB 29 may replace this with an alternative compliance payment assessed per ft². Amounts not published by the county.',
    },
  ]),
]

// --- Lookups --------------------------------------------------------------

export function cyclesFor(jurisdiction: Jurisdiction): BepsCycle[] {
  return CYCLES.filter((c) => c.jurisdiction === jurisdiction)
}

/**
 * The cycles that actually apply to one building.
 *
 * DC applies its cycles to every covered building, so this is the same as
 * `cyclesFor` there. Montgomery County does not: a building belongs to exactly
 * one size-and-use group, and only that group's interim and final cycles are
 * its own. Judging a MoCo building against all five groups' cycles would show
 * a customer ten deadlines, eight of which are someone else's.
 *
 * A building under the county's 25,000 ft² floor gets no cycles, which the
 * engine renders as "not covered" rather than as compliant.
 */
export function cyclesForBuilding(
  building: Pick<Building, 'jurisdiction' | 'propertyType' | 'grossFloorAreaSqFt'>,
): BepsCycle[] {
  if (building.jurisdiction !== 'montgomery-md') return cyclesFor(building.jurisdiction)
  const group = mocoGroupFor(building.propertyType, building.grossFloorAreaSqFt)
  if (!group) return []
  return CYCLES.filter((c) => c.id === `moco-${group.id}-interim` || c.id === `moco-${group.id}-final`)
}

export function cycleById(cycleId: string): BepsCycle | undefined {
  return CYCLES.find((c) => c.id === cycleId)
}

export function standardFor(
  jurisdiction: Jurisdiction,
  cycleId: string,
  propertyType: PropertyType,
): BepsStandard | undefined {
  return (
    STANDARDS.find(
      (s) => s.jurisdiction === jurisdiction && s.cycleId === cycleId && s.propertyType === propertyType,
    ) ??
    // Unlisted property types fall back to 'Other' rather than silently
    // reporting "no standard", which would read as "you are fine".
    STANDARDS.find(
      (s) => s.jurisdiction === jurisdiction && s.cycleId === cycleId && s.propertyType === 'Other',
    )
  )
}

export function penaltyFor(jurisdiction: Jurisdiction, cycleId: string): PenaltySchedule | undefined {
  return PENALTIES.find((p) => p.jurisdiction === jurisdiction && p.cycleId === cycleId)
}

/** True when every constant behind this jurisdiction has been human-checked. */
export function jurisdictionIsVerified(jurisdiction: Jurisdiction): boolean {
  const standards = STANDARDS.filter((s) => s.jurisdiction === jurisdiction)
  const penalties = PENALTIES.filter((p) => p.jurisdiction === jurisdiction)
  return (
    standards.length > 0 &&
    standards.every((s) => isConfirmed(s.verification)) &&
    penalties.every((p) => isConfirmed(p.verification))
  )
}
