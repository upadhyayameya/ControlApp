"use client";

import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { Gauge, bandLabel } from "@/components/check/Gauge";
import { MonthlyChart } from "@/components/check/MonthlyChart";
import { LeadGate } from "@/components/check/LeadGate";
import { facilityLabel, subTypeLabel } from "@/components/check/draft";
import { climateZoneLabels } from "@/data/climate";
import { SAMPLE_LABEL } from "@/data/sample";
import { formatInr, formatKwh, formatNumber, formatTco2e } from "@/lib/format";
import { regimeInfo } from "@/lib/regulations";
import { CHECK_DISCLAIMER } from "@/lib/check/disclaimer";
import type { CheckInput, CheckResult, ExposureLevel } from "@/lib/types";

const levelText: Record<ExposureLevel, string> = {
  high: "High relevance",
  medium: "Check",
  low: "Low relevance",
  not_applicable: "Not applicable",
};

export function CheckResults({
  input,
  result,
  isSample,
  onEdit,
}: {
  input: CheckInput;
  result: CheckResult;
  isSample: boolean;
  onEdit: () => void;
}) {
  const facility =
    input.facilityType === "manufacturing"
      ? `${subTypeLabel(input.manufacturingSubType)} plant`
      : facilityLabel(input.facilityType);
  const r = result;

  return (
    <div className="space-y-6">
      {isSample && (
        <div role="note" className="rounded-xl bg-warn-bg px-5 py-3 text-sm font-medium text-warn-fg">
          {SAMPLE_LABEL}. Fictional 180-key hotel in Mumbai — not a real client.
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {facility} · {input.city}, {input.state} · {climateZoneLabels[input.climateZone]} climate
          </p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">Your Energy &amp; Carbon Check</h2>
        </div>
        <Button variant="secondary" onClick={onEdit}>
          Edit inputs
        </Button>
      </div>

      {/* Benchmark + key numbers */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <h3 className="text-sm font-medium uppercase tracking-[0.15em] text-muted">
            {r.metricKind === "EPI" ? "Energy Performance Index" : "Specific energy consumption"}
          </h3>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="text-5xl font-semibold tabular-nums tracking-tight">{formatNumber(r.metricValue)}</span>
            <span className="text-muted">{r.metricUnit}</span>
          </p>
          {r.benchmark && r.band ? (
            <>
              <p className="mt-2">
                <Badge tone={r.band}>{bandLabel[r.band]}</Badge>{" "}
                <span className="text-sm text-muted">
                  vs {facility.toLowerCase()} benchmark{r.metricKind === "EPI" ? `, ${climateZoneLabels[input.climateZone]} zone` : ""}
                </span>
              </p>
              <div className="mt-6">
                <Gauge value={r.metricValue} benchmark={r.benchmark} band={r.band} unit={r.metricUnit} />
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">No benchmark band is available for this sub-sector yet.</p>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Grid electricity" value={formatKwh(r.annualGridKwh)} sub="per year" />
          <Stat
            label="Electricity spend"
            value={r.annualBillInr !== null ? formatInr(r.annualBillInr) : "—"}
            sub={r.annualBillInr !== null ? "from your bills" : "no bills entered"}
          />
          <Stat
            label="Effective tariff"
            value={`₹${r.effectiveTariffInrPerKwh.toFixed(2)}`}
            sub={r.tariffIsAssumed ? "per kWh · assumed" : "per kWh · from bills"}
          />
          {r.kwhPerRoom !== null ? (
            <Stat label="Per room" value={formatKwh(r.kwhPerRoom)} sub="site electricity per key per year" />
          ) : (
            <Stat label="Site electricity" value={formatKwh(r.annualSiteElectricityKwh)} sub="grid + DG + solar" />
          )}
        </div>
      </div>

      {/* Monthly */}
      <Card>
        <h3 className="text-lg font-semibold">Monthly consumption</h3>
        <div className="mt-6">
          <MonthlyChart months={input.months} flags={r.monthFlags} />
        </div>
        {r.monthFlags.length > 0 ? (
          <ul className="mt-6 space-y-2 border-t border-line pt-5 text-sm">
            {r.monthFlags.map((f, i) => (
              <li key={`${f.month}-${i}`} className="flex gap-2">
                <span aria-hidden="true">⚠</span>
                {f.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 border-t border-line pt-5 text-sm text-muted">No unusual months detected.</p>
        )}
      </Card>

      {/* Savings + emissions */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="text-lg font-semibold">Estimated savings potential</h3>
          <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
            {formatInr(r.savings.inrLow)} – {formatInr(r.savings.inrHigh)}
            <span className="text-base font-normal text-muted"> /yr</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {formatKwh(r.savings.kwhLow)} – {formatKwh(r.savings.kwhHigh)} per year
            {r.band && r.band !== "good" ? " if the site moves to the “good” band" : " from fine-tuning a well-performing site"}.
          </p>
          <h4 className="mt-6 text-sm font-medium">Typical measures for your facility type</h4>
          <ul className="mt-3 space-y-2 text-sm">
            {r.measures.map((m) => (
              <li key={m} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {m}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="text-lg font-semibold">Scope 1 &amp; 2 emissions</h3>
          <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">{formatTco2e(r.emissions.total)}</p>
          <p className="mt-1 text-sm text-muted">per year, location-based</p>
          <dl className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-bg-subtle p-4">
              <dt className="text-xs text-muted">Scope 1 · fuels on site</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{formatTco2e(r.emissions.scope1)}</dd>
            </div>
            <div className="rounded-xl bg-bg-subtle p-4">
              <dt className="text-xs text-muted">Scope 2 · grid electricity</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{formatTco2e(r.emissions.scope2)}</dd>
            </div>
          </dl>
          <ul className="mt-5 space-y-1.5 text-sm">
            {r.emissions.breakdown.map((b) => (
              <li key={b.label} className="flex justify-between gap-4 border-b border-line pb-1.5">
                <span>
                  {b.label} <span className="text-muted">· Scope {b.scope}</span>
                </span>
                <span className="tabular-nums">{formatTco2e(b.tco2e)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Exposure */}
      <section aria-labelledby="exposure-h">
        <h3 id="exposure-h" className="mt-4 text-lg font-semibold">
          Regulatory exposure
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {r.exposure.map((e) => (
            <Card key={e.regime} className={`!p-5 ${e.level === "high" ? "border-accent/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{e.regime}</span>
                <Badge tone={e.level === "high" ? "accent" : "neutral"}>{levelText[e.level]}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{regimeInfo[e.regime].name}</p>
              <p className="mt-4 text-sm font-medium">{e.headline}</p>
              <p className="mt-2 text-sm text-muted">{e.detail}</p>
              <Link href={e.trackerHref} className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
                {e.regime} milestones →
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {r.notes.length > 0 && (
        <ul className="space-y-1 text-sm text-muted">
          {r.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}

      <p role="note" className="rounded-xl border border-line p-5 text-sm leading-relaxed text-muted">
        <strong className="text-fg">Screening estimate, not an audit.</strong> {CHECK_DISCLAIMER}
      </p>

      <LeadGate input={input} result={result} isSample={isSample} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-bg-elevated p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}
