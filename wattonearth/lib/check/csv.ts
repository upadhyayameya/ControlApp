import type { MonthlyReading } from "@/lib/types";

export const CSV_TEMPLATE_HEADER = "month,kwh,amount_inr";

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Accepts 2025-04, 2025/04, 04/2025, 04-2025, Apr-2025, April 2025, Apr 25. Returns "YYYY-MM" or null. */
export function normaliseMonth(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/['’]/g, "");
  const pad = (m: number) => String(m).padStart(2, "0");
  const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = s.match(/^([a-z]{3,9})[\s\-/]*(\d{2}|\d{4})$/);
  if (m) {
    const month = MONTH_NAMES[m[1].slice(0, m[1] === "sept" ? 4 : 3)];
    if (month) return `${fullYear(m[2])}-${pad(month)}`;
  }
  return null;
}

/** "1,23,456.7" / "₹ 45,000" → number. Empty → null. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Minimal CSV line splitter with quote support. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export interface CsvParseResult {
  readings: MonthlyReading[];
  errors: string[];
  warnings: string[];
}

/**
 * Parses the Check CSV template. Lines starting with "#" are comments.
 * The header row must include `month` and `kwh`; `amount_inr` is optional.
 */
export function parseConsumptionCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { readings: [], errors: ["The file is empty."], warnings };

  const header = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z_]/g, ""));
  const iMonth = header.indexOf("month");
  const iKwh = header.findIndex((h) => h === "kwh" || h === "units" || h === "consumption_kwh");
  const iAmt = header.findIndex((h) => h === "amount_inr" || h === "amount" || h === "bill_inr");
  if (iMonth < 0 || iKwh < 0) {
    return { readings: [], errors: [`Header must include "month" and "kwh" (expected: ${CSV_TEMPLATE_HEADER}).`], warnings };
  }

  const byMonth = new Map<string, MonthlyReading>();
  lines.slice(1).forEach((line, idx) => {
    const row = idx + 2;
    const cells = splitLine(line);
    const month = normaliseMonth(cells[iMonth] ?? "");
    const kwh = parseNumber(cells[iKwh]);
    const amount = iAmt >= 0 ? parseNumber(cells[iAmt]) : null;
    if (!month) return errors.push(`Row ${row}: couldn't read month "${cells[iMonth] ?? ""}". Use YYYY-MM.`);
    if (kwh === null || Number.isNaN(kwh) || kwh < 0) return errors.push(`Row ${row}: kWh must be a number ≥ 0.`);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) return errors.push(`Row ${row}: amount must be a number ≥ 0.`);
    if (byMonth.has(month)) warnings.push(`${month} appears more than once; the last row was used.`);
    byMonth.set(month, { month, kwh, amountInr: amount });
  });

  let readings = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (readings.length > 12) {
    warnings.push(`The file has ${readings.length} months; the most recent 12 were used.`);
    readings = readings.slice(-12);
  }
  if (readings.length < 12 && !errors.length) {
    errors.push(`Found ${readings.length} month${readings.length === 1 ? "" : "s"} — the Check needs 12 consecutive months.`);
  }
  return { readings, errors, warnings };
}

/** Twelve consecutive "YYYY-MM" strings ending with the last full month before `now`. */
export function lastTwelveMonths(now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 12; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
