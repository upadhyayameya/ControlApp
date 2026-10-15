/**
 * ALL numeric assumptions used by the Energy & Carbon Check live here.
 *
 * ⚠️  Every value below is a PLACEHOLDER (`verified: false`). They are
 * order-of-magnitude figures so the tool works end-to-end — they are NOT
 * official numbers and must not be quoted. To verify one:
 *   1. Open `sourceUrl`, find the current edition of the publication.
 *   2. Replace `value` (and `unit` if needed) with the published figure.
 *   3. Set `verified: true` and `lastChecked` to today's date (YYYY-MM-DD).
 * `npm run assumptions` lists everything still unverified. A dev-only banner
 * is shown on every page while any assumption is unverified.
 */
import type { Assumption, ClimateZone, FacilityType, ManufacturingSubType } from "@/lib/types";

const PLACEHOLDER = "PLACEHOLDER — confirm against";

function placeholder(a: Omit<Assumption, "verified" | "lastChecked">): Assumption {
  return { ...a, verified: false, lastChecked: null };
}

/* ------------------------------------------------------------------ */
/* Emission factors                                                    */
/* ------------------------------------------------------------------ */

export const emissionFactors = {
  gridElectricity: placeholder({
    label: "Grid electricity emission factor (India, weighted average)",
    value: 0.72,
    unit: "tCO₂e/MWh",
    source: `${PLACEHOLDER} CEA CO₂ Baseline Database for the Indian Power Sector (latest version, weighted average)`,
    sourceUrl: "https://cea.nic.in/cdm-co2-baseline-database/?lang=en",
    notes: "Location-based Scope 2. Use the latest CEA version's 'weighted average' emission factor.",
  }),
  diesel: placeholder({
    label: "Diesel (HSD) combustion",
    value: 2.68,
    unit: "kgCO₂e/litre",
    source: `${PLACEHOLDER} IPCC 2006 Guidelines Vol. 2 (default CO₂/CH₄/N₂O factors) with Indian HSD density and NCV`,
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
  }),
  lpg: placeholder({
    label: "LPG combustion",
    value: 2.99,
    unit: "kgCO₂e/kg",
    source: `${PLACEHOLDER} IPCC 2006 Guidelines Vol. 2, LPG default factor × NCV`,
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
  }),
  png: placeholder({
    label: "Piped natural gas (PNG) combustion",
    value: 2.0,
    unit: "kgCO₂e/SCM",
    source: `${PLACEHOLDER} IPCC 2006 Guidelines Vol. 2 natural gas factor × your city gas distributor's declared GCV/NCV`,
    sourceUrl: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html",
  }),
} satisfies Record<string, Assumption>;

/* ------------------------------------------------------------------ */
/* Energy conversion                                                   */
/* ------------------------------------------------------------------ */

export const conversions = {
  dgSpecificOutput: placeholder({
    label: "Diesel generator specific output",
    value: 3.2,
    unit: "kWh/litre",
    source: `${PLACEHOLDER} site DG log books / BEE guide book for energy auditors (DG set performance)`,
    sourceUrl: "https://beeindia.gov.in/",
    notes: "Used to convert diesel litres into on-site electricity, assuming diesel is burned in DG sets.",
  }),
} satisfies Record<string, Assumption>;

/* ------------------------------------------------------------------ */
/* Tariffs (fallback when the user gives no bill amounts)              */
/* ------------------------------------------------------------------ */

export const tariffs = {
  commercial: placeholder({
    label: "Default commercial electricity tariff (all-in)",
    value: 9.5,
    unit: "₹/kWh",
    source: `${PLACEHOLDER} the relevant State Electricity Regulatory Commission tariff order (HT/LT commercial)`,
    sourceUrl: "https://cea.nic.in/?lang=en",
    notes: "Only used if no bill amounts are entered. Tariffs vary widely by state and category.",
  }),
  industrial: placeholder({
    label: "Default industrial electricity tariff (all-in)",
    value: 8.0,
    unit: "₹/kWh",
    source: `${PLACEHOLDER} the relevant State Electricity Regulatory Commission tariff order (HT industrial)`,
    sourceUrl: "https://cea.nic.in/?lang=en",
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
  source: string;
  sourceUrl: string;
  verified: boolean;
  lastChecked: string | null;
  notes?: string;
}

function band(b: Omit<BandAssumption, "verified" | "lastChecked">): BandAssumption {
  return { ...b, verified: false, lastChecked: null };
}

/** Building EPI bands (kWh/m²/yr of site electricity) for the composite zone. */
export const buildingBenchmarks: Record<Exclude<FacilityType, "manufacturing">, BandAssumption> = {
  office: band({
    label: "Office EPI band",
    goodMax: 110,
    poorMin: 200,
    unit: "kWh/m²/yr",
    source: `${PLACEHOLDER} BEE Star Rating for Office Buildings (EPI bands by climate zone)`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  hotel: band({
    label: "Hotel EPI band",
    goodMax: 200,
    poorMin: 330,
    unit: "kWh/m²/yr",
    source: `${PLACEHOLDER} BEE Star Rating for Hotels / published Indian hotel benchmarking studies`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  hospital: band({
    label: "Hospital EPI band",
    goodMax: 250,
    poorMin: 400,
    unit: "kWh/m²/yr",
    source: `${PLACEHOLDER} BEE Star Rating for Hospitals`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  retail: band({
    label: "Mall / retail EPI band",
    goodMax: 250,
    poorMin: 420,
    unit: "kWh/m²/yr",
    source: `${PLACEHOLDER} BEE Star Rating for Shopping Malls`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
};

/** Multiplier applied to building bands by ECBC climate zone (composite = 1). */
export const climateZoneMultipliers: Record<ClimateZone, Assumption> = {
  composite: placeholder({
    label: "Climate multiplier — Composite",
    value: 1.0,
    unit: "×",
    source: `${PLACEHOLDER} BEE star-rating band tables for each climate zone`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  hot_dry: placeholder({
    label: "Climate multiplier — Hot & Dry",
    value: 1.05,
    unit: "×",
    source: `${PLACEHOLDER} BEE star-rating band tables for each climate zone`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  warm_humid: placeholder({
    label: "Climate multiplier — Warm & Humid",
    value: 1.05,
    unit: "×",
    source: `${PLACEHOLDER} BEE star-rating band tables for each climate zone`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  temperate: placeholder({
    label: "Climate multiplier — Temperate",
    value: 0.85,
    unit: "×",
    source: `${PLACEHOLDER} BEE star-rating band tables for each climate zone`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  cold: placeholder({
    label: "Climate multiplier — Cold",
    value: 0.8,
    unit: "×",
    source: `${PLACEHOLDER} BEE star-rating band tables for each climate zone`,
    sourceUrl: "https://beeindia.gov.in/",
    notes: "Cold-zone buildings often use fuel for heating, which is outside the electricity EPI.",
  }),
};

/**
 * Plant specific electricity consumption (kWh of site electricity per tonne).
 * `null` = no benchmark (the metric is shown without a band).
 */
export const plantBenchmarks: Record<ManufacturingSubType, BandAssumption | null> = {
  steel: band({
    label: "Steel SEC band (electricity)",
    goodMax: 550,
    poorMin: 800,
    unit: "kWh/t",
    source: `${PLACEHOLDER} PAT cycle sector baselines / BEE sector reports (varies strongly by route: EAF, IF, BF-BOF, rolling)`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  aluminium: band({
    label: "Aluminium SEC band (electricity)",
    goodMax: 13500,
    poorMin: 15000,
    unit: "kWh/t",
    source: `${PLACEHOLDER} PAT cycle sector baselines (primary smelting; downstream extrusion/rolling is far lower)`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  cement: band({
    label: "Cement SEC band (electricity)",
    goodMax: 70,
    poorMin: 95,
    unit: "kWh/t",
    source: `${PLACEHOLDER} PAT cycle sector baselines / CII cement benchmarking (electrical SEC per tonne cement)`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  textiles: band({
    label: "Textiles SEC band (electricity)",
    goodMax: 2500,
    poorMin: 4500,
    unit: "kWh/t",
    source: `${PLACEHOLDER} PAT textile sector baselines (varies by spinning/weaving/processing)`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
  auto_components: band({
    label: "Auto components SEC band (electricity)",
    goodMax: 1200,
    poorMin: 2500,
    unit: "kWh/t",
    source: `${PLACEHOLDER} BEE SME cluster studies / ACMA publications (varies by process: forging, casting, machining)`,
    sourceUrl: "https://beeindia.gov.in/",
  }),
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
    source: `${PLACEHOLDER} Watt on Earth engineering judgement — review against completed audit outcomes`,
    sourceUrl: "https://wattonearth.in/check",
    notes: "High case assumes the full gap to the 'good' threshold is closed.",
  }),
  residualLow: placeholder({
    label: "Residual optimisation for 'good' sites (low)",
    value: 0.03,
    unit: "fraction of site kWh",
    source: `${PLACEHOLDER} Watt on Earth engineering judgement`,
    sourceUrl: "https://wattonearth.in/check",
  }),
  residualHigh: placeholder({
    label: "Residual optimisation for 'good' sites (high)",
    value: 0.08,
    unit: "fraction of site kWh",
    source: `${PLACEHOLDER} Watt on Earth engineering judgement`,
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
        verified: b.verified,
        lastChecked: b.lastChecked,
      });
    }
  };
  pushScalar("emissionFactors", emissionFactors);
  pushScalar("conversions", conversions);
  pushScalar("tariffs", tariffs);
  pushBands("buildingBenchmarks", buildingBenchmarks);
  pushScalar("climateZoneMultipliers", climateZoneMultipliers);
  pushBands("plantBenchmarks", plantBenchmarks);
  pushScalar("savingsMethod", savingsMethod);
  return rows;
}

export function unverifiedAssumptions(): AssumptionRow[] {
  return allAssumptions().filter((a) => !a.verified);
}
