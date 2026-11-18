"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInrFull, formatMonth, formatNumber } from "@/lib/format";
import type { MonthFlag, MonthlyReading } from "@/lib/types";

/** Short axis labels: 4.5L (lakh), 1.2Cr (crore). */
function axisTick(v: number): string {
  if (v >= 1e7) return `${+(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${+(v / 1e5).toFixed(1)}L`;
  return formatNumber(v);
}

interface Row {
  month: string;
  label: string;
  kwh: number;
  amountInr: number | null;
  flagged: boolean;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-bg-elevated px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{formatMonth(r.month)}</p>
      <p className="mt-1 tabular-nums">{formatNumber(r.kwh)} kWh</p>
      {r.amountInr !== null && <p className="tabular-nums text-muted">{formatInrFull(r.amountInr)}</p>}
      {r.flagged && <p className="mt-1 font-medium">⚠ Flagged as unusual</p>}
    </div>
  );
}

export function MonthlyChart({ months, flags }: { months: MonthlyReading[]; flags: MonthFlag[] }) {
  const flagged = new Set(flags.map((f) => f.month));
  const rows: Row[] = months.map((m) => ({
    month: m.month,
    label: formatMonth(m.month, true),
    kwh: m.kwh,
    amountInr: m.amountInr,
    flagged: flagged.has(m.month),
  }));

  return (
    <figure>
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap={3}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              width={56}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickFormatter={axisTick}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--bg-subtle)" }} />
            <Bar dataKey="kwh" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.month} fill={r.flagged ? "var(--poor)" : "var(--accent)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-accent" /> Grid electricity, kWh per month
        </span>
        {flagged.size > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-poor" /> ⚠ Flagged as unusual
          </span>
        )}
      </figcaption>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">Show data table</summary>
        <table className="mt-3 w-full text-left tabular-nums">
          <caption className="sr-only">Monthly grid electricity</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">Month</th>
              <th scope="col" className="py-1 text-right font-medium">kWh</th>
              <th scope="col" className="py-1 text-right font-medium">Bill</th>
              <th scope="col" className="py-1 text-right font-medium">₹/kWh</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-t border-line">
                <th scope="row" className="py-1 font-normal">
                  {formatMonth(r.month)} {r.flagged && <span aria-label="flagged">⚠</span>}
                </th>
                <td className="py-1 text-right">{formatNumber(r.kwh)}</td>
                <td className="py-1 text-right">{r.amountInr !== null ? formatInrFull(r.amountInr) : "—"}</td>
                <td className="py-1 text-right">
                  {r.amountInr !== null && r.kwh > 0 ? (r.amountInr / r.kwh).toFixed(2) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
