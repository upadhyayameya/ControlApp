// Generated deliverables. Reports render server-side to self-contained HTML,
// which prints to PDF from any browser and stays editable when someone wants
// to add a cover note before sending it on.
import { useCallback, useEffect, useState } from 'react'
import type { ReportRecord } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor } from '../state/store'
import { dateLabel } from '../lib/format'
import { EmptyState, ErrorNote, SectionHeading, Spinner } from '../components/primitives'

const KINDS: Array<{ id: ReportRecord['kind']; label: string; detail: string }> = [
  {
    id: 'annual-compliance',
    label: 'Annual compliance report',
    detail: 'Every building against its BEPS standard, with exposure and deadlines.',
  },
  {
    id: 'portfolio-summary',
    label: 'Portfolio summary',
    detail: 'One page across the whole portfolio for an owner or board.',
  },
  {
    id: 'benchmarking',
    label: 'Benchmarking submission record',
    detail: 'What was reported, for which year, from which meters.',
  },
  {
    id: 'anomaly-review',
    label: 'Anomaly review',
    detail: 'Usage spikes and data gaps found since the last review.',
  },
]

export function Reports(): JSX.Element {
  const [reports, setReports] = useState<ReportRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { reports: list } = await api.reports()
      setReports(list)
    } catch (err) {
      setError(messageFor(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function generate(kind: ReportRecord['kind']): Promise<void> {
    setBusy(kind)
    setError(null)
    try {
      await api.generateReport(kind)
      await load()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(null)
    }
  }

  if (!reports) return <Spinner label="Loading reports…" />

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-forest-900">Reports</h1>
      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {KINDS.map((kind) => (
          <div key={kind.id} className="card card-pad flex flex-col">
            <h2 className="font-semibold text-forest-900">{kind.label}</h2>
            <p className="mt-1 flex-1 text-sm text-forest-800/70">{kind.detail}</p>
            <button
              type="button"
              className="btn-secondary mt-3 self-start"
              onClick={() => void generate(kind.id)}
              disabled={busy !== null}
            >
              {busy === kind.id ? 'Generating…' : 'Generate'}
            </button>
          </div>
        ))}
      </div>

      <div>
        <SectionHeading title="Generated" />
        {reports.length === 0 ? (
          <EmptyState title="Nothing generated yet." />
        ) : (
          <div className="card divide-y divide-cream-200">
            {reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-forest-900">
                    {KINDS.find((k) => k.id === report.kind)?.label ?? report.kind}
                  </p>
                  <p className="text-xs text-forest-800/50">
                    Performance year {report.periodLabel} · {dateLabel(report.generatedAt)}
                  </p>
                </div>
                {report.status === 'ready' ? (
                  <a
                    className="btn-secondary"
                    href={`/api/reports/${report.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-xs uppercase tracking-wide text-forest-800/50">
                    {report.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
