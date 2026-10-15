// ---------------------------------------------------------------------------
// HBS Client Portal — core domain model.
//
// One rule governs this file: every shape here is the *portal's* view of the
// world, not ENERGY STAR Portfolio Manager's. ESPM wire shapes live in
// server/src/espm/types.ts and are translated at the boundary
// (server/src/espm/mapper.ts). That seam is what lets the portal keep local
// edits, drafts, and history that ESPM has no concept of — and what lets us
// swap how we talk to ESPM without touching the product.
// ---------------------------------------------------------------------------

// --- Identity -------------------------------------------------------------

/**
 * `hbs_staff` see every organization; customer roles are scoped to their own.
 * `customer_admin` may invite users and push data back to ESPM;
 * `customer_viewer` is read-only. Scoping is enforced server-side on every
 * query — never by hiding UI.
 */
export type UserRole = 'hbs_staff' | 'customer_admin' | 'customer_viewer'

export interface Organization {
  id: string
  name: string
  /** Primary contact address; used as the default CC target for email threads. */
  billingEmail: string | null
  /** Service tier drives which upsell recommendations are surfaced vs. hidden. */
  tier: ServiceTier
  createdAt: string
}

export type ServiceTier = 'benchmarking' | 'compliance' | 'managed'

export interface User {
  id: string
  organizationId: string | null // null only for hbs_staff
  email: string
  fullName: string
  role: UserRole
  lastLoginAt: string | null
  createdAt: string
}

// --- Buildings ------------------------------------------------------------

/**
 * ESPM property types, narrowed to those we actually see in the DC/MoCo BEPS
 * covered-building lists. `propertyType` selects the BEPS standard, so adding
 * a type here means adding its targets in beps/standards.ts.
 */
export type PropertyType =
  | 'Office'
  | 'Multifamily Housing'
  | 'Hotel'
  | 'K-12 School'
  | 'Retail Store'
  | 'Supermarket'
  | 'Hospital'
  | 'Medical Office'
  | 'Non-Refrigerated Warehouse'
  | 'Worship Facility'
  | 'Senior Living Community'
  | 'Residence Hall'
  | 'Bank Branch'
  | 'Other'

export type Jurisdiction = 'dc' | 'montgomery-md' | 'none'

export interface Building {
  id: string
  organizationId: string
  /** ESPM property id. Null until the property is linked/created in ESPM. */
  espmPropertyId: number | null
  name: string
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  propertyType: PropertyType
  /** Conditioned gross floor area, ft². Drives every intensity and every fine. */
  grossFloorAreaSqFt: number
  yearBuilt: number | null
  jurisdiction: Jurisdiction
  /**
   * The phase or portfolio this building is filed under. Null means unfiled,
   * which is a normal state, not an error — the portfolio view lists those
   * separately rather than hiding them.
   */
  groupId: string | null
  /** Set when the customer disputes coverage or has an approved exemption. */
  complianceExempt: boolean
  exemptionNote: string | null
  lastSyncedAt: string | null
  createdAt: string
}

// --- Metrics --------------------------------------------------------------

/**
 * One row per building per calendar year: the annual figures BEPS is judged
 * on. `source` records where the numbers came from, which matters because a
 * locally-entered year is provisional until ESPM has recomputed it.
 */
export interface MetricYear {
  id: string
  buildingId: string
  year: number
  energyStarScore: number | null
  siteEui: number | null // kBtu/ft²/yr
  sourceEui: number | null // kBtu/ft²/yr
  weatherNormalizedSiteEui: number | null
  totalGhgEmissions: number | null // metric tons CO2e/yr
  ghgIntensity: number | null // kgCO2e/ft²/yr
  waterUseIntensity: number | null // gal/ft²/yr
  totalSiteEnergyKbtu: number | null
  source: MetricSource
  recordedAt: string
}

export type MetricSource = 'espm' | 'portal-entry' | 'estimated'

/** A physical meter as the portal tracks it; mirrors an ESPM meter 1:1. */
export interface Meter {
  id: string
  buildingId: string
  espmMeterId: number | null
  name: string
  type: MeterType
  unit: string
  active: boolean
}

export type MeterType =
  | 'Electric - Grid'
  | 'Natural Gas'
  | 'Fuel Oil No. 2'
  | 'District Steam'
  | 'District Chilled Water'
  | 'Propane'
  | 'Potable Water'

/**
 * A single billing period of consumption. This is the record the customer
 * creates in the portal and that we push back to ESPM — `syncState` tracks
 * that round trip and is the reason two-way sync is auditable.
 */
export interface ConsumptionEntry {
  id: string
  meterId: string
  buildingId: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  quantity: number
  unit: string
  cost: number | null
  estimated: boolean
  espmConsumptionId: number | null
  syncState: SyncState
  syncError: string | null
  enteredByUserId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The lifecycle of anything the portal owes ESPM.
 *   local   — created here, not yet sent
 *   pending — a push is in flight
 *   synced  — ESPM acknowledged it and gave us an id
 *   failed  — ESPM rejected it; `syncError` says why, and the row stays
 *             editable so the customer can correct and retry
 *   remote  — came from ESPM, we have made no local change
 */
export type SyncState = 'local' | 'pending' | 'synced' | 'failed' | 'remote'

// --- Compliance -----------------------------------------------------------

export type ComplianceStatus =
  | 'compliant'
  | 'at-risk'
  | 'non-compliant'
  | 'exempt'
  | 'insufficient-data'

/**
 * The result of judging one building against one jurisdiction's standard for
 * one cycle. Computed, never stored as truth — recomputing from metrics keeps
 * it honest when a standard or a number changes.
 */
export interface ComplianceAssessment {
  buildingId: string
  jurisdiction: Jurisdiction
  cycleId: string
  cycleLabel: string
  complianceDate: string
  status: ComplianceStatus
  /** Which metric the standard is expressed in, and how we measured against it. */
  metric: 'energy-star-score' | 'site-eui' | 'source-eui' | 'ghg-intensity'
  targetValue: number | null
  currentValue: number | null
  /**
   * Signed distance to the target, in the metric's own units. Positive means
   * short of the target (bad). Null when we lack data.
   */
  gap: number | null
  /** Percent of the target achieved, clamped 0-200 for display. */
  percentOfTarget: number | null
  estimatedPenalty: PenaltyEstimate | null
  notes: string[]
}

export interface PenaltyEstimate {
  /** Best estimate in USD. */
  amount: number
  low: number
  high: number
  basis: string
  /**
   * False whenever any constant behind this figure is still unverified against
   * the published rule. The UI must not show an unverified number without its
   * caveat. See beps/standards.ts.
   */
  verified: boolean
  citationUrl: string | null
}

// --- Communication --------------------------------------------------------

/**
 * A conversation about a building or an organization. `emailCcAddresses` is
 * what makes the portal thread and the customer's inbox the same conversation:
 * every portal reply is emailed to those addresses, and replies to that email
 * land back on this thread.
 */
export interface MessageThread {
  id: string
  organizationId: string
  buildingId: string | null
  subject: string
  status: 'open' | 'closed'
  emailCcAddresses: string[]
  createdByUserId: string
  lastMessageAt: string
  createdAt: string
}

export interface Message {
  id: string
  threadId: string
  authorUserId: string | null
  /** Set when the message arrived by email rather than from a signed-in user. */
  authorEmail: string | null
  authorName: string
  body: string
  channel: 'portal' | 'email'
  createdAt: string
}

// --- Alerts and recommendations -------------------------------------------

export type AlertSeverity = 'critical' | 'warning' | 'info'

export type AlertKind =
  | 'compliance-shortfall'
  | 'usage-spike'
  | 'usage-anomaly'
  | 'missing-data'
  | 'deadline-approaching'
  | 'sync-failure'

export interface Alert {
  id: string
  organizationId: string
  buildingId: string | null
  kind: AlertKind
  severity: AlertSeverity
  title: string
  detail: string
  acknowledgedAt: string | null
  createdAt: string
}

/**
 * A service we can sell, surfaced only when a building's own numbers say it
 * would help. `trigger` is evaluated against the compliance assessment so the
 * pitch is always specific ("you are 14 points under the Office standard")
 * rather than a banner ad.
 */
export interface ServiceOffering {
  id: string
  name: string
  summary: string
  /** Tiers that already include this — never upsell what they already pay for. */
  includedInTiers: ServiceTier[]
  trigger: RecommendationTrigger
  ctaLabel: string
  learnMoreUrl: string | null
}

export type RecommendationTrigger =
  | { kind: 'eui-above-target'; minGapPct: number }
  | { kind: 'score-below-target'; minGapPoints: number }
  | { kind: 'ghg-above-target'; minGapPct: number }
  | { kind: 'penalty-exposure'; minAmount: number }
  | { kind: 'missing-data' }
  | { kind: 'always' }

export interface Recommendation {
  offering: ServiceOffering
  buildingId: string
  /** Rendered, building-specific reason this is being shown. */
  reason: string
  /** Rough annualized dollars at stake, when we can compute it. */
  potentialValue: number | null
}

// --- Reports and sync audit ----------------------------------------------

export interface ReportRecord {
  id: string
  organizationId: string
  buildingId: string | null
  kind: 'annual-compliance' | 'portfolio-summary' | 'benchmarking' | 'anomaly-review'
  periodLabel: string
  status: 'queued' | 'ready' | 'failed'
  filePath: string | null
  generatedAt: string | null
  createdAt: string
}

export interface SyncRun {
  id: string
  connectionId: string
  direction: 'pull' | 'push'
  scope: string
  status: 'running' | 'success' | 'partial' | 'failed'
  itemsProcessed: number
  itemsFailed: number
  message: string | null
  startedAt: string
  finishedAt: string | null
}

/**
 * How the portal reaches ESPM. Modelled as a row rather than a global config
 * so that "one HBS service-provider account" and "this customer connected
 * their own account" are the same code path with different data.
 */
export interface EspmConnection {
  id: string
  label: string
  /** Null for the shared HBS account; set when a customer owns the connection. */
  organizationId: string | null
  espmAccountId: number | null
  username: string
  environment: 'test' | 'live'
  active: boolean
  lastPullAt: string | null
  createdAt: string
}
