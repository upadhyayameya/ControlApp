/**
 * ALL numeric assumptions used by the Energy & Carbon Check live here.
 *
 * Each value records where it comes from (`basis`):
 *   - official  — read directly from a government publication;
 *   - derived   — calculated from published defaults (method in `notes`);
 *   - estimate  — a Watt on Earth estimate built from published averages,
 *                 clearly labelled as such in the UI and the PDF;
 *   - default   — a fallback the user can replace with their own data;
 *   - judgement — Watt on Earth engineering judgement, still provisional.
 * `verified: true` means Ameya approved the value against the source on
 * `lastChecked`. `npm run assumptions` lists everything still unverified
 * (defaults are excluded — they are meant to be overridden). A dev-only
 * banner is shown while any assumption is unverified.
 */
import type { Assumption, AssumptionBasis, ClimateZone, FacilityType, ManufacturingSubType } from "@/lib/types";

const PROVISIONAL = "Provisional —";
/** Date the approved values below were checked against their sources. */
const CHECKED = "2026-11-18";

const CEA_V22_URL = "https://cea.nic.in/api/cdm-report-version/view-pdf/en/82";
const IPCC_CH2_URL = "https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/2_Volume2/V2_2_Ch2_Stationary_Combustion.pdf";
const BEE_OFFICE_URL = "https://beeindia.gov.in/sites/default/files/BEE%20Star%20Rating%20for%20existing%20Office%20Buildings.pdf";
const BEE_MALL_URL = "https://beeindia.gov.in/sites/default/files/BEE%20Star%20Rating%20-%20Shopping%20Mall.pdf";
const BEE_UNDP_FLYER_URL = "https://www.beeindia.gov.in/sites/default/files/Flyer_22nd%20Jan.pdf";

function placeholder(a: Omit<Assumption, "verified" | "lastChecked" | "basis">, basis: AssumptionBasis = "judgement"): Assumption {
  return { ...a, basis, verified: false, lastChecked: null };
}

function approved(a: Omit<Assumption, "verified" | "lastChecked">): Assumption {
  return { ...a, verified: true, lastChecked: CHECKED };
}

/** A fallback value the user replaces with their own data. Not an official figure. */
function userDefault(a: Omit<Assumption, "verified" | "lastChecked" | "basis">): Assumption {
  return { ...a, basis: "default", verified: false, lastChecked: null };
}

/* ------------------------------------------------------------------ */
/* Emission factors                                                    */
/* ------------------------------------------------------------------ */

export const emissionFactors = {
  gridElectricity: approved({
    label: "Grid electricity emission factor (India, weighted average, FY 2025-26)",
    value: 0.675,
    unit: "tCO₂/MWh",
    basis: "official",
    source:
      "CEA CO₂ Baseline Database for the Indian Power Sector, User Guide Version 22.0 (Aug 2026), Table S — weighted average incl. RES & captive, adjusted for cross-border transfers",
    sourceUrl: CEA_V22_URL,
    notes: "Location-based Scope 2. Replace when CEA publishes the next version (FY 2024-25 was 0.710).",
  }),
  diesel: approved({
    label: "Diesel (HSD) combustion",
    value: 2.65,
    unit: "kgCO₂e/litre",
    basis: "derived",
    source:
      "IPCC 2006 Guidelines Vol. 2 Ch. 2 Table 2.4 (74,100 kg CO₂/TJ; CH₄ 10, N₂O 0.6 kg/TJ) × NCV 43.0 TJ/Gg (Ch. 1 Table 1.2) × PPAC Ready Reckoner density (1 t HSD = 1.21 kL); AR5 GWPs",
    sourceUrl: IPCC_CH2_URL,
    notes: "35.54 MJ/L × 74.1 kg/GJ = 2.633 kg CO₂/L, plus CH₄/N₂O = 2.649 kgCO₂e/L. Within 1% of UK DESNZ 2025 (2.662, 100% mineral diesel).",
  }),
  lpg: approved({
    label: "LPG combustion",
    value: 2.99,
    unit: "kgCO₂e/kg",
    basis: "derived",
    source:
      "IPCC 2006 Guidelines Vol. 2 Ch. 2 Table 2.4 (63,100 kg CO₂/TJ; CH₄ 5, N₂O 0.1 kg/TJ) × NCV 47.3 TJ/Gg (Ch. 1 Table 1.2); AR5 GWPs",
    sourceUrl: IPCC_CH2_URL,
    notes: "2.985 kg CO₂/kg plus CH₄/N₂O = 2.993 kgCO₂e/kg. UK DESNZ 2025: 2.939.",
  }),
  png: approved({
    label: "Piped natural gas (PNG) combustion",
    value: 2.12,
    unit: "kgCO₂e/SCM",
    basis: "derived",
    source:
      "IPCC 2006 Guidelines Vol. 2 Ch. 2 Table 2.4 (56,100 kg CO₂/TJ; CH₄ 5, N₂O 0.1 kg/TJ) × PPAC Ready Reckoner Table 9.5 (GAIL): GCV 10,000 kcal/SCM, NCV = 90% of GCV; AR5 GWPs",
    sourceUrl: IPCC_CH2_URL,
    notes:
      "37.68 MJ/SCM NCV. City gas is often supplied below 10,000 kcal/SCM; each 1,000 kcal/SCM lower GCV reduces the factor by about 0.24.",
  }),
} satisfies Record<string, Assumption>;

/* ------------------------------------------------------------------ */
/* Energy conversion                                                   */
/* ------------------------------------------------------------------ */

export const conversions = {
  dgSpecificOutput: userDefault({
    label: "Diesel generator specific output (default — enter your own)",
    value: 3.2,
    unit: "kWh/litre",
    source: "Default for a reasonably loaded DG set. Replace it with the kWh/litre from your DG log book in the Check.",
    sourceUrl: "https://wattonearth.in/check",
    notes: "Used to convert diesel litres into on-site electricity, assuming diesel is burned in DG sets.",
  }),
} satisfies Record<string, Assumption>;

/* ------------------------------------------------------------------ */
/* Tariffs (fallback when the user gives no bill amounts)              */
/* ------------------------------------------------------------------ */

export const tariffs = {
  commercial: userDefault({
    label: "Commercial electricity tariff, all-in (default — enter your bills)",
    value: 9.5,
    unit: "₹/kWh",
    source: "Default only. Tariffs vary by state and category; enter monthly bill amounts in the Check to use your actual effective rate.",
    sourceUrl: "https://wattonearth.in/check",
    notes: "Only used if no bill amounts are entered.",
  }),
  industrial: userDefault({
    label: "Industrial electricity tariff, all-in (default — enter your bills)",
    value: 8.0,
    unit: "₹/kWh",
    source: "Default only. Tariffs vary by state and category; enter monthly bill amounts in the Check to use your actual effective rate.",
    sourceUrl: "https://wattonearth.in/check",
    notes: "Only used if no bill amounts are entered.",
  }),
} satisfies Record<string, Assumption>;

/* ------------------------------------------------------------------ */
/* Benchmarks                                                          */
/* ------------------------------------------------------------------ */

export interface BandAssumption {
  label: string;
  /** EPI/SEC at or below this = "good". */
  goodMax: number;
  /** EPI/SEC above this = "poor". */
  poorMin: number;
  unit: string;
  basis: AssumptionBasis;
  source: string;
  sourceUrl: string;
  verified: boolean;
  lastChecked: string | null;
  notes?: string;
}

export type BuildingType = Exclude<FacilityType, "manufacturing">;

const EPI_UNIT = "kWh/m²/yr";
const zoneName: Record<ClimateZone, string> = {
  composite: "Composite",
  warm_humid: "Warm & Humid",
  hot_dry: "Hot & Dry",
  temperate: "Temperate",
  cold: "Cold",
};

/**
 * A BEE star-rating band. We read "good" as the upper limit of the 4-star band
 * (4 or 5 stars) and "poor" as above the upper limit of the 2-star band
 * (1 star or unrated). That reading is Watt on Earth's, not BEE's.
 */
function beeBand(type: string, zone: ClimateZone, goodMax: number, poorMin: number, source: string, sourceUrl: string): BandAssumption {
  return {
    label: `${type} EPI band — ${zoneName[zone]}`,
    goodMax,
    poorMin,
    unit: EPI_UNIT,
    basis: "official",
    source,
    sourceUrl,
    verified: true,
    lastChecked: CHECKED,
    notes: "Good = 4★ or better; poor = below 2★ (Watt on Earth's reading of the BEE star bands).",
  };
}

/** Watt on Earth estimate: good ≤ 0.8 × the published average, poor > 1.2 ×. Not a BEE rating. */
function estimateBand(type: string, zone: ClimateZone, average: number, averageLabel: string): BandAssumption {
  return {
    label: `${type} EPI band — ${zoneName[zone]} (Watt on Earth estimate)`,
    goodMax: Math.round(average * 0.8),
    poorMin: Math.round(average * 1.2),
    unit: EPI_UNIT,
    basis: "estimate",
    source: `Watt on Earth estimate (±20%) around the BEE/UNDP-GEF benchmark average of ${average} kWh/m²/yr for ${averageLabel} — not a BEE star rating`,
    sourceUrl: BEE_UNDP_FLYER_URL,
    verified: true,
    lastChecked: CHECKED,
    notes: "The flyer's \"Moderate\" zone is used for Temperate.",
  };
}

const OFFICE_SRC = "BEE Star Rating Scheme for Office Buildings (2009), Annexure — >50% air-conditioned built-up area";
const MALL_SRC = "BEE Star Rating Scheme for Shopping Malls (2011), Annexure 3";

/**
 * Building EPI bands by ECBC climate zone. `null` = no published basis for a
 * band; the EPI is shown without a rating. BEE publishes no Cold-zone bands.
 */
export const buildingBenchmarks: Record<BuildingType, Record<ClimateZone, BandAssumption | null>> = {
  office: {
    composite: beeBand("Office", "composite", 115, 165, OFFICE_SRC, BEE_OFFICE_URL),
    warm_humid: beeBand("Office", "warm_humid", 125, 175, OFFICE_SRC, BEE_OFFICE_URL),
    hot_dry: beeBand("Office", "hot_dry", 105, 155, OFFICE_SRC, BEE_OFFICE_URL),
    temperate: estimateBand("Office", "temperate", 179, "offices with more than 50% AC, Moderate zone"),
    cold: null,
  },
  retail: {
    composite: beeBand("Mall / retail", "composite", 200, 300, MALL_SRC, BEE_MALL_URL),
    warm_humid: beeBand("Mall / retail", "warm_humid", 300, 400, MALL_SRC, BEE_MALL_URL),
    hot_dry: beeBand("Mall / retail", "hot_dry", 150, 250, MALL_SRC, BEE_MALL_URL),
    temperate: beeBand("Mall / retail", "temperate", 200, 250, MALL_SRC, BEE_MALL_URL),
    cold: null,
  },
  hotel: {
    composite: estimateBand("Hotel", "composite", 290, "hotels above 3 star, Composite zone"),
    warm_humid: estimateBand("Hotel", "warm_humid", 333, "hotels above 3 star, Warm & Humid zone"),
    hot_dry: estimateBand("Hotel", "hot_dry", 250, "hotels above 3 star, Hot & Dry zone"),
    temperate: estimateBand("Hotel", "temperate", 313, "hotels above 3 star, Moderate zone"),
    cold: null,
  },
  hospital: {
    composite: estimateBand("Hospital", "composite", 264, "hospitals, Composite zone"),
    warm_humid: estimateBand("Hospital", "warm_humid", 275, "hospitals, Warm & Humid zone"),
    hot_dry: estimateBand("Hospital", "hot_dry", 261, "hospitals, Hot & Dry zone"),
    temperate: estimateBand("Hospital", "temperate", 247, "hospitals, Moderate zone"),
    cold: null,
  },
};

/**
 * Plant specific electricity consumption bands (kWh per tonne). None are
 * published in a form we can use yet, so plants see their SEC without a
 * good/poor rating. Add a `BandAssumption` here once one is verified.
 */
export const plantBenchmarks: Record<ManufacturingSubType, BandAssumption | null> = {
  steel: null,
  aluminium: null,
  cement: null,
  textiles: null,
  auto_components: null,
  other: null,
};

/* ------------------------------------------------------------------ */
/* Savings method                                                      */
/* ------------------------------------------------------------------ */

export const savingsMethod = {
  gapCaptureLow: placeholder({
    label: "Share of gap-to-good captured (low case)",
    value: 0.5,
    unit: "fraction",
    source: `${PROVISIONAL} Watt on Earth engineering judgement — review against completed audit outcomes`,
    sourceUrl: "https://wattonearth.in/check",
    notes: "High case assumes the full gap to the 'good' threshold is closed.",
  }),
  residualLow: placeholder({
    label: "Residual optimisation for 'good' sites (low)",
    value: 0.03,
    unit: "fraction of site kWh",
    source: `${PROVISIONAL} Watt on Earth engineering judgement`,
    sourceUrl: "https://wattonearth.in/check",
  }),
  residualHigh: placeholder({
    label: "Residual optimisation for 'good' sites (high)",
    value: 0.08,
    unit: "fraction of site kWh",
    source: `${PROVISIONAL} Watt on Earth engineering judgement`,
    sourceUrl: "https://wattonearth.in/check",
  }),
} satisfies Record<string, Assumption>;

/* ------------------------------------------------------------------ */
/* Registry helpers                                                    */
/* ------------------------------------------------------------------ */

export interface AssumptionRow {
  key: string;
  label: string;
  value: string;
  unit: string;
  source: string;
  sourceUrl: string;
  basis: AssumptionBasis;
  verified: boolean;
  lastChecked: string | null;
}

/** Flat list of every assumption, for the methodology table and the dev banner. */
export function allAssumptions(): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  const pushScalar = (group: string, rec: Record<string, Assumption>) => {
    for (const [k, a] of Object.entries(rec)) {
      rows.push({
        key: `${group}.${k}`,
        label: a.label,
        value: String(a.value),
        unit: a.unit,
        source: a.source,
        sourceUrl: a.sourceUrl,
        basis: a.basis,
        verified: a.verified,
        lastChecked: a.lastChecked,
      });
    }
  };
  const pushBands = (group: string, rec: Record<string, BandAssumption | null>) => {
    for (const [k, b] of Object.entries(rec)) {
      if (!b) continue;
      rows.push({
        key: `${group}.${k}`,
        label: b.label,
        value: `good ≤ ${b.goodMax} · poor > ${b.poorMin}`,
        unit: b.unit,
        source: b.source,
        sourceUrl: b.sourceUrl,
        basis: b.basis,
        verified: b.verified,
        lastChecked: b.lastChecked,
      });
    }
  };
  pushScalar("emissionFactors", emissionFactors);
  pushScalar("conversions", conversions);
  pushScalar("tariffs", tariffs);
  for (const [type, zones] of Object.entries(buildingBenchmarks)) pushBands(`buildingBenchmarks.${type}`, zones);
  pushBands("plantBenchmarks", plantBenchmarks);
  pushScalar("savingsMethod", savingsMethod);
  return rows;
}

/** Values still awaiting verification. User-replaceable defaults are excluded. */
export function unverifiedAssumptions(): AssumptionRow[] {
  return allAssumptions().filter((a) => !a.verified && a.basis !== "default");
}

/** Short public label for an assumption's status (methodology table and PDF). */
export function assumptionStatus(a: Pick<AssumptionRow, "basis" | "verified">): { label: string; tone: "good" | "neutral" } {
  if (a.basis === "default") return { label: "Default — replace with yours", tone: "neutral" };
  if (!a.verified) return { label: "Provisional", tone: "neutral" };
  if (a.basis === "estimate") return { label: "Estimate", tone: "neutral" };
  return { label: "Verified", tone: "good" };
}
