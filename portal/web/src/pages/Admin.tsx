// ---------------------------------------------------------------------------
// HBS staff console: pick an organization, pull from Portfolio Manager, run
// the monitor. Customers never see this route — the API refuses every call on
// it for a non-staff session, so hiding the nav link is presentation, not
// security.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import type { SyncStatusResponse } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { dateLabel, int } from '../lib/format'
import { ErrorNote, SectionHeading, Spinner, Tile } from '../components/primitives'

export function Admin(): JSX.Element {
  const { organizations, viewingOrganizationId, setViewingOrganization, loadPortfolio } = usePortal()
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .syncStatus()
      .then(setStatus)
      .catch((err: unknown) => setError(messageFor(err)))
  }, [])

  async function pull(): Promise<void> {
    if (!viewingOrganizationId) {
      setError('Choose an organization to pull into first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.pull(viewingOrganizationId)
      setNotice(
        `Pulled ${result.processed} propert${result.processed === 1 ? 'y' : 'ies'}` +
          (result.failed > 0 ? `, ${result.failed} failed: ${result.messages[0] ?? ''}` : '.'),
      )
      await loadPortfolio()
      setStatus(await api.syncStatus())
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  async function monitor(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.runMonitor(viewingOrganizationId ?? undefined)
      setNotice(`Monitor: ${result.created} new alert(s), ${result.updated} updated.`)
      await loadPortfolio()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-forest-900">Staff console</h1>
      {error && <ErrorNote message={error} />}
      {notice && (
        <div className="rounded-md border border-forest-200 bg-forest-50 px-3 py-2 text-sm text-forest-700">
          {notice}
        </div>
      )}

      <div className="card card-pad">
        <SectionHeading title="Organization" />
        <select
          className="input max-w-sm"
          value={viewingOrganizationId ?? ''}
          onChange={(e) => void setViewingOrganization(e.target.value || null)}
        >
          <option value="">All organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name} ({org.tier})
            </option>
          ))}
        </select>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary" onClick={() => void pull()} disabled={busy}>
            Pull from Portfolio Manager
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void monitor()}
            disabled={busy}
          >
            Run anomaly monitor
          </button>
        </div>
      </div>

      {status === null ? (
        <Spinner label="Loading sync status…" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label="Last pull" value={dateLabel(status.lastPullAt)} />
            <Tile
              label="Awaiting push"
              value={int(status.pendingPushes)}
              tone={status.pendingPushes > 0 ? 'warning' : 'default'}
            />
            <Tile
              label="Rejected by ESPM"
              value={int(status.failedPushes)}
              tone={status.failedPushes > 0 ? 'danger' : 'default'}
            />
          </div>

          <div>
            <SectionHeading title="Recent sync runs" />
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-forest-700/80">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Started</th>
                    <th className="px-4 py-2 font-semibold">Direction</th>
                    <th className="px-4 py-2 font-semibold">Scope</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 text-right font-semibold">Done</th>
                    <th className="px-4 py-2 text-right font-semibold">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-200">
                  {status.runs.map((run) => (
                    <tr key={run.id}>
                      <td className="px-4 py-2">{dateLabel(run.startedAt)}</td>
                      <td className="px-4 py-2">{run.direction}</td>
                      <td className="px-4 py-2 text-forest-800/70">{run.scope}</td>
                      <td className="px-4 py-2">{run.status}</td>
                      <td className="tabular px-4 py-2 text-right">{run.itemsProcessed}</td>
                      <td className="tabular px-4 py-2 text-right">{run.itemsFailed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {status.runs.length === 0 && (
                <p className="p-6 text-center text-sm text-forest-800/60">No sync runs yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
