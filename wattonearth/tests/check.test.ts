import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCheck, bandFor, flagMonths, CheckInputError } from "@/lib/check/calc";
import { parseConsumptionCsv, normaliseMonth, parseNumber } from "@/lib/check/csv";
import { formatInr, formatIndianCompact } from "@/lib/format";
import { sampleHotelInput } from "@/data/sample";
import { emissionFactors } from "@/data/assumptions";

const sampleCsv = fs.readFileSync(path.join(process.cwd(), "public/templates/sample-mumbai-hotel.csv"), "utf8");

test("sample CSV parses into 12 months", () => {
  const r = parseConsumptionCsv(sampleCsv);
  assert.deepEqual(r.errors, []);
  assert.equal(r.readings.length, 12);
  assert.equal(r.readings[0].month, "2024-04");
  assert.equal(r.readings[11].kwh, 598000);
});

test("month and number normalisation", () => {
  assert.equal(normaliseMonth("Apr-2025"), "2025-04");
  assert.equal(normaliseMonth("April 2025"), "2025-04");
  assert.equal(normaliseMonth("04/2025"), "2025-04");
  assert.equal(normaliseMonth("Sept 24"), "2024-09");
  assert.equal(normaliseMonth("2025-13"), null);
  assert.equal(parseNumber("1,23,456"), 123456);
  assert.equal(parseNumber("₹ 45,000"), 45000);
  assert.equal(parseNumber(""), null);
});

test("template CSV reports missing kWh", () => {
  const t = fs.readFileSync(path.join(process.cwd(), "public/templates/energy-check-template.csv"), "utf8");
  assert.ok(parseConsumptionCsv(t).errors.length > 0);
});

test("sample hotel produces sensible results", () => {
  const { readings } = parseConsumptionCsv(sampleCsv);
  const r = runCheck({ ...sampleHotelInput, months: readings });
  assert.equal(r.metricKind, "EPI");
  const grid = readings.reduce((s, m) => s + m.kwh, 0);
  assert.equal(r.annualGridKwh, grid);
  assert.ok(r.metricValue > 250 && r.metricValue < 400, `EPI ${r.metricValue}`);
  assert.ok(r.band);
  assert.ok(r.savings.kwhHigh >= r.savings.kwhLow && r.savings.kwhLow > 0);
  assert.ok(Math.abs(r.emissions.scope2 - (grid / 1000) * emissionFactors.gridElectricity.value) < 1e-6);
  assert.ok(r.emissions.scope1 > 0);
  assert.ok(r.monthFlags.some((f) => f.month === "2025-03"), "March spike flagged");
  assert.ok(r.monthFlags.some((f) => f.month === "2025-02" && f.reason.includes("rate")), "Feb tariff flagged");
  assert.equal(r.kwhPerRoom !== null, true);
  assert.equal(r.exposure.find((e) => e.regime === "BRSR")?.level, "high");
  assert.equal(r.exposure.find((e) => e.regime === "CBAM")?.level, "not_applicable");
  assert.ok(r.measures.length >= 3 && r.measures.length <= 5);
});

test("manufacturing uses SEC and CBAM exposure", () => {
  const months = parseConsumptionCsv(sampleCsv).readings;
  const r = runCheck({
    ...sampleHotelInput,
    facilityType: "manufacturing",
    manufacturingSubType: "steel",
    annualProductionTonnes: 9000,
    exportsToEU: true,
    months,
  });
  assert.equal(r.metricKind, "SEC");
  assert.equal(r.metricUnit, "kWh/t");
  assert.equal(r.exposure.find((e) => e.regime === "CBAM")?.level, "high");
  assert.equal(r.exposure.find((e) => e.regime === "CCTS")?.level, "high");
});

test("validation and banding", () => {
  assert.throws(() => runCheck({ ...sampleHotelInput, months: [] }), CheckInputError);
  const b = { goodMax: 100, poorMin: 200, unit: "x", verified: false };
  assert.equal(bandFor(100, b), "good");
  assert.equal(bandFor(150, b), "typical");
  assert.equal(bandFor(201, b), "poor");
  const flat = Array.from({ length: 12 }, (_, i) => ({ month: `2024-${String(i + 1).padStart(2, "0")}`, kwh: 1000, amountInr: null }));
  assert.deepEqual(flagMonths(flat), []);
});

test("Indian number formatting", () => {
  assert.equal(formatIndianCompact(98500), "98,500");
  assert.equal(formatIndianCompact(1240000), "12.4 lakh");
  assert.equal(formatInr(32500000), "₹3.25 crore");
});
