/** Number formatting for the Indian market (lakh/crore grouping). */

const LAKH = 1e5;
const CRORE = 1e7;

export function formatNumber(n: number, maxFractionDigits = 0): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: maxFractionDigits }).format(n);
}

/** "12.4 lakh", "3.2 crore" — trims trailing ".0". */
function scaled(n: number, unit: number, word: string, digits: number): string {
  const v = (n / unit).toFixed(digits).replace(/\.0+$/, "");
  return `${v} ${word}`;
}

/** Compact Indian formatting: 98,500 · 12.4 lakh · 3.2 crore. */
export function formatIndianCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= CRORE) return scaled(n, CRORE, "crore", abs >= 100 * CRORE ? 0 : 2);
  if (abs >= LAKH) return scaled(n, LAKH, "lakh", abs >= 10 * LAKH ? 1 : 2);
  return formatNumber(n);
}

/** ₹ with lakh/crore wording above ₹1 lakh, e.g. "₹12.4 lakh". */
export function formatInr(n: number): string {
  return `₹${formatIndianCompact(Math.round(n))}`;
}

/** Full rupee amount with Indian grouping: "₹12,34,567". */
export function formatInrFull(n: number): string {
  return `₹${formatNumber(Math.round(n))}`;
}

/** kWh with Indian grouping; compact above 1 lakh. */
export function formatKwh(n: number, compact = true): string {
  return `${compact ? formatIndianCompact(Math.round(n)) : formatNumber(Math.round(n))} kWh`;
}

export function formatTco2e(n: number): string {
  const digits = n >= 100 ? 0 : 1;
  return `${formatNumber(Number(n.toFixed(digits)), digits)} tCO₂e`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-04" → "Apr 2025" (or "Apr ’25" when short). */
export function formatMonth(ym: string, short = false): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return short ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
}
