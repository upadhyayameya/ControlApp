/**
 * Energy & Carbon Check — screening calculations. Pure functions; runs in the
 * browser. Every constant comes from data/assumptions.ts.
 */
import {
  buildingBenchmarks,
  climateZoneMultipliers,
  conversions,
  emissionFactors,
  plantBenchmarks,
  savingsMethod,
  tariffs,
} from "@/data/assumptions";
import { measuresFor } from "@/data/measures";
import { assessExposure } from "@/lib/check/exposure";
import { formatMonth } from "@/lib/format";
import type { BenchmarkBand, BenchmarkRange, CheckInput, CheckResult, MonthFlag } from "@/lib/types";

export const FT2_TO_M2 = 0.09290304;

/** Modified z-score threshold (Iglewicz & Hoaglin) above which a month is flagged. */
const OUTLIER_Z = 3.5;
/** Any month this far from the median is flagged regardless of z-score. */
const OUTLIER_SHARE = 0.4;
/** Monthly effective tariff this far from the median rate is flagged. */
const TARIFF_SHARE = 0.25;

export class CheckInputError extends Error {}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function areaInM2(input: Pick<CheckInput, "floorArea" | "areaUnit">): number {
  const a = input.floorArea ?? 0;
  return input.areaUnit === "ft2" ? a * FT2_TO_M2 : a;
}

export function benchmarkFor(input: CheckInput): BenchmarkRange | null {
  if (input.facilityType === "manufacturing") {
    const b = input.manufacturingSubType ? plantBenchmarks[input.manufacturingSubType] : null;
    return b ? { goodMax: b.goodMax, poorMin: b.poorMin, unit: b.unit, verified: b.verified } : null;
  }
  const b = buildingBenchmarks[input.facilityType];
  const m = climateZoneMultipliers[input.climateZone];
  return {
    goodMax: Math.round(b.goodMax * m.value),
    poorMin: Math.round(b.poorMin * m.value),
    unit: b.unit,
    verified: b.verified && m.verified,
  };
}

export function bandFor(value: number, b: BenchmarkRange): BenchmarkBand {
  if (value <= b.goodMax) return "good";
  if (value > b.poorMin) return "poor";
  return "typical";
}

/** Flags months with unusual consumption or unusual effective tariff. */
export function flagMonths(months: CheckInput["months"]): MonthFlag[] {
  const flags: MonthFlag[] = [];
  const kwh = months.map((m) => m.kwh);
  const med = median(kwh);
  const mad = median(kwh.map((v) => Math.abs(v - med)));

  const rates = months
    .filter((m) => m.amountInr !== null && m.amountInr > 0 && m.kwh > 0)
    .map((m) => (m.amountInr as number) / m.kwh);
  const medRate = rates.length >= 3 ? median(rates) : null;

  for (const m of months) {
    const label = formatMonth(m.month);
    if (m.kwh <= 0) {
      flags.push({ month: m.month, reason: `${label}: no consumption recorded — check for a missing or estimated bill.` });
      continue;
    }
    const share = med > 0 ? (m.kwh - med) / med : 0;
    const z = mad > 0 ? (0.6745 * (m.kwh - med)) / mad : 0;
    if (Math.abs(z) > OUTLIER_Z || Math.abs(share) > OUTLIER_SHARE) {
      const pct = Math.round(Math.abs(share) * 100);
      flags.push({
        month: m.month,
        reason: `${label}: ${pct}% ${share > 0 ? "above" : "below"} your typical month — check for billing errors, meter changes or an operational change.`,
      });
    }
    if (medRate && m.amountInr && m.amountInr > 0) {
      const rate = m.amountInr / m.kwh;
      const rShare = (rate - medRate) / medRate;
      if (Math.abs(rShare) > TARIFF_SHARE) {
        flags.push({
          month: m.month,
          reason: `${label}: effective rate ₹${rate.toFixed(2)}/kWh is ${Math.round(Math.abs(rShare) * 100)}% ${rShare > 0 ? "above" : "below"} your usual — look for demand charges, penalties, arrears or credits.`,
        });
      }
    }
  }
  return flags;
}

export function validateInput(input: CheckInput): void {
  if (input.months.length !== 12) throw new CheckInputError("Enter exactly 12 months of electricity data.");
  if (input.months.some((m) => !Number.isFinite(m.kwh) || m.kwh < 0))
    throw new CheckInputError("Monthly kWh values must be zero or positive numbers.");
  if (input.facilityType === "manufacturing") {
    if (!input.annualProductionTonnes || input.annualProductionTonnes <= 0)
      throw new CheckInputError("Enter annual production in tonnes.");
  } else if (!input.floorArea || input.floorArea <= 0) {
    throw new CheckInputError("Enter the floor area.");
  }
}

export function runCheck(input: CheckInput): CheckResult {
  validateInput(input);
  const isPlant = input.facilityType === "manufacturing";
  const notes: string[] = [];

  // Energy
  const annualGridKwh = input.months.reduce((s, m) => s + m.kwh, 0);
  const dgKwh = (input.dieselLitres ?? 0) * conversions.dgSpecificOutput.value;
  const solarKwh = input.solarKwh ?? 0;
  const annualSiteElectricityKwh = annualGridKwh + dgKwh + solarKwh;

  // Metric
  const denominator = isPlant ? (input.annualProductionTonnes as number) : areaInM2(input);
  const metricValue = annualSiteElectricityKwh / denominator;
  const benchmark = benchmarkFor(input);
  const band = benchmark ? bandFor(metricValue, benchmark) : null;

  // Cost
  const billed = input.months.filter((m) => m.amountInr !== null && m.amountInr > 0);
  const billedKwh = billed.reduce((s, m) => s + m.kwh, 0);
  const annualBillInr = billed.length ? billed.reduce((s, m) => s + (m.amountInr as number), 0) : null;
  const tariffIsAssumed = !(billed.length && billedKwh > 0);
  const effectiveTariffInrPerKwh = tariffIsAssumed
    ? (isPlant ? tariffs.industrial : tariffs.commercial).value
    : (annualBillInr as number) / billedKwh;
  if (tariffIsAssumed) notes.push("No bill amounts were entered, so ₹ savings use a default tariff assumption.");
  else if (billed.length < 12) notes.push(`Bill amounts were given for ${billed.length} of 12 months; the effective tariff is based on those months.`);

  // Savings
  let kwhLow: number;
  let kwhHigh: number;
  if (benchmark && band !== "good") {
    const gap = (metricValue - benchmark.goodMax) * denominator;
    kwhHigh = Math.min(gap, annualSiteElectricityKwh);
    kwhLow = kwhHigh * savingsMethod.gapCaptureLow.value;
  } else {
    kwhLow = annualSiteElectricityKwh * savingsMethod.residualLow.value;
    kwhHigh = annualSiteElectricityKwh * savingsMethod.residualHigh.value;
  }
  const savings = {
    kwhLow,
    kwhHigh,
    inrLow: kwhLow * effectiveTariffInrPerKwh,
    inrHigh: kwhHigh * effectiveTariffInrPerKwh,
  };

  // Emissions (tCO₂e)
  const scope2 = (annualGridKwh / 1000) * emissionFactors.gridElectricity.value;
  const breakdown: CheckResult["emissions"]["breakdown"] = [
    { label: "Grid electricity", tco2e: scope2, scope: 2 },
  ];
  const s1 = [
    { label: "Diesel", qty: input.dieselLitres, ef: emissionFactors.diesel.value },
    { label: "LPG", qty: input.lpgKg, ef: emissionFactors.lpg.value },
    { label: "PNG", qty: input.pngScm, ef: emissionFactors.png.value },
  ];
  for (const f of s1) {
    if (f.qty && f.qty > 0) breakdown.push({ label: f.label, tco2e: (f.qty * f.ef) / 1000, scope: 1 });
  }
  const scope1 = breakdown.filter((b) => b.scope === 1).reduce((s, b) => s + b.tco2e, 0);

  // Measures
  const measures = measuresFor(input.facilityType, input.manufacturingSubType).map((m) => m.title);

  // Notes
  if (dgKwh > 0) notes.push("Diesel is assumed to be used in DG sets; its electricity output is included in the energy metric.");
  if (!isPlant && ((input.lpgKg ?? 0) > 0 || (input.pngScm ?? 0) > 0))
    notes.push("LPG/PNG is counted in Scope 1 emissions but not in the electricity-based EPI.");
  if (isPlant)
    notes.push("Plant SEC here covers electricity only. Coal, pet coke, furnace oil and biomass are not captured by this screening tool.");
  if (isPlant && !benchmark) notes.push("No benchmark band is available for this sub-sector; the metric is shown for reference.");
  if (input.climateZone === "cold" && !isPlant)
    notes.push("In cold climates, heating fuel can be significant and is not reflected in the electricity EPI.");

  return {
    metricKind: isPlant ? "SEC" : "EPI",
    metricValue,
    metricUnit: isPlant ? "kWh/t" : "kWh/m²/yr",
    benchmark,
    band,
    annualGridKwh,
    annualSiteElectricityKwh,
    annualBillInr,
    effectiveTariffInrPerKwh,
    tariffIsAssumed,
    kwhPerRoom: input.facilityType === "hotel" && input.rooms ? annualSiteElectricityKwh / input.rooms : null,
    monthFlags: flagMonths(input.months),
    savings,
    measures,
    emissions: { scope1, scope2, total: scope1 + scope2, breakdown },
    exposure: assessExposure(input),
    notes,
  };
}
