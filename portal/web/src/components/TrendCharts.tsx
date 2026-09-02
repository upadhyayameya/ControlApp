// ---------------------------------------------------------------------------
// Historical trends — "am I getting better, and fast enough?"
//
// Each chart draws the metric's own history against a dashed reference line at
// the BEPS target, because a trend without the target is just a wiggle. Where
// the building is short and improving, the projection line answers the
// question that actually matters: at this rate, do I arrive in time?
// ---------------------------------------------------------------------------

import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
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
import { SectionHeading } from './primitives'

interface Series {
  key: keyof MetricYear
  label: string
  unit: string
  color: string
}

const SERIES: Series[] = [
  { key: 'energyStarScore', label: 'ENERGY STAR score', unit: 'points', color: '#2f6b3d' },
  { key: 'weatherNormalizedSiteEui', label: 'Site EUI (weather normalized)', unit: 'kBtu/ft²', color: '#b56a33' },
  { key: 'ghgIntensity', label: 'GHG intensity', unit: 'kgCO₂e/ft²', color: '#7c8aa5' },
  { key: 'waterUseIntensity', label: 'Water use intensity', unit: 'gal/ft²', color: '#3b9ed6' },
]

export function TrendCharts({
  metrics,
  assessment,
}: {
  metrics: MetricYear[]
  assessment: ComplianceAssessment | null
}): JSX.Element {
  // Only chart series that actually have numbers — an all-null axis reads as a
  // broken chart rather than as "this building has no score".
  const populated = useMemo(
    () => SERIES.filter((s) => metrics.some((m) => m[s.key] !== null && m[s.key] !== undefined)),
    [metrics],
  )

  if (metrics.length === 0) {
    return (
      <div className="card card-pad text-sm text-forest-800/70">
        No historical data yet. Metrics appear here once a full year has been benchmarked in
        Portfolio Manager.
      </div>
    )
  }

  return (
    <div className="space-y-4">
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

function MetricChart({
  series,
  metrics,
  assessment,
}: {
  series: Series
  metrics: MetricYear[]
  assessment: ComplianceAssessment | null
}): JSX.Element {
  // A target line only belongs on the chart the standard is actually expressed
  // in; drawing it on the water chart would imply a water standard exists.
  const targetApplies =
    assessment !== null &&
    assessment.targetValue !== null &&
    ((series.key === 'energyStarScore' && assessment.metric === 'energy-star-score') ||
      (series.key === 'weatherNormalizedSiteEui' && assessment.metric === 'site-eui') ||
      (series.key === 'ghgIntensity' && assessment.metric === 'ghg-intensity'))

  const data = useMemo(() => {
    const rows = metrics.map((m) => ({
      year: m.year,
      value: (m[series.key] as number | null) ?? null,
      projected: null as number | null,
    }))

    if (!targetApplies || !assessment) return rows
    return withProjection(rows, assessment)
  }, [metrics, series.key, targetApplies, assessment])

  const hasProjection = data.some((d) => d.projected !== null)

  // The Y axis must contain the target, not just the data. Left on 'auto',
  // Recharts fits the axis to the observed values, so a target the building
  // has never reached sits outside the axis and the reference line — the whole
  // point of the chart — is silently clipped away.
  const domain = useMemo(
    () => yDomain(data, targetApplies ? assessment?.targetValue ?? null : null),
    [data, targetApplies, assessment],
  )

  return (
    <div className="card card-pad">
      <SectionHeading title={series.label} />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#e7dcc4" strokeDasharray="3 3" />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 12, fill: '#14301c' }}
              stroke="#d6c8a8"
              allowDecimals={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#14301c' }}
              stroke="#d6c8a8"
              width={56}
              domain={domain}
              allowDataOverflow={false}
            />
            <Tooltip
              formatter={(value: number | string) => [`${num(Number(value))} ${series.unit}`, series.label]}
              labelFormatter={(year) => `Year ${String(year)}`}
              contentStyle={{
                borderRadius: 6,
                border: '1px solid #e7dcc4',
                fontSize: 12,
              }}
            />
            {targetApplies && assessment?.targetValue !== null && (
              <ReferenceLine
                y={assessment!.targetValue!}
                stroke="#b4392a"
                strokeDasharray="6 4"
                label={{
                  value: `BEPS target ${num(assessment!.targetValue!)}`,
                  position: 'insideTopRight',
                  fill: '#b4392a',
                  fontSize: 11,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              name={series.label}
              stroke={series.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
            {hasProjection && (
              <Line
                type="monotone"
                dataKey="projected"
                name="At the current rate"
                stroke={series.color}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {hasProjection && <Legend wrapperStyle={{ fontSize: 12 }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasProjection && <ProjectionNote data={data} assessment={assessment!} />}
    </div>
  )
}

interface Row {
  year: number
  value: number | null
  projected: number | null
}

/**
 * Extend the series to the compliance year along the trend of recent history.
 *
 * A straight line through the last three points, not a regression over
 * everything: a building that changed management two years ago should be
 * judged on what it has done since. Three points is the fewest that can
 * distinguish a trend from a single good year.
 */
function withProjection(rows: Row[], assessment: ComplianceAssessment): Row[] {
  const known = rows.filter((r) => r.value !== null)
  if (known.length < 3) return rows

  const recent = known.slice(-3)
  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const span = last.year - first.year
  if (span <= 0) return rows

  const slopePerYear = ((last.value ?? 0) - (first.value ?? 0)) / span
  const complianceYear = Number(assessment.complianceDate.slice(0, 4))
  if (complianceYear <= last.year) return rows

  const out: Row[] = rows.map((r) => ({ ...r }))
  // Anchor the dashed line on the last real point so the two lines meet.
  const anchor = out.find((r) => r.year === last.year)
  if (anchor) anchor.projected = anchor.value

  for (let year = last.year + 1; year <= complianceYear; year++) {
    out.push({
      year,
      value: null,
      projected: round((last.value ?? 0) + slopePerYear * (year - last.year)),
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

  const higherIsBetter = assessment.metric === 'energy-star-score'
  const arrives = higherIsBetter ? final >= target : final <= target
  const complianceYear = assessment.complianceDate.slice(0, 4)

  return (
    <p className={`mt-2 text-xs ${arrives ? 'text-forest-700' : 'text-red-800'}`}>
      {arrives
        ? `At the improvement rate of the last three years this building reaches ${num(
            target,
          )} by ${complianceYear} — projected ${num(final)}.`
        : `At the improvement rate of the last three years this building reaches only ${num(
            final,
          )} by ${complianceYear}, still short of ${num(target)}. Closing the gap needs a step change, not more of the same.`}
    </p>
  )
}

/**
 * A Y-axis range covering the data, the projection and the target, padded so
 * nothing sits flat against an edge. Returns 'auto' bounds when there is
 * nothing to fit, letting Recharts do its normal thing.
 */
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
  // A flat series would otherwise collapse to a zero-height band.
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.05, 1)
  return [floorTo(min - pad), ceilTo(max + pad)]
}

function floorTo(n: number): number {
  return n >= 10 ? Math.floor(n) : Math.floor(n * 10) / 10
}

function ceilTo(n: number): number {
  return n >= 10 ? Math.ceil(n) : Math.ceil(n * 10) / 10
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
