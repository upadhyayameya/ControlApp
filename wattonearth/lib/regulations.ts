import raw from "@/data/regulations.json";
import { REGIMES, type DateStatus, type Regime, type RegulationMilestone } from "@/lib/types";

const DATE_STATUSES: readonly DateStatus[] = ["confirmed", "expected", "tbc"];

function validate(entries: unknown[]): RegulationMilestone[] {
  return entries.map((e, i) => {
    const r = e as RegulationMilestone;
    const where = `data/regulations.json[${i}] (${r?.id ?? "no id"})`;
    if (!r.id || !r.milestone) throw new Error(`${where}: id and milestone are required`);
    if (!REGIMES.includes(r.regime)) throw new Error(`${where}: unknown regime "${r.regime}"`);
    if (!DATE_STATUSES.includes(r.dateStatus)) throw new Error(`${where}: unknown dateStatus "${r.dateStatus}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error(`${where}: date must be YYYY-MM-DD`);
    return r;
  });
}

/** All milestones, sorted by date. Validated at build time. */
export const regulations: RegulationMilestone[] = validate(raw as unknown[]).sort((a, b) =>
  a.date.localeCompare(b.date),
);

/** Today's date as YYYY-MM-DD in India Standard Time. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** A milestone is "past" only when its date is known (not TBC) and before today. */
export function isPast(m: RegulationMilestone, today: string = todayIST()): boolean {
  return m.dateStatus !== "tbc" && m.date < today;
}

/** Next upcoming milestone with `dateStatus: "confirmed"` for a regime — drives the home countdown. */
export function nextConfirmedMilestone(
  regime: Regime,
  today: string = todayIST(),
): RegulationMilestone | null {
  return regulations.find((m) => m.regime === regime && m.dateStatus === "confirmed" && m.date >= today) ?? null;
}

export function trackerHref(regime?: Regime, id?: string): string {
  const q = regime ? `?regime=${regime}` : "";
  return `/tracker${q}${id ? `#${id}` : ""}`;
}

export const regimeInfo: Record<Regime, { name: string; short: string }> = {
  CCTS: {
    name: "Carbon Credit Trading Scheme",
    short: "India's compliance carbon market: emission-intensity targets for obligated sectors, plus an offset mechanism.",
  },
  CBAM: {
    name: "EU Carbon Border Adjustment Mechanism",
    short: "A carbon price on embedded emissions of certain goods imported into the EU, including steel, aluminium and cement.",
  },
  BRSR: {
    name: "Business Responsibility & Sustainability Reporting",
    short: "SEBI's sustainability disclosure framework for listed companies, with BRSR Core metrics extending to the value chain.",
  },
  ECBC: {
    name: "Energy Conservation (& Sustainable) Building Code",
    short: "Minimum energy-performance requirements for new commercial buildings, adopted and enforced state by state.",
  },
};
