"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/primitives";
import { REGIMES, type DateStatus, type Regime, type RegulationMilestone } from "@/lib/types";

export interface TrackerItem extends RegulationMilestone {
  past: boolean;
}

const statusText: Record<DateStatus, string> = {
  confirmed: "Confirmed",
  expected: "Expected",
  tbc: "Date TBC",
};

export function milestoneDate(m: RegulationMilestone): string {
  if (m.dateStatus === "tbc") return "To be confirmed";
  const d = new Date(`${m.date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return m.dateStatus === "expected" ? `Expected ${d}` : d;
}

export function TrackerView({ items }: { items: TrackerItem[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const regime = REGIMES.find((r) => r === params.get("regime")) ?? null;
  const view = params.get("view") === "table" ? "table" : "timeline";
  const shown = regime ? items.filter((i) => i.regime === regime) : items;

  const update = (next: { regime?: Regime | null; view?: "timeline" | "table" }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.regime !== undefined) {
      if (next.regime) sp.set("regime", next.regime);
      else sp.delete("regime");
    }
    if (next.view) {
      if (next.view === "table") sp.set("view", "table");
      else sp.delete("view");
    }
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-5">
        <div role="group" aria-label="Filter by regime" className="flex flex-wrap gap-2">
          {[null, ...REGIMES].map((r) => (
            <button
              key={r ?? "all"}
              type="button"
              aria-pressed={regime === r}
              onClick={() => update({ regime: r })}
              className={`rounded-full border px-4 py-1.5 text-sm ${
                regime === r ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-fg hover:text-fg"
              }`}
            >
              {r ?? "All"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="View" className="flex rounded-full border border-line p-1 text-sm">
          {(["timeline", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => update({ view: v })}
              className={`rounded-full px-4 py-1 capitalize ${view === v ? "bg-bg-subtle font-medium text-fg" : "text-muted"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 text-sm text-muted" aria-live="polite">
        {shown.length} milestone{shown.length === 1 ? "" : "s"}
        {regime ? ` for ${regime}` : ""}
      </p>

      {view === "timeline" ? (
        <ol className="relative mt-8 border-l border-line pl-8">
          {shown.map((m) => (
            <li key={m.id} id={m.id} className={`relative mb-10 scroll-mt-24 ${m.past ? "opacity-50" : ""}`}>
              <span
                aria-hidden="true"
                className={`absolute -left-[37px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${
                  m.dateStatus === "confirmed" && !m.past ? "border-accent bg-accent" : "border-muted bg-bg"
                }`}
              />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-muted">{milestoneDate(m)}</span>
                <Badge tone={m.dateStatus === "confirmed" ? "accent" : "neutral"}>{statusText[m.dateStatus]}</Badge>
                <Badge>{m.regime}</Badge>
                {m.past && <Badge>Past</Badge>}
              </div>
              <h3 className="mt-2 text-lg font-semibold leading-snug">{m.milestone}</h3>
              <p className="mt-1 text-sm text-muted">Applies to: {m.appliesTo}</p>
              {m.notes && <p className="mt-2 text-sm">{m.notes}</p>}
              <p className="mt-3 text-xs text-muted">
                <a href={m.officialSourceUrl} target="_blank" rel="noopener" className="font-medium text-fg underline underline-offset-4">
                  Official source ↗
                </a>
                {" · "}
                {m.lastVerified ? `Last verified ${m.lastVerified}` : "Not yet verified"}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Regulatory milestones</caption>
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-3 pr-4 font-medium">Date</th>
                <th scope="col" className="py-3 pr-4 font-medium">Regime</th>
                <th scope="col" className="py-3 pr-4 font-medium">Milestone</th>
                <th scope="col" className="py-3 pr-4 font-medium">Applies to</th>
                <th scope="col" className="py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} id={m.id} className={`border-b border-line align-top ${m.past ? "opacity-50" : ""}`}>
                  <td className="whitespace-nowrap py-3 pr-4">
                    {milestoneDate(m)}
                    <span className="mt-1 block text-xs text-muted">
                      {statusText[m.dateStatus]}
                      {m.past ? " · past" : ""}
                    </span>
                  </td>
                  <td className="py-3 pr-4">{m.regime}</td>
                  <td className="py-3 pr-4 font-medium">{m.milestone}</td>
                  <td className="py-3 pr-4 text-muted">{m.appliesTo}</td>
                  <td className="py-3">
                    <a href={m.officialSourceUrl} target="_blank" rel="noopener" className="underline underline-offset-4">
                      Official ↗
                    </a>
                    <span className="mt-1 block text-xs text-muted">{m.lastVerified ?? "unverified"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
