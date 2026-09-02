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
  const [preview, setPreview] = useState<{ id: string; html: string } | null>(null)

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

  async function open(report: ReportRecord): Promise<void> {
    setError(null)
    try {
      setPreview({ id: report.id, html: await api.reportHtml(report.id) })
    } catch (err) {
      setError(messageFor(err))
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
                  <button type="button" className="btn-secondary" onClick={() => void open(report)}>
                    {preview?.id === report.id ? 'Showing' : 'Open'}
                  </button>
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

      {preview && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-cream-200 bg-cream-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-forest-700">
              Report preview
            </h2>
            <button
              type="button"
              className="text-xs text-forest-700 hover:underline"
              onClick={() => setPreview(null)}
            >
              Close
            </button>
          </div>
          {/* Rendered in an iframe rather than offered as a download: a viewer
              embedding the portal may block downloads, and print-to-PDF from
              here works the same way. */}
          <iframe
            title="Report preview"
            srcDoc={preview.html}
            className="h-[38rem] w-full border-0 bg-white"
            sandbox=""
          />
        </div>
      )}
    </div>
  )
}
