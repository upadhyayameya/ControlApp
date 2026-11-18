// ---------------------------------------------------------------------------
// Utility accounts — the bills, not the benchmark.
//
// The order on this page is an argument, like the building tabs themselves.
// It opens with whether the bills agree with what ENERGY STAR reports, because
// nothing below is worth reading if they do not. Then the headline figures,
// then where the energy and the money actually go, then what the building pays
// for the next unit as against the average one, and last the problems found in
// the data, which are the only part of this page anyone can act on today.
//
// Colour: the product is monochrome by design and reserves hue for compliance
// status, so fuel mix is drawn as ordered steps of ink with the names written
// on the rows beneath. Identity never rests on colour here, which also means
// the chart survives greyscale print and colour-blind readers unchanged.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FindingSeverity, MeterRollup, UtilityAnalysis, UtilityFinding } from '@hbs/shared'
import { api } from '../api/client'
import { int, num, usd, usdCents, usdCompact } from '../lib/format'
import { useThemeTokens } from '../lib/theme'
import { Empty, ErrorNote, Reading, SectionHead, Spinner } from './primitives'

// --- Local formatting -----------------------------------------------------

/** kBtu runs to eight figures on a large building; nobody reads that. */
function kbtu(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 1)}M`
  if (Math.abs(value) >= 1_000) return `${num(value / 1_000, 0)}k`
  return num(value, 0)
}

function gallons(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 2)}M`
  if (Math.abs(value) >= 1_000) return `${num(value / 1_000, 0)}k`
  return num(value, 0)
}

/** A rate needs more decimals than money: $0.0220/kBtu, not $0.02. */
function rate(value: number | null | undefined, places = 4): string {
  if (value === null || value === undefined) return '—'
  return `$${value.toFixed(places)}`
}

function pct(value: number | null | undefined, places = 0): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(places)}%`
}

/** "2024-03" → "Mar 2024", for an axis that has to stay narrow. */
function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m) - 1] ?? m} ${y?.slice(2) ?? ''}`
}

const SEVERITY_CHIP: Record<FindingSeverity, string> = {
  critical: 'chip-bad',
  warning: 'chip-warn',
  info: 'chip-inert',
}

const SEVERITY_WORD: Record<FindingSeverity, string> = {
  critical: 'Fix',
  warning: 'Check',
  info: 'Note',
}

// --- Page -----------------------------------------------------------------

export function UtilityAccounts({ buildingId }: { buildingId: string }): JSX.Element {
  const [analysis, setAnalysis] = useState<UtilityAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    api
      .utility(buildingId)
      .then((res) => {
        if (live) setAnalysis(res.analysis)
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load utility accounts.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [buildingId])

  if (loading) return <Spinner label="Reading the bills" />
  if (error) return <ErrorNote message={error} />
  if (!analysis) return <Empty title="No utility data for this building." />

  if (analysis.meters.length === 0) {
    return (
      <Empty
        title="No meters on this building yet."
        detail="Utility analysis is built from meter-level bills. Once meters are pulled from Portfolio Manager, or added in Energy data, this page shows consumption and cost per meter, the rates being paid, and any gaps in the billing history."
      />
    )
  }

  const hasBills = analysis.meters.some((m) => m.billCount > 0)
  if (!hasBills) {
    return (
      <Empty
        title="Meters are on file, but no bills have been recorded."
        detail={`${analysis.meters.length} meter${analysis.meters.length === 1 ? '' : 's'} exist on this building with no readings. Enter bills under Energy data, or run a sync if they are in Portfolio Manager already.`}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Reconciliation analysis={analysis} />
      <Headline analysis={analysis} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <FuelMix analysis={analysis} />
        <BaseLoad analysis={analysis} />
      </div>
      <Series analysis={analysis} />
      <Meters analysis={analysis} />
      <Findings findings={analysis.findings} score={analysis.dataQualityScore} />
    </div>
  )
}

// --- Reconciliation -------------------------------------------------------

/**
 * Whether the bills reconstruct the annual figure ENERGY STAR publishes.
 *
 * This leads the page because it is the only thing on it that validates the
 * rest. If the bills rebuild ESPM's own total to within a percent, every
 * meter-level figure below inherits that confidence; if they do not, the
 * difference is the first thing to chase and the per-meter numbers are
 * provisional until it is explained.
 */
function Reconciliation({ analysis }: { analysis: UtilityAnalysis }): JSX.Element {
  const r = analysis.reconciliation
  if (!r) {
    return (
      <section className="border-l-2 border-line-strong bg-raised/40 px-4 py-3">
        <p className="eyebrow">Cross-check against Portfolio Manager</p>
        <p className="mt-1.5 max-w-prose text-base text-ink-2">
          No complete calendar year has both a full set of bills and an ENERGY STAR annual figure,
          so the meter totals below cannot be checked against ESPM yet. They are computed from the
          bills alone.
        </p>
      </section>
    )
  }

  const tone =
    r.verdict === 'agrees'
      ? { border: 'border-good', bg: 'bg-good-soft/40', chip: 'chip-good', label: 'Agrees' }
      : r.verdict === 'minor-variance'
        ? { border: 'border-warn', bg: 'bg-warn-soft/40', chip: 'chip-warn', label: 'Minor variance' }
        : r.verdict === 'material-variance'
          ? { border: 'border-bad', bg: 'bg-bad-soft/40', chip: 'chip-bad', label: 'Material variance' }
          : { border: 'border-line-strong', bg: 'bg-raised/40', chip: 'chip-inert', label: 'Cannot compare' }

  return (
    <section className={`border-l-2 ${tone.border} ${tone.bg} px-4 py-3.5`}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="eyebrow">Cross-check against Portfolio Manager · {r.year}</p>
        <span className={tone.chip}>{tone.label}</span>
        {r.variancePct !== null && (
          <span className="measure text-tiny text-ink-2">
            {r.variancePct >= 0 ? '+' : ''}
            {r.variancePct.toFixed(1)}%
          </span>
        )}
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-tiny text-ink-3">From the bills</dt>
          <dd className="measure text-base text-ink">
            {kbtu(r.meterKbtu)} kBtu
            {r.meterSiteEui !== null && (
              <span className="text-ink-3"> · EUI {num(r.meterSiteEui, 1)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-tiny text-ink-3">ESPM reports</dt>
          <dd className="measure text-base text-ink">
            {r.espmKbtu === null ? 'not reported' : `${kbtu(r.espmKbtu)} kBtu`}
            {r.espmSiteEui !== null && (
              <span className="text-ink-3"> · EUI {num(r.espmSiteEui, 1)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-tiny text-ink-3">Days with no bill</dt>
          <dd className="measure text-base text-ink">{r.uncoveredDays}</dd>
        </div>
        <div>
          <dt className="text-tiny text-ink-3">On-site generation</dt>
          <dd className="measure text-base text-ink">{kbtu(r.onsiteGenerationKbtu)} kBtu</dd>
        </div>
      </dl>

      <p className="mt-3 max-w-prose text-base text-ink-2">{r.note}</p>
    </section>
  )
}

// --- Headline -------------------------------------------------------------

function Headline({ analysis }: { analysis: UtilityAnalysis }): JSX.Element {
  const a = analysis
  return (
    <section>
      <SectionHead
        title="Last twelve months of bills"
        detail={
          a.windowStart && a.windowEnd ? `${a.windowStart} to ${a.windowEnd}` : 'no billing period'
        }
      />
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        <Reading
          label="Purchased energy"
          value={`${kbtu(a.siteEnergyKbtu)}`}
          sub={`kBtu${a.siteEui !== null ? ` · EUI ${num(a.siteEui, 1)} kBtu/ft²` : ''}`}
        />
        <Reading
          label="Energy cost"
          value={usdCompact(a.energyCost)}
          sub={
            a.energyCostPerSqFt !== null
              ? `${usdCents(a.energyCostPerSqFt)} per ft² · ${rate(a.blendedCostPerKbtu)}/kBtu`
              : 'no costs recorded'
          }
        />
        <Reading
          label="Water"
          value={`${gallons(a.waterGallons)}`}
          sub={
            a.waterGallonsPerSqFt !== null
              ? `gallons · ${num(a.waterGallonsPerSqFt, 1)} gal/ft²${a.waterCost !== null ? ` · ${usdCompact(a.waterCost)}` : ''}`
              : 'gallons'
          }
        />
        <Reading
          label="On-site generation"
          value={a.onsiteGenerationKbtu > 0 ? kbtu(a.onsiteGenerationKbtu) : '—'}
          sub={
            a.onsiteGenerationKbtu > 0
              ? `kBtu · ${pct(a.onsiteGenerationShare, 1)} of total energy`
              : 'no on-site generation metered'
          }
        />
      </div>
    </section>
  )
}

// --- Fuel mix -------------------------------------------------------------

/**
 * Where the energy goes against where the money goes.
 *
 * These two shares are the point of the panel, and they are rarely the same:
 * gas is typically most of the energy and a third of the bill, so a retrofit
 * aimed at the larger *energy* share can save less money than one aimed at the
 * smaller one. Showing the two side by side is what makes that visible.
 */
function FuelMix({ analysis }: { analysis: UtilityAnalysis }): JSX.Element {
  const energyFuels = analysis.fuelMix.filter((f) => f.type !== 'Electric - Solar' && f.kbtu > 0)
  const t = useThemeTokens()

  // Ordered steps of ink, darkest for the largest share. A sequential ramp,
  // because fuel mix is parts of one whole rather than unrelated categories.
  const steps = [t.ink, t.ink2, t.ink3, t.lineStrong, t.line]
  const shade = (i: number): string => steps[Math.min(i, steps.length - 1)]!

  if (energyFuels.length === 0) {
    return (
      <section className="panel panel-pad">
        <SectionHead title="Fuel mix" />
        <p className="text-base text-ink-2">
          No convertible energy bills in the window, so there is no mix to show.
        </p>
      </section>
    )
  }

  return (
    <section className="panel panel-pad">
      <SectionHead title="Fuel mix" detail="share of energy against share of cost" />

      <div className="flex h-7 w-full gap-0.5 overflow-hidden" role="presentation">
        {energyFuels.map((f, i) => (
          <div
            key={f.type}
            style={{ width: `${Math.max(f.shareOfSiteEnergy * 100, 1)}%`, background: shade(i) }}
            title={`${f.type}: ${pct(f.shareOfSiteEnergy, 1)} of energy`}
          />
        ))}
      </div>

      <table className="grid-table mt-4">
        <thead>
          <tr>
            <th>Fuel</th>
            <th className="text-right">Energy</th>
            <th className="text-right">Cost</th>
            <th className="text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {energyFuels.map((f, i) => (
            <tr key={f.type}>
              <td>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0"
                    style={{ background: shade(i) }}
                  />
                  <span className="text-ink">{f.type}</span>
                  <span className="text-tiny text-ink-3">
                    {f.meterCount} meter{f.meterCount === 1 ? '' : 's'}
                  </span>
                </span>
              </td>
              <td className="measure text-right">
                {pct(f.shareOfSiteEnergy, 1)}
                <span className="block text-tiny text-ink-3">{kbtu(f.kbtu)} kBtu</span>
              </td>
              <td className="measure text-right">
                {f.shareOfEnergyCost === null ? '—' : pct(f.shareOfEnergyCost, 1)}
                <span className="block text-tiny text-ink-3">{usdCompact(f.cost)}</span>
              </td>
              <td className="measure text-right">
                {rate(f.blendedRatePerKbtu)}
                <span className="block text-tiny text-ink-3">per kBtu</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <MixInsight analysis={analysis} />
    </section>
  )
}

/** The sentence a reader would otherwise have to work out from the table. */
function MixInsight({ analysis }: { analysis: UtilityAnalysis }): JSX.Element | null {
  const fuels = analysis.fuelMix.filter((f) => f.type !== 'Electric - Solar' && f.kbtu > 0)
  if (fuels.length < 2) return null
  const costed = fuels.filter((f) => f.shareOfEnergyCost !== null)
  if (costed.length < 2) return null

  const byEnergy = [...costed].sort((a, b) => b.shareOfSiteEnergy - a.shareOfSiteEnergy)[0]!
  const byCost = [...costed].sort((a, b) => (b.shareOfEnergyCost ?? 0) - (a.shareOfEnergyCost ?? 0))[0]!

  if (byEnergy.type === byCost.type) {
    return (
      <p className="mt-4 max-w-prose text-base text-ink-2">
        {byEnergy.type} is both the largest share of energy ({pct(byEnergy.shareOfSiteEnergy)}) and
        the largest share of the bill ({pct(byEnergy.shareOfEnergyCost)}), so energy savings and
        cost savings point the same way here.
      </p>
    )
  }
  return (
    <p className="mt-4 max-w-prose text-base text-ink-2">
      {byEnergy.type} is the largest share of energy ({pct(byEnergy.shareOfSiteEnergy)}) but{' '}
      {byCost.type} is the largest share of the bill ({pct(byCost.shareOfEnergyCost)}). A measure
      aimed at the bigger energy number will save less money than its size suggests — at{' '}
      {rate(byEnergy.blendedRatePerKbtu)} against {rate(byCost.blendedRatePerKbtu)} per kBtu, a kBtu
      saved is not worth the same in both.
    </p>
  )
}

// --- Base load ------------------------------------------------------------

function BaseLoad({ analysis }: { analysis: UtilityAnalysis }): JSX.Element {
  const b = analysis.baseLoad
  return (
    <section className="panel panel-pad">
      <SectionHead title="Base load" detail="what runs regardless of the weather" />
      {!b ? (
        <p className="max-w-prose text-base text-ink-2">
          Not enough electric bills to separate base load from weather-driven load. Six billing
          periods of normal length are needed; the split is only as good as the mildest month in
          the data.
        </p>
      ) : (
        <>
          <div className="flex h-7 w-full gap-0.5 overflow-hidden">
            <div
              className="bg-ink"
              style={{ width: `${Math.max(b.baseShare * 100, 1)}%` }}
              title={`Base load: ${pct(b.baseShare)}`}
            />
            <div
              className="bg-line-strong"
              style={{ width: `${Math.max(b.variableShare * 100, 1)}%` }}
              title={`Weather and occupancy: ${pct(b.variableShare)}`}
            />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div className="rule">
              <dt className="eyebrow">Base</dt>
              <dd className="font-display text-h2 tab mt-1 text-ink">{pct(b.baseShare)}</dd>
              <dd className="mt-1 text-tiny text-ink-3">
                {int(b.baseDailyKbtu)} kBtu/day, every day
              </dd>
            </div>
            <div className="rule">
              <dt className="eyebrow">Weather &amp; occupancy</dt>
              <dd className="font-display text-h2 tab mt-1 text-ink-2">{pct(b.variableShare)}</dd>
              <dd className="mt-1 text-tiny text-ink-3">the part a schedule change moves</dd>
            </div>
          </dl>
          <p className="mt-4 max-w-prose text-base text-ink-2">
            Read off the lowest-usage electric bill in the history, {b.basePeriodStart} to{' '}
            {b.basePeriodEnd}. A base load above about two thirds usually means equipment running
            outside occupied hours — the cheapest thing to go looking for, since it needs a
            schedule rather than capital.
          </p>
        </>
      )}
    </section>
  )
}

// --- Series ---------------------------------------------------------------

/**
 * Energy and cost over time, as two charts rather than one with two axes.
 *
 * Two y-scales on one plot lets the reader see any crossing they expect to
 * see, and the one thing worth seeing here — cost moving when usage does not —
 * is exactly what a dual axis would obscure.
 */
function Series({ analysis }: { analysis: UtilityAnalysis }): JSX.Element | null {
  const t = useThemeTokens()
  const data = useMemo(
    () =>
      analysis.monthly
        .filter((m) => m.kbtu > 0 || m.cost > 0)
        .map((m) => ({
          key: m.key,
          label: monthLabel(m.key),
          kbtu: Math.round(m.kbtu),
          cost: Math.round(m.cost),
          perDay: m.days > 0 ? m.kbtu / m.days : 0,
        })),
    [analysis.monthly],
  )

  if (data.length < 2) return null

  const tooltip = {
    cursor: { stroke: t.lineStrong, strokeDasharray: '3 3' },
    contentStyle: {
      background: t.surface,
      border: `1px solid ${t.lineStrong}`,
      borderRadius: 3,
      fontSize: 12,
      color: t.ink,
      fontFamily: 'IBM Plex Mono, monospace',
    },
    labelStyle: { color: t.ink3 },
  }
  const axis = {
    tick: { fontSize: 11, fill: t.ink3, fontFamily: 'IBM Plex Mono, monospace' },
    stroke: t.line,
    tickLine: false,
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel panel-pad">
        <SectionHead
          title="Energy by month"
          detail="kBtu, bills apportioned across the months they cover"
        />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 22, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={t.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axis} width={52} tickFormatter={(v: number) => kbtu(v)} />
              <Tooltip
                {...tooltip}
                formatter={(value: number | string) => [`${int(Number(value))} kBtu`, 'Energy']}
              />
              <Area
                type="monotone"
                dataKey="kbtu"
                stroke={t.ink}
                strokeWidth={2}
                fill={t.ink}
                fillOpacity={0.08}
                dot={false}
                activeDot={{ r: 4, fill: t.ink, stroke: t.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel panel-pad">
        <SectionHead title="Cost by month" detail="dollars, on the same apportionment" />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 22, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={t.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axis} width={52} tickFormatter={(v: number) => usdCompact(v)} />
              <Tooltip
                {...tooltip}
                formatter={(value: number | string) => [usd(Number(value)), 'Cost']}
              />
              <Line
                type="monotone"
                dataKey="cost"
                stroke={t.accent}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: t.accent, stroke: t.surface, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

// --- Meters ---------------------------------------------------------------

function Meters({ analysis }: { analysis: UtilityAnalysis }): JSX.Element {
  return (
    <section>
      <SectionHead
        title="Accounts and meters"
        detail="every meter on the building, over its whole billing history"
      />
      <div className="panel overflow-x-auto">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Meter</th>
              <th className="text-right">Bills</th>
              <th>Period</th>
              <th className="text-right">Usage</th>
              <th className="text-right">Cost</th>
              <th className="text-right">Blended</th>
              <th className="text-right">Marginal</th>
              <th className="text-right">Fixed</th>
            </tr>
          </thead>
          <tbody>
            {analysis.meters.map((m) => (
              <MeterRow key={m.meterId} meter={m} />
            ))}
          </tbody>
        </table>
      </div>
      <RateInsight analysis={analysis} />
    </section>
  )
}

function MeterRow({ meter: m }: { meter: MeterRollup }): JSX.Element {
  const worst = m.findings.some((f) => f.severity === 'critical')
    ? 'critical'
    : m.findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : null
  return (
    <tr>
      <td>
        <p className="text-ink">{m.name}</p>
        <p className="mt-0.5 text-tiny text-ink-3">
          {m.type}
          {m.espmMeterId !== null && ` · ESPM ${m.espmMeterId}`}
          {!m.active && ' · not in use'}
        </p>
        {worst && (
          <span className={`${SEVERITY_CHIP[worst]} mt-1.5`}>
            {m.findings.filter((f) => f.severity === worst).length} {SEVERITY_WORD[worst]}
          </span>
        )}
      </td>
      <td className="measure text-right">{m.billCount}</td>
      <td className="measure text-tiny text-ink-2">
        {m.firstPeriodStart ?? '—'}
        <span className="block text-ink-3">to {m.lastPeriodEnd ?? '—'}</span>
      </td>
      <td className="measure text-right">
        {int(m.totalQuantity)}
        <span className="block text-tiny text-ink-3">{m.unit}</span>
        {m.totalKbtu !== null && (
          <span className="block text-tiny text-ink-3">{kbtu(m.totalKbtu)} kBtu</span>
        )}
      </td>
      <td className="measure text-right">{usdCompact(m.totalCost)}</td>
      <td className="measure text-right">{rate(m.blendedRate)}</td>
      <td className="measure text-right">
        {m.rate ? (
          <>
            {rate(m.rate.marginalRate)}
            {/* Below r² 0.8 the split between marginal and fixed is not
                trustworthy, and a number shown without that caveat would be
                quoted as if it were. */}
            <span className="block text-tiny text-ink-3">
              r² {m.rate.rSquared.toFixed(2)}
              {m.rate.rSquared < 0.8 && ' · weak fit'}
            </span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
      <td className="measure text-right">
        {m.rate ? (
          <>
            {usdCents(m.rate.fixedChargePerBill)}
            <span className="block text-tiny text-ink-3">per bill</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
    </tr>
  )
}

/**
 * Why the two rate columns are not the same number.
 *
 * The blended rate is what a customer quotes; the marginal rate is what a
 * saved unit is worth. Where the gap is material, saying so once in a sentence
 * does more than the columns do on their own.
 */
function RateInsight({ analysis }: { analysis: UtilityAnalysis }): JSX.Element | null {
  const candidates = analysis.meters
    .filter((m) => m.isEnergy && m.rate !== null && m.blendedRate !== null && m.rate.rSquared >= 0.8)
    .sort((a, b) => (b.totalKbtu ?? 0) - (a.totalKbtu ?? 0))
  const m = candidates[0]
  if (!m || !m.rate || m.blendedRate === null) return null

  const gap = (m.blendedRate - m.rate.marginalRate) / m.blendedRate
  if (gap < 0.05) {
    return (
      <p className="mt-4 max-w-prose text-base text-ink-2">
        On {m.name}, the blended and marginal rates are{' '}
        {gap < 0.005 ? 'the same' : `within ${pct(Math.abs(gap), 1)} of each other`}, so there is
        little fixed charge to allow for: a unit saved is worth about what the average unit costs,{' '}
        {rate(m.blendedRate)} per {m.unit}. That is unusual — most tariffs carry a standing charge,
        so it is worth checking that the bills carry every line item.
      </p>
    )
  }
  return (
    <p className="mt-4 max-w-prose text-base text-ink-2">
      On {m.name}, the blended rate of {rate(m.blendedRate)} per {m.unit} overstates what a saved
      unit is worth by {pct(gap)}: {usdCents(m.rate.fixedChargePerBill)} per bill does not move with
      usage, so the next unit saved is worth {rate(m.rate.marginalRate)}. Any savings estimate built
      on the blended rate is high by roughly that margin.
    </p>
  )
}

// --- Findings -------------------------------------------------------------

function Findings({
  findings,
  score,
}: {
  findings: UtilityFinding[]
  score: number
}): JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const counts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  }
  const shown = showAll ? findings : findings.slice(0, 8)

  return (
    <section>
      <SectionHead
        title="Data quality"
        detail={`${score} of 100 · ${counts.critical} to fix, ${counts.warning} to check, ${counts.info} noted`}
      />
      {findings.length === 0 ? (
        <p className="max-w-prose text-base text-ink-2">
          No gaps, overlaps, duplicate periods or missing costs in this building&apos;s billing
          history. The figures above rest on a complete record.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {shown.map((f, i) => (
              <li key={`${f.kind}-${f.meterId ?? 'building'}-${f.periodStart ?? i}`} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={SEVERITY_CHIP[f.severity]}>{SEVERITY_WORD[f.severity]}</span>
                  <span className="font-mono text-micro uppercase text-ink-3">
                    {f.kind.replace(/-/g, ' ')}
                  </span>
                  {f.periodStart && (
                    <span className="measure text-tiny text-ink-3">
                      {f.periodStart}
                      {f.periodEnd && f.periodEnd !== f.periodStart && ` → ${f.periodEnd}`}
                    </span>
                  )}
                </div>
                <p className="mt-1 max-w-prose text-base text-ink-2">{f.message}</p>
              </li>
            ))}
          </ul>
          {findings.length > shown.length && (
            <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setShowAll(true)}>
              Show {findings.length - shown.length} more
            </button>
          )}
        </>
      )}
    </section>
  )
}
