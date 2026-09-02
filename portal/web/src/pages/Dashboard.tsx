// ---------------------------------------------------------------------------
// The portfolio view — the first screen a customer sees.
//
// Ordered by what it would cost to ignore: the buildings with the largest
// penalty exposure sit at the top, because on a portfolio of thirty a
// customer's attention is the scarce resource.
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { PortfolioEntry } from '@hbs/shared'
import { metricLabel } from '@hbs/shared'
import { usePortal } from '../state/store'
import { int, num, penaltyText, usdCompact } from '../lib/format'
import {
  EmptyState,
  ErrorNote,
  ProvisionalNotice,
  SectionHeading,
  Spinner,
  StatusBadge,
  Tile,
} from '../components/primitives'

export function Dashboard(): JSX.Element {
  const { portfolio, loading, error, loadPortfolio, organization } = usePortal()

  useEffect(() => {
    if (!portfolio) void loadPortfolio()
  }, [portfolio, loadPortfolio])

  const entries = useMemo(() => rank(portfolio?.entries ?? []), [portfolio])

  if (loading && !portfolio) return <Spinner label="Loading your portfolio…" />
  if (error) return <ErrorNote message={error} />
  if (!portfolio) return <EmptyState title="No portfolio data yet." />

  const t = portfolio.totals
  const needsAttention = t.nonCompliant + t.atRisk

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-forest-900">
          {organization?.name ?? 'All organizations'}
        </h1>
        <p className="text-sm text-forest-800/70">
          {int(t.buildings)} buildings · {int(t.totalSqFt)} ft² under management
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Meeting standard"
          value={int(t.compliant)}
          sub={`of ${int(t.buildings)} buildings`}
        />
        <Tile
          label="Needs attention"
          value={int(needsAttention)}
          tone={needsAttention > 0 ? 'warning' : 'default'}
          sub={`${int(t.nonCompliant)} below standard, ${int(t.atRisk)} at risk`}
        />
        <Tile
          label="Data needed"
          value={int(t.insufficientData)}
          sub="buildings we cannot assess yet"
        />
        <Tile
          label="Estimated exposure"
          value={usdCompact(t.estimatedPenaltyExposure)}
          tone={t.estimatedPenaltyExposure > 0 ? 'danger' : 'default'}
          sub={t.exposureVerified ? 'across the portfolio' : 'provisional — see note below'}
        />
      </div>

      {!t.exposureVerified && t.estimatedPenaltyExposure > 0 && <ProvisionalNotice />}

      <div>
        <SectionHeading title="Buildings" />
        {entries.length === 0 ? (
          <EmptyState
            title="No buildings yet."
            detail="Buildings appear once they are shared with HBS in Portfolio Manager and synced."
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-100 text-left">
                  <tr className="text-xs uppercase tracking-wide text-forest-700/80">
                    <th className="px-4 py-2.5 font-semibold">Building</th>
                    <th className="px-4 py-2.5 font-semibold">Type</th>
                    <th className="px-4 py-2.5 text-right font-semibold">ft²</th>
                    <th className="px-4 py-2.5 font-semibold">Metric</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Current</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Target</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Exposure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-200">
                  {entries.map(({ building, assessment, openAlerts }) => (
                    <tr key={building.id} className="hover:bg-cream-50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/buildings/${building.id}`}
                          className="font-medium text-forest-700 hover:underline"
                        >
                          {building.name}
                        </Link>
                        <div className="text-xs text-forest-800/50">
                          {[building.city, building.state].filter(Boolean).join(', ') || '—'}
                          {openAlerts > 0 && (
                            <span className="ml-2 rounded bg-copper-100 px-1.5 py-0.5 text-copper-600">
                              {openAlerts} alert{openAlerts === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-forest-800/80">{building.propertyType}</td>
                      <td className="tabular px-4 py-3 text-right">
                        {int(building.grossFloorAreaSqFt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-forest-800/70">
                        {assessment ? metricLabel(assessment.metric) : '—'}
                      </td>
                      <td className="tabular px-4 py-3 text-right">
                        {num(assessment?.currentValue ?? null)}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-forest-800/70">
                        {num(assessment?.targetValue ?? null)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={assessment?.status} />
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium text-red-800">
                        {penaltyText(assessment?.estimatedPenalty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Largest exposure first, then buildings we cannot assess (invisible risk
 * outranks a comfortable pass), then alphabetically.
 */
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
