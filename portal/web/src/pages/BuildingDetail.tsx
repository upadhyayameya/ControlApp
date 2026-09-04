// ---------------------------------------------------------------------------
// One building, in four tabs.
//
// The order is the argument: where it stands → how it got here → its data →
// what we can do about it. A service pitch only makes sense after the customer
// has seen the number that justifies it, so it comes last and quotes it back.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePortal } from '../state/store'
import { ThresholdBand } from '../components/Threshold'
import { TrendCharts } from '../components/TrendCharts'
import { DataEntry } from '../components/DataEntry'
import { Recommendations } from '../components/Recommendations'
import { AlertList } from '../components/AlertList'
import {
  Empty,
  ErrorNote,
  PageHead,
  ProvisionalNotice,
  SectionHead,
  Spinner,
} from '../components/primitives'
import { int, penaltyText } from '../lib/format'

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

  if (loading && !building) return <Spinner label="Loading building" />
  if (error) return <ErrorNote message={error} />
  if (!building) return <Empty title="Building not found." />

  const { building: b, currentAssessment, assessments, metrics, alerts, recommendations } = building

  return (
    <div>
      <Link to="/" className="font-mono text-micro uppercase text-ink-3 hover:text-ink">
        ← Portfolio
      </Link>

      <PageHead
        title={b.name}
        detail={
          <>
            {b.propertyType} · <span className="measure">{int(b.grossFloorAreaSqFt)}</span> ft²
            {b.yearBuilt ? <> · built <span className="measure">{b.yearBuilt}</span></> : null}
            {' · '}
            {[b.addressLine1, b.city, b.state].filter(Boolean).join(', ') || 'address not on file'}
          </>
        }
      />

      <p className="-mt-4 mb-6 font-mono text-micro uppercase text-ink-3">
        {b.espmPropertyId ? `ESPM property ${b.espmPropertyId}` : 'Not linked to Portfolio Manager'}
      </p>

      <nav className="mb-6 flex flex-wrap gap-0.5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-base transition ${
              tab === t.id
                ? 'border-ink font-medium text-ink'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {t.label}
            {t.id === 'services' && recommendations.length > 0 && (
              <span className="ml-1.5 font-mono text-micro text-warn">{recommendations.length}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'standing' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            {currentAssessment ? (
              <>
                <ThresholdBand assessment={currentAssessment} />
                {currentAssessment.estimatedPenalty && (
                  <section className="panel panel-pad">
                    <p className="eyebrow">Estimated exposure</p>
                    <p className="figure mt-1.5 text-bad">
                      {penaltyText(currentAssessment.estimatedPenalty)}
                    </p>
                    <p className="mt-2 max-w-prose text-base text-ink-2">
                      {currentAssessment.estimatedPenalty.basis}
                    </p>
                    <ProvisionalNotice
                      penalty={currentAssessment.estimatedPenalty}
                      className="mt-4"
                    />
                  </section>
                )}
                {currentAssessment.notes.length > 0 && (
                  <section className="rule">
                    <p className="eyebrow mb-1.5">Notes on this assessment</p>
                    <ul className="space-y-1 text-tiny text-ink-3">
                      {currentAssessment.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              <Empty
                title="No BEPS standard applies to this building."
                detail={
                  b.jurisdiction === 'none'
                    ? `${[b.city, b.state].filter(Boolean).join(', ') || 'This address'} is outside the District and Montgomery County, the two jurisdictions the portal tracks. Its data is still collected and charted — there is simply no standard to measure it against. If that is wrong, HBS can set the jurisdiction on this building.`
                    : 'It sits below the coverage threshold for every cycle in its jurisdiction.'
                }
              />
            )}

            {assessments.length > 1 && (
              <section className="panel panel-pad">
                <SectionHead title="All compliance cycles" />
                <ul className="divide-y divide-line border-t border-line">
                  {assessments.map((a) => (
                    <li key={a.cycleId} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-base text-ink">{a.cycleLabel}</p>
                        {/* A cycle with no target is not "fine" — it is a
                            standard that has not been published yet, and
                            saying so beats printing an em dash. */}
                        {a.targetValue === null && a.notes[0] && (
                          <p className="mt-0.5 text-tiny text-ink-3">{a.notes[0]}</p>
                        )}
                      </div>
                      <span className="measure shrink-0 text-tiny text-ink-3">
                        {a.complianceDate}
                        {a.targetValue !== null && ` · target ${a.targetValue}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div>
            <SectionHead title="Alerts" />
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
