// ---------------------------------------------------------------------------
// One building, in four tabs: where it stands, how it got here, its data, and
// what we can do about it.
//
// The tab order is the argument: standing → trend → data → services. A service
// pitch only makes sense after the customer has seen the number that justifies
// it, so it is last and it quotes that number back.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePortal } from '../state/store'
import { ComplianceGauge } from '../components/ComplianceGauge'
import { TrendCharts } from '../components/TrendCharts'
import { DataEntry } from '../components/DataEntry'
import { Recommendations } from '../components/Recommendations'
import { AlertList } from '../components/AlertList'
import { EmptyState, ErrorNote, SectionHeading, Spinner } from '../components/primitives'
import { int } from '../lib/format'

type Tab = 'standing' | 'history' | 'data' | 'services'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'standing', label: 'Standing' },
  { id: 'history', label: 'History' },
  { id: 'data', label: 'Energy data' },
  { id: 'services', label: 'What we can do' },
]

export function BuildingDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const { building, loading, error, loadBuilding } = usePortal()
  const [tab, setTab] = useState<Tab>('standing')

  useEffect(() => {
    if (id) void loadBuilding(id)
  }, [id, loadBuilding])

  if (loading && !building) return <Spinner label="Loading building…" />
  if (error) return <ErrorNote message={error} />
  if (!building) return <EmptyState title="Building not found." />

  const { building: b, currentAssessment, assessments, metrics, alerts, recommendations } = building

  return (
    <div className="space-y-5">
      <div>
        <Link to="/" className="text-xs text-forest-700 hover:underline">
          ← Portfolio
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-forest-900">{b.name}</h1>
        <p className="text-sm text-forest-800/70">
          {b.propertyType} · {int(b.grossFloorAreaSqFt)} ft²
          {b.yearBuilt ? ` · built ${b.yearBuilt}` : ''} ·{' '}
          {[b.addressLine1, b.city, b.state].filter(Boolean).join(', ') || 'address not on file'}
        </p>
        <p className="mt-0.5 text-xs text-forest-800/50">
          {b.espmPropertyId
            ? `Portfolio Manager property ${b.espmPropertyId}`
            : 'Not yet linked to Portfolio Manager'}
          {b.lastSyncedAt && ` · last synced ${new Date(b.lastSyncedAt).toLocaleString()}`}
        </p>
      </div>

      <nav className="flex gap-1 border-b border-cream-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border-forest-500 text-forest-800'
                : 'border-transparent text-forest-800/60 hover:text-forest-800'
            }`}
          >
            {t.label}
            {t.id === 'services' && recommendations.length > 0 && (
              <span className="ml-1.5 rounded-full bg-copper-100 px-1.5 text-xs text-copper-600">
                {recommendations.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'standing' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            {currentAssessment ? (
              <ComplianceGauge assessment={currentAssessment} />
            ) : (
              <EmptyState
                title="No BEPS standard applies to this building."
                detail="It sits outside the jurisdictions the portal tracks, or below the coverage threshold."
              />
            )}
            {assessments.length > 1 && (
              <div className="card card-pad">
                <SectionHeading title="All compliance cycles" />
                <ul className="space-y-2 text-sm">
                  {assessments.map((a) => (
                    <li
                      key={a.cycleId}
                      className="flex items-start justify-between gap-3 border-b border-cream-100 pb-2 last:border-0"
                    >
                      <div>
                        <span className="text-forest-800">{a.cycleLabel}</span>
                        {/* A cycle with no target is not "fine" — it is a
                            standard that has not been published yet, and
                            saying so beats printing an em dash. */}
                        {a.targetValue === null && a.notes[0] && (
                          <p className="text-xs text-forest-800/50">{a.notes[0]}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-forest-800/60">
                        due {a.complianceDate}
                        {a.targetValue !== null && ` · target ${a.targetValue}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <SectionHeading title="Alerts" />
            <AlertList alerts={alerts} />
          </div>
        </div>
      )}

      {tab === 'history' && <TrendCharts metrics={metrics} assessment={currentAssessment} />}

      {tab === 'data' && <DataEntry detail={building} onChanged={() => id && loadBuilding(id)} />}

      {tab === 'services' && (
        <Recommendations
          recommendations={recommendations}
          buildingName={b.name}
          penalty={currentAssessment?.estimatedPenalty ?? null}
        />
      )}
    </div>
  )
}
