import { Document, Page, Path, Rect, StyleSheet, Svg, Text, View, Line } from "@react-pdf/renderer";
import { LOGO_PATH } from "@/components/Logo";
import { facilityLabel, subTypeLabel } from "@/components/check/draft";
import { CHECK_DISCLAIMER } from "@/lib/check/disclaimer";
import { allAssumptions } from "@/data/assumptions";
import { measuresFor } from "@/data/measures";
import { climateZoneLabels } from "@/data/climate";
import { SAMPLE_LABEL } from "@/data/sample";
import { formatInr, formatInrFull, formatKwh, formatMonth, formatNumber, formatTco2e } from "@/lib/format";
import { regimeInfo } from "@/lib/regulations";
import { site } from "@/lib/site";
import type { CheckInput, CheckResult } from "@/lib/types";
import type { ReportContact } from "@/components/check/LeadGate";

// Print palette (light theme tokens).
const C = {
  fg: "#16140f",
  muted: "#5c574d",
  line: "#e2dccf",
  subtle: "#f4f0e8",
  accent: "#7a5a2e",
  logo: "#9b7a4a",
  good: "#2e7d44",
  typical: "#b58500",
  poor: "#c62828",
  warnBg: "#fff4d6",
  warnFg: "#5a4000",
};

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9.5, color: C.fg, paddingTop: 56, paddingBottom: 56, paddingHorizontal: 44, lineHeight: 1.45 },
  header: { position: "absolute", top: 22, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footer: { position: "absolute", bottom: 22, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.muted },
  brand: { flexDirection: "row", alignItems: "center", gap: 6 },
  brandText: { fontSize: 8, letterSpacing: 1.6, fontWeight: 600 },
  h1: { fontSize: 24, fontWeight: 600, letterSpacing: -0.4, marginTop: 8, lineHeight: 1.2 },
  h2: { fontSize: 13, fontWeight: 600, marginTop: 18, marginBottom: 8, lineHeight: 1.25 },
  h3: { fontSize: 10.5, fontWeight: 600, marginBottom: 3, lineHeight: 1.3 },
  muted: { color: C.muted },
  small: { fontSize: 8, color: C.muted },
  row: { flexDirection: "row", gap: 10 },
  card: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 10 },
  statLabel: { fontSize: 7.5, color: C.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  statValue: { fontSize: 13, fontWeight: 600, marginTop: 3, lineHeight: 1.25 },
  sample: { backgroundColor: C.warnBg, color: C.warnFg, padding: 8, borderRadius: 4, fontWeight: 600, marginBottom: 10 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 2.5 },
  th: { fontWeight: 600, color: C.muted, fontSize: 8 },
  bullet: { flexDirection: "row", gap: 6, marginBottom: 4 },
  note: { borderWidth: 1, borderColor: C.line, borderRadius: 6, padding: 10, marginTop: 14, color: C.muted, fontSize: 8.5 },
});

const bandColor = { good: C.good, typical: C.typical, poor: C.poor } as const;
const bandText = { good: "Good", typical: "Typical", poor: "Poor" } as const;

function Brand() {
  return (
    <View style={s.brand}>
      <Svg width={16} height={16} viewBox="0 0 64 64">
        <Path d={LOGO_PATH} stroke={C.logo} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Text style={s.brandText}>WATT ON EARTH</Text>
    </View>
  );
}

function BandBar({ r }: { r: CheckResult }) {
  if (!r.benchmark || !r.band) return null;
  const b = r.benchmark;
  const max = Math.max(b.poorMin * 1.4, r.metricValue * 1.08);
  const W = 240;
  const x = (v: number) => (Math.min(v, max) / max) * W;
  return (
    <View style={{ marginTop: 8 }}>
      <Svg width={W} height={30}>
        <Rect x={0} y={8} width={x(b.goodMax) - 1} height={8} fill={C.good} opacity={r.band === "good" ? 1 : 0.35} />
        <Rect x={x(b.goodMax) + 1} y={8} width={x(b.poorMin) - x(b.goodMax) - 2} height={8} fill={C.typical} opacity={r.band === "typical" ? 1 : 0.35} />
        <Rect x={x(b.poorMin) + 1} y={8} width={W - x(b.poorMin) - 1} height={8} fill={C.poor} opacity={r.band === "poor" ? 1 : 0.35} />
        <Line x1={x(r.metricValue)} y1={2} x2={x(r.metricValue)} y2={22} stroke={C.fg} strokeWidth={2} />
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", width: W }}>
        <Text style={s.small}>Good ≤ {formatNumber(b.goodMax)}</Text>
        <Text style={s.small}>Poor &gt; {formatNumber(b.poorMin)} {b.unit}</Text>
      </View>
    </View>
  );
}

function MonthlyBars({ input, r }: { input: CheckInput; r: CheckResult }) {
  const W = 507;
  const H = 120;
  const flagged = new Set(r.monthFlags.map((f) => f.month));
  const max = Math.max(...input.months.map((m) => m.kwh), 1);
  const slot = W / 12;
  return (
    <View>
      <Svg width={W} height={H + 14}>
        <Line x1={0} y1={H} x2={W} y2={H} stroke={C.line} strokeWidth={1} />
        {input.months.map((m, i) => {
          const h = (m.kwh / max) * (H - 6);
          return (
            <Rect
              key={m.month}
              x={i * slot + 4}
              y={H - h}
              width={slot - 8}
              height={h}
              fill={flagged.has(m.month) ? C.poor : C.accent}
            />
          );
        })}
      </Svg>
      <View style={{ flexDirection: "row", marginTop: -12 }}>
        {input.months.map((m) => (
          <Text key={m.month} style={{ width: slot, textAlign: "center", fontSize: 7, color: C.muted }}>
            {formatMonth(m.month, true)}
            {flagged.has(m.month) ? " !" : ""}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function CheckReportDocument({
  input,
  result: r,
  contact,
  isSample,
  generatedAt,
}: {
  input: CheckInput;
  result: CheckResult;
  contact: ReportContact;
  isSample: boolean;
  generatedAt: Date;
}) {
  const isPlant = input.facilityType === "manufacturing";
  const facility = isPlant ? `${subTypeLabel(input.manufacturingSubType)} plant` : facilityLabel(input.facilityType);
  const measures = measuresFor(input.facilityType, input.manufacturingSubType);
  const dateText = generatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const assumptions = allAssumptions();
  const unverified = assumptions.filter((a) => !a.verified).length;

  return (
    <Document title={`Energy & Carbon Check — ${contact.company}`} author={site.name} subject="Screening-level energy and carbon report">
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <Brand />
          <Text style={s.small}>Energy &amp; Carbon Check · {dateText}</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>{site.domain} · Screening estimate — not an energy audit</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

        {isSample && <Text style={s.sample}>{SAMPLE_LABEL}. Fictional 180-key hotel in Mumbai — not a real client.</Text>}

        <Text style={{ ...s.small, textTransform: "uppercase", letterSpacing: 1.2, color: C.accent }}>Prepared for {contact.company}</Text>
        <Text style={s.h1}>Energy &amp; Carbon Check</Text>
        <Text style={{ ...s.muted, marginTop: 4 }}>
          {facility} · {input.city}, {input.state} · {climateZoneLabels[input.climateZone]} climate zone
          {isPlant
            ? ` · ${formatNumber(input.annualProductionTonnes ?? 0)} t/yr`
            : ` · ${formatNumber(input.floorArea ?? 0)} ${input.areaUnit === "m2" ? "m²" : "ft²"}`}
          {input.rooms ? ` · ${input.rooms} rooms` : ""}
        </Text>
        <Text style={{ ...s.small, marginTop: 2 }}>
          Data period {formatMonth(input.months[0].month)} – {formatMonth(input.months[11].month)} · Prepared for {contact.name}
        </Text>

        {/* Headline */}
        <View style={{ ...s.row, marginTop: 18 }}>
          <View style={{ ...s.card, flex: 1.4 }}>
            <Text style={s.statLabel}>{r.metricKind === "EPI" ? "Energy Performance Index" : "Specific energy consumption"}</Text>
            <Text style={{ fontSize: 26, fontWeight: 600, marginTop: 4, lineHeight: 1.15 }}>
              {formatNumber(r.metricValue)} <Text style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>{r.metricUnit}</Text>
            </Text>
            {r.band ? (
              <Text style={{ marginTop: 2 }}>
                <Text style={{ color: bandColor[r.band], fontWeight: 600 }}>● </Text>
                {bandText[r.band]} against the benchmark band
              </Text>
            ) : (
              <Text style={s.muted}>No benchmark band available</Text>
            )}
            <BandBar r={r} />
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <View style={s.card}>
              <Text style={s.statLabel}>Savings potential</Text>
              <Text style={s.statValue}>
                {formatInr(r.savings.inrLow)} – {formatInr(r.savings.inrHigh)}/yr
              </Text>
              <Text style={s.small}>
                {formatKwh(r.savings.kwhLow)} – {formatKwh(r.savings.kwhHigh)}
              </Text>
            </View>
            <View style={s.card}>
              <Text style={s.statLabel}>Scope 1 + 2 emissions</Text>
              <Text style={s.statValue}>{formatTco2e(r.emissions.total)}/yr</Text>
              <Text style={s.small}>
                Scope 1 {formatTco2e(r.emissions.scope1)} · Scope 2 {formatTco2e(r.emissions.scope2)}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ ...s.row, marginTop: 10 }}>
          <View style={s.card}>
            <Text style={s.statLabel}>Grid electricity</Text>
            <Text style={s.statValue}>{formatKwh(r.annualGridKwh)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.statLabel}>Site electricity</Text>
            <Text style={s.statValue}>{formatKwh(r.annualSiteElectricityKwh)}</Text>
            <Text style={s.small}>grid + DG + solar</Text>
          </View>
          <View style={s.card}>
            <Text style={s.statLabel}>Electricity spend</Text>
            <Text style={s.statValue}>{r.annualBillInr !== null ? formatInr(r.annualBillInr) : "—"}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.statLabel}>Effective tariff</Text>
            <Text style={s.statValue}>₹{r.effectiveTariffInrPerKwh.toFixed(2)}/kWh</Text>
            <Text style={s.small}>{r.tariffIsAssumed ? "assumed" : "from bills"}</Text>
          </View>
        </View>

        {/* Monthly */}
        <Text style={s.h2}>Monthly grid electricity</Text>
        <MonthlyBars input={input} r={r} />
        {r.monthFlags.length > 0 && (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={s.h3}>Months to investigate</Text>
            {r.monthFlags.map((f, i) => (
              <View key={i} style={s.bullet}>
                <Text style={{ color: C.poor, fontWeight: 600 }}>!</Text>
                <Text style={{ flex: 1 }}>{f.reason}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.h2} break>
          Monthly data
        </Text>
        <View>
          <View style={s.tableRow}>
            <Text style={{ ...s.th, width: "30%" }}>Month</Text>
            <Text style={{ ...s.th, width: "25%", textAlign: "right" }}>kWh</Text>
            <Text style={{ ...s.th, width: "25%", textAlign: "right" }}>Bill (₹)</Text>
            <Text style={{ ...s.th, width: "20%", textAlign: "right" }}>₹/kWh</Text>
          </View>
          {input.months.map((m) => (
            <View key={m.month} style={s.tableRow} wrap={false}>
              <Text style={{ width: "30%" }}>{formatMonth(m.month)}</Text>
              <Text style={{ width: "25%", textAlign: "right" }}>{formatNumber(m.kwh)}</Text>
              <Text style={{ width: "25%", textAlign: "right" }}>{m.amountInr !== null ? formatInrFull(m.amountInr) : "—"}</Text>
              <Text style={{ width: "20%", textAlign: "right" }}>
                {m.amountInr !== null && m.kwh > 0 ? (m.amountInr / m.kwh).toFixed(2) : "—"}
              </Text>
            </View>
          ))}
        </View>
        {/* Emissions */}
        <Text style={s.h2}>Emissions breakdown</Text>
        {r.emissions.breakdown.map((b) => (
          <View key={b.label} style={s.tableRow}>
            <Text style={{ width: "60%" }}>{b.label}</Text>
            <Text style={{ width: "20%", color: C.muted }}>Scope {b.scope}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>{formatTco2e(b.tco2e)}</Text>
          </View>
        ))}
        <Text style={{ ...s.small, marginTop: 4 }}>Scope 2 is location-based using the grid emission factor listed under assumptions.</Text>

        {/* Exposure */}
        <Text style={s.h2}>Regulatory exposure</Text>
        {r.exposure.map((e) => (
          <View key={e.regime} style={{ marginBottom: 8 }} wrap={false}>
            <Text style={s.h3}>
              {e.regime} — {regimeInfo[e.regime].name}: <Text style={{ color: C.accent }}>{e.headline}</Text>
            </Text>
            <Text style={s.muted}>{e.detail}</Text>
            <Text style={s.small}>Milestones and official sources: {site.url}{e.trackerHref}</Text>
          </View>
        ))}

        {/* Measures */}
        <Text style={s.h2} break>
          Typical efficiency measures
        </Text>
        <Text style={{ ...s.muted, marginBottom: 8 }}>
          Screening-level measures that commonly deliver savings in {isPlant ? "plants of this type" : `${facility.toLowerCase()}s`}. An audit
          confirms which apply to your site and quantifies each one.
        </Text>
        {measures.map((m) => (
          <View key={m.title} style={{ marginBottom: 7 }} wrap={false}>
            <Text style={s.h3}>{m.title}</Text>
            <Text style={s.muted}>{m.detail}</Text>
          </View>
        ))}

        {r.notes.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={s.h3}>Notes</Text>
            {r.notes.map((n) => (
              <View key={n} style={s.bullet}>
                <Text>•</Text>
                <Text style={{ flex: 1, color: C.muted }}>{n}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ marginTop: 16, backgroundColor: C.subtle, borderRadius: 6, padding: 14 }} wrap={false}>
          <Text style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>Next step: a Remote Energy Audit</Text>
          <Text style={{ ...s.muted, marginTop: 4 }}>
            Replace screening assumptions with your actual data — end-use breakdown, measures ranked by ₹ savings and payback, and a
            Scope 1 &amp; 2 baseline. Fixed price, delivered remotely. Book at {site.url}/contact or write to {site.email}.
          </Text>
        </View>
        {/* Assumptions */}
        <Text style={s.h2} break>
          Method, assumptions and sources
        </Text>
        <Text style={{ ...s.muted, marginBottom: 8 }}>
          EPI = annual site electricity (grid + DG output + on-site solar) ÷ built-up area. For plants, SEC = site electricity ÷
          annual production. Savings: the high case closes the full gap to the “good” threshold; the low case captures part of
          it. {unverified > 0 ? `${unverified} of ${assumptions.length} values below are provisional and are being verified against the sources listed.` : ""}
        </Text>
        <View style={s.tableRow}>
          <Text style={{ ...s.th, width: "34%" }}>Assumption</Text>
          <Text style={{ ...s.th, width: "20%" }}>Value</Text>
          <Text style={{ ...s.th, width: "34%" }}>Source</Text>
          <Text style={{ ...s.th, width: "12%" }}>Status</Text>
        </View>
        {assumptions.map((a) => (
          <View key={a.key} style={s.tableRow} wrap={false}>
            <Text style={{ width: "34%", fontSize: 8 }}>{a.label}</Text>
            <Text style={{ width: "20%", fontSize: 8 }}>
              {a.value} {a.unit}
            </Text>
            <Text style={{ width: "34%", fontSize: 7, color: C.muted }}>{a.source}</Text>
            <Text style={{ width: "12%", fontSize: 7.5, color: a.verified ? C.good : C.muted }}>
              {a.verified ? "Verified" : "Provisional"}
            </Text>
          </View>
        ))}

        <Text style={s.note}>
          <Text style={{ fontWeight: 600, color: C.fg }}>Important. </Text>
          {CHECK_DISCLAIMER}
        </Text>

      </Page>
    </Document>
  );
}
