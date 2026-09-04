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

import type { Jurisdiction, PropertyType } from '../types.js'

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
  // ⚠ Montgomery County phases by building size: interim standards fall three
  // years after a building's benchmarking period and final standards five
  // years after that, so final dates land somewhere in 2033–2037 depending on
  // which group a building is in. The two cycles below are a placeholder for
  // that schedule, not the schedule itself — a building's real deadline
  // depends on its size group, which this does not yet model.
  {
    id: 'moco-interim-2030',
    jurisdiction: 'montgomery-md',
    label: 'Montgomery County Interim Standard',
    periodStart: '2024-01-01',
    periodEnd: '2030-12-31',
    complianceDate: '2030-12-31',
    coverageMinSqFt: 25_000,
  },
  {
    id: 'moco-final-2035',
    jurisdiction: 'montgomery-md',
    label: 'Montgomery County Final Standard',
    periodStart: '2031-01-01',
    periodEnd: '2035-12-31',
    complianceDate: '2035-12-31',
    coverageMinSqFt: 25_000,
  },
]

// --- DC standards ---------------------------------------------------------
//
// DC sets the standard at the local median ENERGY STAR score for the property
// type. The values below are placeholders in the right shape and the right
// ballpark; replace them from the DOEE published table.
// Source to check against: https://doee.dc.gov/beps

/**
 * [property type, standard, provenance].
 *
 * The six carrying 'secondary-source' were corroborated by two independent
 * searches of DC BEPS commentary in September 2026 (Office 71, Multifamily 66,
 * Hotel 54, Hospital 50, K-12 School 36, Retail 64). The rest are still
 * placeholders — no source was found for them, and inventing a number that
 * looks as confident as a sourced one is exactly the failure this field
 * exists to prevent.
 *
 * The primary source is DOEE's "Guide to the 2021 BEPS":
 * https://doee.dc.gov/sites/default/files/dc/sites/ddoe/publication/attachments/1_Guide%20to%20the%202021%20BEPS.pdf
 * It could not be fetched from the build environment (doee.dc.gov is blocked
 * by the network egress proxy), so nothing here is marked 'verified'.
 */
const DC_SCORE_TARGETS: Array<[PropertyType, number, Verification]> = [
  ['Office', 71, 'secondary-source'],
  ['Multifamily Housing', 66, 'secondary-source'],
  ['Hotel', 54, 'secondary-source'],
  ['K-12 School', 36, 'secondary-source'],
  ['Retail Store', 64, 'secondary-source'],
  ['Hospital', 50, 'secondary-source'],
  ['Supermarket', 51, 'needs-verification'],
  ['Medical Office', 66, 'needs-verification'],
  ['Non-Refrigerated Warehouse', 71, 'needs-verification'],
  ['Worship Facility', 63, 'needs-verification'],
  ['Senior Living Community', 57, 'needs-verification'],
  ['Residence Hall', 68, 'needs-verification'],
  ['Bank Branch', 78, 'needs-verification'],
]

/**
 * Property types with no ENERGY STAR score fall back to a source-EUI ceiling.
 * Only 'Other' needs this today; extend as the covered-buildings list grows.
 */
const DC_SOURCE_EUI_TARGETS: Array<[PropertyType, number]> = [['Other', 150]]

// --- Montgomery County standards -----------------------------------------
//
// Montgomery County expresses standards as normalized site EUI ceilings by
// property type, with an interim and a final target. Placeholders again —
// source to check against: https://www.montgomerycountymd.gov/green/energy/beps.html

/**
 * ⚠ Montgomery County's standard is not only a fixed EUI ceiling.
 *
 * A covered building complies by meeting the ceiling for its type and size
 * *or* by cutting site EUI 30% from its own baseline — whichever it reaches.
 * The engine currently judges only the ceiling, so a building making the 30%
 * cut but still above the ceiling is reported as short when it is not.
 * Modelling the reduction pathway needs a stored baseline year per building,
 * which the schema does not yet carry.
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
    note: 'DC standard is the local median ENERGY STAR score for this property type, from 2019 benchmarking data.',
  })),
  ...DC_SOURCE_EUI_TARGETS.map(([propertyType, targetValue]): BepsStandard => ({
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-1',
    propertyType,
    metric: 'source-eui',
    targetValue,
    direction: 'at-or-below',
    verification: 'needs-verification',
    note: 'No ENERGY STAR score for this type; judged on source EUI.',
  })),
  ...MOCO_SITE_EUI.flatMap(([propertyType, interim, final]): BepsStandard[] => [
    {
      jurisdiction: 'montgomery-md',
      cycleId: 'moco-interim-2030',
      propertyType,
      metric: 'site-eui',
      targetValue: interim,
      direction: 'at-or-below',
      verification: 'needs-verification',
    },
    {
      jurisdiction: 'montgomery-md',
      cycleId: 'moco-final-2035',
      propertyType,
      metric: 'site-eui',
      targetValue: final,
      direction: 'at-or-below',
      verification: 'needs-verification',
    },
  ]),
]

// --- Penalties ------------------------------------------------------------

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
      'Alternative compliance payment of up to $10 per ft² of gross floor area, scaled by how far the building fell short of the standard, capped at $7,500,000 per building.',
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
  // ⚠ Montgomery County does not charge per square foot at all.
  //
  // This was originally modelled as a per-ft² payment like DC's, which was
  // wrong in kind rather than in magnitude: it turned a fine measured in
  // thousands into an exposure figure measured in millions for a large
  // building. County penalties are a daily civil fine — reported as $500 per
  // day rising to $750, capped at $5,000 — so a 310,000 ft² tower's exposure
  // is the same as a 30,000 ft² one's.
  //
  // Maryland HB 29 may bring county penalties closer to the state's
  // alternative compliance payments, which would make this per-ft² after all.
  // Until that is settled, the smaller and better-sourced model is the honest
  // one: overstating a customer's exposure by three orders of magnitude is a
  // worse failure than understating it.
  {
    jurisdiction: 'montgomery-md',
    cycleId: 'moco-interim-2030',
    model: { kind: 'per-day', ratePerDay: 500, maxDays: 10 },
    verification: 'secondary-source',
    citationUrl:
      'https://www.montgomerycountymd.gov/department-environmental-protection/energy/energy-commercial-multifamily/building-energy-performance-standards',
    basis:
      'Civil citation of $500 per day for failing the interim standard, capped at $5,000. Not assessed per ft².',
  },
  {
    jurisdiction: 'montgomery-md',
    cycleId: 'moco-final-2035',
    model: { kind: 'per-day', ratePerDay: 750, maxDays: 10 },
    verification: 'secondary-source',
    citationUrl:
      'https://www.montgomerycountymd.gov/department-environmental-protection/energy/energy-commercial-multifamily/building-energy-performance-standards',
    basis:
      'Repeat civil citation of $750 per day, capped at $5,000. Maryland HB 29 may replace this with an alternative compliance payment assessed per ft².',
  },
]

// --- Lookups --------------------------------------------------------------

export function cyclesFor(jurisdiction: Jurisdiction): BepsCycle[] {
  return CYCLES.filter((c) => c.jurisdiction === jurisdiction)
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
