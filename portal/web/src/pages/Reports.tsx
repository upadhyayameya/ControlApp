// Generated deliverables. Reports render server-side to self-contained HTML,
// which prints to PDF from any browser and stays editable when someone wants
// to add a cover note before sending it on.
import { useCallback, useEffect, useState } from 'react'
import type { ReportRecord } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor } from '../state/store'
import { dateLabel } from '../lib/format'
import { Empty, ErrorNote, PageHead, SectionHead, Spinner } from '../components/primitives'

const KINDS: Array<{ id: ReportRecord['kind']; label: string; detail: string }> = [
  {
    id: 'annual-compliance',
    label: 'Annual compliance',
    detail: 'Every building against its BEPS standard, with exposure and deadlines.',
  },
  {
    id: 'portfolio-summary',
    label: 'Portfolio summary',
    detail: 'One page across the whole portfolio, for an owner or a board.',
  },
  {
    id: 'benchmarking',
    label: 'Benchmarking record',
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
      setReports((await api.reports()).reports)
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

  if (!reports) return <Spinner label="Loading reports" />

  return (
    <div>
      <PageHead title="Reports" detail="Generated from the same numbers the portal shows." />

      {error && (
        <div className="mb-5">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KINDS.map((kind) => (
          <article key={kind.id} className="panel panel-pad flex flex-col">
            <h2 className="font-display text-h3 text-ink">{kind.label}</h2>
            <p className="mt-1.5 flex-1 text-base text-ink-2">{kind.detail}</p>
            <button
              type="button"
              className="btn-secondary mt-4 self-start"
              onClick={() => void generate(kind.id)}
              disabled={busy !== null}
            >
              {busy === kind.id ? 'Generating' : 'Generate'}
            </button>
          </article>
        ))}
      </div>

      <SectionHead title="Generated" />
      {reports.length === 0 ? (
        <Empty title="Nothing generated yet." />
      ) : (
        <div className="panel divide-y divide-line">
          {reports.map((report) => (
            <div key={report.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-base font-medium text-ink">
                  {KINDS.find((k) => k.id === report.kind)?.label ?? report.kind}
                </p>
                <p className="font-mono text-micro uppercase text-ink-3">
                  performance year {report.periodLabel} · {dateLabel(report.generatedAt)}
                </p>
              </div>
              {report.status === 'ready' ? (
                <button type="button" className="btn-secondary btn-sm" onClick={() => void open(report)}>
                  {preview?.id === report.id ? 'Showing' : 'Open'}
                </button>
              ) : (
                <span className="chip-inert">{report.status}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <section className="panel mt-5 overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="font-display text-h3 text-ink">Preview</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPreview(null)}>
              Close
            </button>
          </header>
          {/* Rendered in an iframe rather than offered as a download: a viewer
              embedding the portal may block downloads, and print-to-PDF from
              here works the same way. */}
          <iframe
            title="Report preview"
            srcDoc={preview.html}
            className="h-[38rem] w-full border-0 bg-white"
            sandbox=""
          />
        </section>
      )}
    </div>
  )
}
