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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildTree } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { int, usdCompact } from '../lib/format'
import { PortfolioTree } from '../components/PortfolioTree'
import {
  Empty,
  ErrorNote,
  PageHead,
  ProvisionalNotice,
  Reading,
  SectionHead,
  Spinner,
} from '../components/primitives'
import { OnboardingPanel } from '../components/OnboardingPanel'

export function Dashboard(): JSX.Element {
  const { portfolio, loading, error, loadPortfolio, profile, org, user } = usePortal()
  const [manage, setManage] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!portfolio) void loadPortfolio()
  }, [portfolio, loadPortfolio])

  // The tree is assembled in the browser from the flat lists the API returns,
  // using the same pure function the server and the background tools use — so
  // a roll-up here can never disagree with a roll-up there.
  const tree = useMemo(
    () => buildTree(portfolio?.groups ?? [], portfolio?.entries ?? []),
    [portfolio],
  )

  const canManage = user?.role === 'customer_admin' || user?.role === 'hbs_staff'

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActionError(null)
      try {
        await fn()
        await loadPortfolio()
      } catch (err) {
        setActionError(messageFor(err))
      }
    },
    [loadPortfolio],
  )

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

      <SectionHead
        title="Portfolio"
        detail="Portfolios and phases roll up everything beneath them"
        action={
          canManage && tree.totals.buildings > 0 ? (
            <button
              type="button"
              className={manage ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => setManage((v) => !v)}
            >
              {manage ? 'Done organising' : 'Organise'}
            </button>
          ) : undefined
        }
      />

      {actionError && (
        <div className="mb-3">
          <ErrorNote message={actionError} />
        </div>
      )}

      {tree.totals.buildings === 0 ? (
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
        <div className="overflow-x-auto">
          <PortfolioTree
            tree={tree}
            manage={manage && canManage}
            onFileBuilding={(buildingId, groupId) =>
              void act(() => api.fileBuilding(buildingId, groupId))
            }
            onAddChild={(parentId) => {
              const name = window.prompt(
                parentId === null ? 'Name for the new portfolio' : 'Name for the new phase',
                parentId === null ? 'New portfolio' : 'Phase 1',
              )
              if (name?.trim()) void act(() => api.createGroup({ name: name.trim(), parentId }))
            }}
            onRename={(groupId, name) => void act(() => api.updateGroup(groupId, { name }))}
            onDelete={(groupId) => {
              // Deleting detaches rather than destroys, and saying so is what
              // makes the confirmation honest.
              if (
                window.confirm(
                  'Delete this group? Anything inside it becomes unfiled — no buildings are removed.',
                )
              ) {
                void act(() => api.deleteGroup(groupId))
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

