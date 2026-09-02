// ---------------------------------------------------------------------------
// The portfolio — the first screen, and a scanning surface rather than a read.
//
// Ordered by what it costs to ignore: largest penalty exposure first, then the
// buildings we cannot assess (invisible risk outranks a comfortable pass). On
// a portfolio of thirty, attention is the scarce resource.
//
// Every row carries its own threshold track, so the shape of the portfolio is
// legible without reading a single number.
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { PortfolioEntry } from '@hbs/shared'
import { metricLabel } from '@hbs/shared'
import { usePortal } from '../state/store'
import { int, num, penaltyText, usdCompact } from '../lib/format'
import { ThresholdTrack } from '../components/Threshold'
import {
  Empty,
  ErrorNote,
  PageHead,
  ProvisionalNotice,
  Reading,
  SectionHead,
  Spinner,
  StatusChip,
} from '../components/primitives'
import { OnboardingPanel } from '../components/OnboardingPanel'

export function Dashboard(): JSX.Element {
  const { portfolio, loading, error, loadPortfolio, profile, org } = usePortal()

  useEffect(() => {
    if (!portfolio) void loadPortfolio()
  }, [portfolio, loadPortfolio])

  const entries = useMemo(() => rank(portfolio?.entries ?? []), [portfolio])

  if (loading && !portfolio) return <Spinner label="Loading portfolio" />
  if (error) return <ErrorNote message={error} />
  if (!portfolio) return <Empty title="No portfolio data yet." />

  const t = portfolio.totals
  const attention = t.nonCompliant + t.atRisk

  return (
    <div>
      <PageHead
        eyebrow={profile ? 'Portfolio' : 'All organizations'}
        title={profile?.name ?? 'Every organization'}
        detail={
          <>
            <span className="measure">{int(t.buildings)}</span> buildings ·{' '}
            <span className="measure">{int(t.totalSqFt)}</span> ft² under management
          </>
        }
      />

      {org?.onboarding && !org.onboarding.complete && (
        <div className="mb-6">
          <OnboardingPanel onboarding={org.onboarding} />
        </div>
      )}

      <div className="mb-7 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        <Reading label="Meeting standard" value={int(t.compliant)} sub={`of ${int(t.buildings)} buildings`} />
        <Reading
          label="Needs attention"
          value={int(attention)}
          tone={attention > 0 ? 'warn' : 'default'}
          sub={`${int(t.nonCompliant)} below standard, ${int(t.atRisk)} at risk`}
        />
        <Reading label="Data needed" value={int(t.insufficientData)} sub="cannot be assessed yet" />
        <Reading
          label="Exposure"
          value={usdCompact(t.estimatedPenaltyExposure)}
          tone={t.estimatedPenaltyExposure > 0 ? 'bad' : 'default'}
          sub={t.exposureVerified ? 'estimated across the portfolio' : 'provisional — see below'}
        />
      </div>

      {!t.exposureVerified && t.estimatedPenaltyExposure > 0 && (
        <ProvisionalNotice className="mb-6" />
      )}

      <SectionHead title="Buildings" detail="Ordered by what it costs to ignore" />

      {entries.length === 0 ? (
        <Empty
          title="No buildings yet."
          detail="Buildings appear once your properties are shared with HBS in Portfolio Manager, or once you connect your own ENERGY STAR account."
          action={
            <Link className="btn-primary" to="/settings/connection">
              Connect Portfolio Manager
            </Link>
          }
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="min-w-[16rem]">Building</th>
                  <th className="min-w-[11rem]">Against standard</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">Standard</th>
                  <th>Status</th>
                  <th className="text-right">Exposure</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <Row key={entry.building.id} entry={entry} index={i} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ entry, index }: { entry: PortfolioEntry; index: number }): JSX.Element {
  const { building, assessment, openAlerts } = entry
  return (
    <tr
      className="rise transition-colors hover:bg-raised/60"
      // A short stagger so the table arrives in reading order rather than all
      // at once. Capped so a large portfolio does not crawl in.
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
    >
      <td>
        <Link to={`/buildings/${building.id}`} className="font-medium text-ink hover:underline">
          {building.name}
        </Link>
        <p className="mt-0.5 text-tiny text-ink-3">
          {building.propertyType} · <span className="measure">{int(building.grossFloorAreaSqFt)}</span> ft²
          {building.city ? ` · ${building.city}, ${building.state ?? ''}` : ''}
        </p>
        {openAlerts > 0 && (
          <span className="chip-warn mt-1.5">
            {openAlerts} alert{openAlerts === 1 ? '' : 's'}
          </span>
        )}
      </td>
      <td className="w-48">
        {assessment ? (
          <>
            <ThresholdTrack assessment={assessment} />
            <p className="mt-1.5 font-mono text-micro uppercase text-ink-3">
              {metricLabel(assessment.metric)}
            </p>
          </>
        ) : (
          <span className="text-tiny text-ink-3">—</span>
        )}
      </td>
      <td className="measure text-right text-ink">{num(assessment?.currentValue ?? null)}</td>
      <td className="measure text-right text-ink-3">{num(assessment?.targetValue ?? null)}</td>
      <td>
        <StatusChip status={assessment?.status} />
      </td>
      <td className="measure text-right font-medium text-bad">
        {penaltyText(assessment?.estimatedPenalty)}
      </td>
    </tr>
  )
}

function rank(entries: PortfolioEntry[]): PortfolioEntry[] {
  const weight = (e: PortfolioEntry): number => {
    const penalty = e.assessment?.estimatedPenalty?.amount ?? 0
    if (penalty > 0) return 1_000_000_000 + penalty
    if (e.assessment?.status === 'insufficient-data') return 500_000
    if (e.assessment?.status === 'at-risk') return 400_000
    return 0
  }
  return [...entries].sort(
    (a, b) => weight(b) - weight(a) || a.building.name.localeCompare(b.building.name),
  )
}
