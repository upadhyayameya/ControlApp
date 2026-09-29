/**
 * Domain types for Watt on Earth.
 *
 * These are deliberately storage-agnostic: in Stage 1 they describe data held in
 * the repo (MDX, JSON, TS) or in the browser. In Stage 2 (client portal) and
 * Stage 3 (ops dashboard) the same shapes map onto Supabase tables, so keep
 * field names snake-case-convertible and avoid UI-only concerns here.
 */

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

/** ISO date string, e.g. "2026-04-01". */
export type ISODate = string;

export type Regime = "CCTS" | "CBAM" | "BRSR" | "ECBC";
export const REGIMES: readonly Regime[] = ["CCTS", "CBAM", "BRSR", "ECBC"] as const;

/* ------------------------------------------------------------------ */
/* Assumptions (benchmarks, emission factors, tariffs)                 */
/* ------------------------------------------------------------------ */

export interface Assumption {
  /** Numeric value used in calculations. */
  value: number;
  unit: string;
  /** Human-readable label. */
  label: string;
  /** Publication the value should come from. */
  source: string;
  sourceUrl: string;
  /** `false` until Ameya has checked the value against the source. */
  verified: boolean;
  /** Date the value was last checked against the source. `null` = never. */
  lastChecked: ISODate | null;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Facilities & the Energy & Carbon Check                              */
/* ------------------------------------------------------------------ */

export type FacilityType = "hotel" | "office" | "hospital" | "retail" | "manufacturing";

export type ManufacturingSubType =
  | "steel"
  | "aluminium"
  | "cement"
  | "textiles"
  | "auto_components"
  | "other";

/** ECBC climate zones. */
export type ClimateZone = "hot_dry" | "warm_humid" | "composite" | "temperate" | "cold";

export type AreaUnit = "m2" | "ft2";

export interface MonthlyReading {
  /** "YYYY-MM" */
  month: string;
  kwh: number;
  /** Bill amount in ₹; optional because some users only have kWh. */
  amountInr: number | null;
}

export interface CheckInput {
  facilityType: FacilityType;
  manufacturingSubType: ManufacturingSubType | null;
  /** Floor area as entered, in `areaUnit`. Not used for manufacturing. */
  floorArea: number | null;
  areaUnit: AreaUnit;
  /** Annual production in tonnes (manufacturing only). */
  annualProductionTonnes: number | null;
  city: string;
  state: string;
  climateZone: ClimateZone;
  /** Hotels only. */
  rooms: number | null;
  months: MonthlyReading[];
  /** Annual totals for optional fuels / generation. */
  dieselLitres: number | null;
  lpgKg: number | null;
  pngScm: number | null;
  solarKwh: number | null;
  exportsToEU: boolean;
  listedOrSupplierToListed: boolean;
}

export type BenchmarkBand = "good" | "typical" | "poor";

export interface BenchmarkRange {
  /** At or below this value = good. */
  goodMax: number;
  /** Above this value = poor. */
  poorMin: number;
  unit: string;
  verified: boolean;
}

export interface MonthFlag {
  month: string;
  reason: string;
}

export type ExposureLevel = "high" | "medium" | "low" | "not_applicable";

export interface RegulatoryExposure {
  regime: Regime;
  level: ExposureLevel;
  headline: string;
  detail: string;
  trackerHref: string;
}

export interface CheckResult {
  /** "EPI" for buildings, "SEC" for plants. */
  metricKind: "EPI" | "SEC";
  metricValue: number;
  metricUnit: string;
  benchmark: BenchmarkRange | null;
  band: BenchmarkBand | null;
  annualGridKwh: number;
  annualSiteElectricityKwh: number;
  annualBillInr: number | null;
  effectiveTariffInrPerKwh: number;
  tariffIsAssumed: boolean;
  kwhPerRoom: number | null;
  monthFlags: MonthFlag[];
  savings: {
    kwhLow: number;
    kwhHigh: number;
    inrLow: number;
    inrHigh: number;
  };
  measures: string[];
  emissions: {
    scope1: number;
    scope2: number;
    total: number;
    breakdown: { label: string; tco2e: number; scope: 1 | 2 }[];
  };
  exposure: RegulatoryExposure[];
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

export type LeadSource = "contact" | "check" | "newsletter";

export interface Lead {
  source: LeadSource;
  name?: string;
  email: string;
  company?: string;
  phone?: string;
  sector?: string;
  city?: string;
  message?: string;
  /** Free-form structured payload, e.g. Check inputs & results. */
  payload?: Record<string, unknown>;
  createdAt?: ISODate;
}

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

export const NEWS_TAGS = [
  "CCTS",
  "CBAM",
  "BRSR",
  "ECBC",
  "Energy Prices",
  "Carbon Markets",
  "Efficiency",
] as const;
export type NewsTag = (typeof NEWS_TAGS)[number];

export const NEWS_SECTORS = ["Hotels", "Commercial", "Manufacturing", "Exporters"] as const;
export type NewsSector = (typeof NEWS_SECTORS)[number];

export type PostStatus = "draft" | "published";
export type PostType = "news" | "roundup";

export interface NewsFrontmatter {
  title: string;
  date: ISODate;
  summary: string;
  whatItMeans: string;
  tags: NewsTag[];
  sectors: NewsSector[];
  sourceName: string;
  sourceUrl: string;
  status: PostStatus;
  type: PostType;
}

export interface NewsPost extends NewsFrontmatter {
  slug: string;
  /** Raw MDX body (our commentary — never a republished article). */
  body: string;
}

/* ------------------------------------------------------------------ */
/* Regulation tracker                                                  */
/* ------------------------------------------------------------------ */

export type DateStatus = "confirmed" | "expected" | "tbc";

export interface RegulationMilestone {
  id: string;
  regime: Regime;
  milestone: string;
  date: ISODate;
  dateStatus: DateStatus;
  appliesTo: string;
  officialSourceUrl: string;
  notes: string;
  lastVerified: ISODate | null;
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export interface Service {
  slug: string;
  name: string;
  shortName: string;
  pillar: "measure" | "reduce" | "verify";
  tagline: string;
  whoFor: string[];
  deliverables: string[];
  howItWorks: string[];
  /** Displayed price text. `null` = not yet set (see README placeholders). */
  priceLabel: string | null;
  pricingModel: "fixed" | "subscription" | "project";
  relatedRegimes: Regime[];
}
