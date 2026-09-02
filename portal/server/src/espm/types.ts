// ---------------------------------------------------------------------------
// ENERGY STAR Portfolio Manager wire shapes.
//
// These mirror ESPM's XML, field for field and name for name — including the
// names we would not have chosen. Nothing outside this directory should import
// them; mapper.ts translates to and from the portal's own domain model so that
// an ESPM schema change is contained here.
//
// Reference: https://portfoliomanager.energystar.gov/webservices/home/api
// ---------------------------------------------------------------------------

/** A `<link>` from any ESPM list response. */
export interface EspmLink {
  /** e.g. "/property/1234567" — the path to fetch the item itself. */
  link: string
  /** ESPM's numeric id for the linked object. */
  id: number
  /** Human-readable name ESPM includes as a convenience. */
  hint?: string
  linkDescription?: string
}

export interface EspmAccount {
  id: number
  username: string
  organizationName?: string
  contactName?: string
  email?: string
}

export interface EspmProperty {
  id: number
  name: string
  /** ESPM's property type, e.g. "Office". Maps to our PropertyType. */
  primaryFunction: string
  address?: {
    address1?: string
    address2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  yearBuilt?: number
  /** ESPM reports the value and its unit separately. Always ft² for US accounts. */
  grossFloorArea?: { value: number; units: string }
  occupancyPercentage?: number
  numberOfBuildings?: number
  constructionStatus?: string
  isFederalProperty?: boolean
}

export interface EspmMeter {
  id: number
  name: string
  /** e.g. "Electric - Grid", "Natural Gas". */
  type: string
  unitOfMeasure: string
  metered: boolean
  inUse: boolean
  firstBillDate?: string
  inUseAsOf?: string
}

export interface EspmConsumption {
  id: number
  startDate: string
  endDate: string
  usage: number
  cost?: number
  estimatedValue: boolean
  /** ESPM echoes this back on reads; we do not set it. */
  energyExportedOffSite?: number
}

/**
 * One metric from `/property/{id}/metrics`. ESPM returns a flat list of these
 * keyed by name, with the value nested — hence the odd shape.
 */
export interface EspmMetric {
  name: string
  value: number | null
  uom?: string
  dataQuality?: string
}

/** ESPM's error envelope, surfaced as EspmApiError. */
export interface EspmErrorDetail {
  errorNumber?: string
  errorDescription: string
}

/**
 * The metric names we ask ESPM for, mapped to the portal's MetricYear fields.
 *
 * ⚠ These identifiers come from ESPM's metric reference and should be confirmed
 * against the live account once network access is available — an unrecognised
 * name is silently omitted from ESPM's response rather than erroring, so a typo
 * shows up as a permanently null column rather than a failure. `pullMetrics`
 * logs any requested name that came back absent, which is the tripwire for that.
 */
export const METRIC_NAMES = {
  score: 'score',
  siteEui: 'siteIntensity',
  sourceEui: 'sourceIntensity',
  weatherNormalizedSiteEui: 'siteIntensityWN',
  totalSiteEnergyKbtu: 'siteTotal',
  totalGhgEmissions: 'totalLocationBasedGHGEmissions',
  ghgIntensity: 'totalLocationBasedGHGEmissionsIntensity',
  waterUseIntensity: 'waterIntensityTotal',
} as const

export type MetricKey = keyof typeof METRIC_NAMES
