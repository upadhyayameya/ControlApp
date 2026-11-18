// ---------------------------------------------------------------------------
// Trends — "am I improving, and fast enough?"
//
// Each chart carries the BEPS target as a reference line, because a trend
// without the standard is just a wiggle. Where the building is short, the
// dashed projection extends the last three years to the compliance date and
// answers the only question that matters: at this rate, do you arrive in time?
//
// Colours come from the live theme tokens rather than literals, so the charts
// stay legible when the viewer is in dark mode.
// ---------------------------------------------------------------------------

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ComplianceAssessment, MetricYear } from '@hbs/shared'
import { num } from '../lib/format'
import { useThemeTokens, type ThemeTokens } from '../lib/theme'
import { Empty, SectionHead } from './primitives'

interface Series {
  key: keyof MetricYear
  label: string
  unit: string
  tone: keyof Pick<ThemeTokens, 'ink' | 'good' | 'warn' | 'accent'>
}

const SERIES: Series[] = [
  { key: 'energyStarScore', label: 'ENERGY STAR score', unit: 'points', tone: 'ink' },
  { key: 'weatherNormalizedSiteEui', label: 'Site EUI, weather normalized', unit: 'kBtu/ft²', tone: 'accent' },
  { key: 'ghgIntensity', label: 'GHG intensity', unit: 'kgCO₂e/ft²', tone: 'warn' },
  { key: 'waterUseIntensity', label: 'Water use intensity', unit: 'gal/ft²', tone: 'good' },
]

export function TrendCharts({
  metrics,
  assessment,
}: {
  metrics: MetricYear[]
  assessment: ComplianceAssessment | null
}): JSX.Element {
  // Only chart series that have numbers — an all-null axis reads as a broken
  // chart rather than as "no score for this property type".
  const populated = useMemo(
    () => SERIES.filter((s) => metrics.some((m) => m[s.key] !== null && m[s.key] !== undefined)),
    [metrics],
  )

  if (metrics.length === 0) {
    return (
      <Empty
        title="No history yet."
        detail="Metrics appear here once a full year has been benchmarked in Portfolio Manager."
      />
    )
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {populated.map((series) => (
        <MetricChart
          key={String(series.key)}
          series={series}
          metrics={metrics}
          assessment={assessment}
        />
      ))}
    </div>
  )
}

interface Row {
  year: number
  value: number | null
  projected: number | null
}

function MetricChart({
  series,
  metrics,
  assessment,
}: {
  series: Series
  metrics: MetricYear[]
  assessment: ComplianceAssessment | null
}): JSX.Element {
  const t = useThemeTokens()
  const stroke = t[series.tone]

  // A target line belongs only on the chart the standard is expressed in;
  // drawing it on the water chart would imply a water standard exists.
  const targetApplies =
    assessment !== null &&
    assessment.targetValue !== null &&
    ((series.key === 'energyStarScore' && assessment.metric === 'energy-star-score') ||
      (series.key === 'weatherNormalizedSiteEui' && assessment.metric === 'site-eui') ||
      (series.key === 'ghgIntensity' && assessment.metric === 'ghg-intensity'))

  const data = useMemo<Row[]>(() => {
    const rows: Row[] = metrics.map((m) => ({
      year: m.year,
      value: (m[series.key] as number | null) ?? null,
      projected: null,
    }))
    return targetApplies && assessment ? withProjection(rows, assessment) : rows
  }, [metrics, series.key, targetApplies, assessment])

  const hasProjection = data.some((d) => d.projected !== null)

  // The axis must contain the target, not just the data. Left on 'auto',
  // Recharts fits the axis to observed values and a standard the building has
  // never reached falls outside it — silently clipping the whole point.
  const domain = useMemo(
    () => yDomain(data, targetApplies ? (assessment?.targetValue ?? null) : null),
    [data, targetApplies, assessment],
  )

  return (
    <section className="panel panel-pad">
      <SectionHead title={series.label} detail={series.unit} />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 16, bottom: 0, left: -14 }}>
            <CartesianGrid stroke={t.line} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: t.ink3, fontFamily: 'IBM Plex Mono, monospace' }}
              stroke={t.line}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: t.ink3, fontFamily: 'IBM Plex Mono, monospace' }}
              stroke={t.line}
              tickLine={false}
              width={54}
              domain={domain}
            />
            <Tooltip
              cursor={{ stroke: t.lineStrong, strokeDasharray: '3 3' }}
              formatter={(value: number | string) => [
                `${num(Number(value))} ${series.unit}`,
                series.label,
              ]}
              labelFormatter={(year) => String(year)}
              contentStyle={{
                background: t.surface,
                border: `1px solid ${t.lineStrong}`,
                borderRadius: 3,
                fontSize: 12,
                color: t.ink,
                fontFamily: 'IBM Plex Mono, monospace',
              }}
              labelStyle={{ color: t.ink3 }}
            />
            {targetApplies && assessment?.targetValue !== null && (
              <ReferenceLine
                y={assessment!.targetValue!}
                stroke={t.bad}
                strokeDasharray="5 3"
                label={{
                  value: `standard ${num(assessment!.targetValue!)}`,
                  position: 'insideTopRight',
                  fill: t.bad,
                  fontSize: 10,
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              />
            )}
            <Line
              type="linear"
              dataKey="value"
              name={series.label}
              stroke={stroke}
              strokeWidth={1.75}
              dot={{ r: 2.5, fill: stroke, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls
              // Recharts replays its entry animation on every container
              // resize, which leaves the lines blank in print and in a
              // screenshot. These get pasted into board decks.
              isAnimationActive={false}
            />
            {hasProjection && (
              <Line
                type="linear"
                dataKey="projected"
                name="At the current rate"
                stroke={stroke}
                strokeWidth={1.25}
                strokeDasharray="4 3"
                strokeOpacity={0.75}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasProjection && assessment && <ProjectionNote data={data} assessment={assessment} />}
    </section>
  )
}

/**
 * Extend the series to the compliance year along the trend of recent history.
 *
 * A straight line through the last three points, not a regression over
 * everything: a building that changed hands two years ago should be judged on
 * what it has done since. Three is the fewest that distinguishes a trend from
 * one good year.
 */
function withProjection(rows: Row[], assessment: ComplianceAssessment): Row[] {
  const known = rows.filter((r) => r.value !== null)
  if (known.length < 3) return rows

  const recent = known.slice(-3)
  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const span = last.year - first.year
  if (span <= 0) return rows

  const slope = ((last.value ?? 0) - (first.value ?? 0)) / span
  const complianceYear = Number(assessment.complianceDate.slice(0, 4))
  if (complianceYear <= last.year) return rows

  const out = rows.map((r) => ({ ...r }))
  // Anchor the dashed line on the last real point so the two lines meet.
  const anchor = out.find((r) => r.year === last.year)
  if (anchor) anchor.projected = anchor.value

  for (let year = last.year + 1; year <= complianceYear; year++) {
    out.push({
      year,
      value: null,
      projected: Math.round(((last.value ?? 0) + slope * (year - last.year)) * 10) / 10,
    })
  }
  return out
}

/** Says whether the projection actually arrives, which is the point of it. */
function ProjectionNote({
  data,
  assessment,
}: {
  data: Row[]
  assessment: ComplianceAssessment
}): JSX.Element | null {
  const target = assessment.targetValue
  if (target === null) return null

  const final = [...data].reverse().find((d) => d.projected !== null)?.projected
  if (final === undefined || final === null) return null

  const arrives = assessment.metric === 'energy-star-score' ? final >= target : final <= target
  const year = assessment.complianceDate.slice(0, 4)

  return (
    <p className={`mt-3 border-t border-line pt-3 text-tiny ${arrives ? 'text-good' : 'text-bad'}`}>
      {arrives
        ? `At the last three years' rate this building reaches ${num(final)} by ${year} — clear of ${num(target)}.`
        : `At the last three years' rate this building reaches only ${num(final)} by ${year}, still short of ${num(target)}. Closing that needs a step change, not more of the same.`}
    </p>
  )
}

/** A range covering data, projection and target, padded so nothing sits flat against an edge. */
function yDomain(rows: Row[], target: number | null): [number | 'auto', number | 'auto'] {
  const values: number[] = []
  for (const row of rows) {
    if (row.value !== null) values.push(row.value)
    if (row.projected !== null) values.push(row.projected)
  }
  if (target !== null) values.push(target)
  if (values.length === 0) return ['auto', 'auto']

  const min = Math.min(...values)
  const max = Math.max(...values)
  // Padding proportional to the series, not an absolute unit: a fixed floor of
  // 1 is invisible on an EUI in the 70s and swamps a GHG intensity of 4.4.
  // The tiny absolute term only rescues a perfectly flat series from
  // collapsing to a zero-height band.
  const magnitude = Math.max(Math.abs(max), Math.abs(min))
  const pad = Math.max((max - min) * 0.15, magnitude * 0.04, magnitude * 0.001 + 0.01)
  const floorTo = (n: number): number => (n >= 10 ? Math.floor(n) : Math.floor(n * 10) / 10)
  const ceilTo = (n: number): number => (n >= 10 ? Math.ceil(n) : Math.ceil(n * 10) / 10)
  return [floorTo(min - pad), ceilTo(max + pad)]
}
