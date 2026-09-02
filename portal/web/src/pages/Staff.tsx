// ---------------------------------------------------------------------------
// The HBS staff console: pick a tenant, pull from Portfolio Manager, run the
// monitor.
//
// Customers never see this route — and the API refuses every call on it for a
// non-staff session, so hiding the nav link is presentation, not security.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import type { SyncStatusResponse } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { dateLabel, int } from '../lib/format'
import {
  Empty,
  ErrorNote,
  Notice,
  PageHead,
  Reading,
  SectionHead,
  Spinner,
} from '../components/primitives'

export function Staff(): JSX.Element {
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
    <div>
      <PageHead eyebrow="HBS" title="Staff console" detail="Every tenant, and the sync behind them." />

      <div className="space-y-5">
        {error && <ErrorNote message={error} />}
        {notice && <Notice message={notice} />}

        <section className="panel panel-pad">
          <SectionHead title="Tenant" />
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem]">
              <label className="field-label" htmlFor="org">
                Organization
              </label>
              <select
                id="org"
                className="field"
                value={viewingOrganizationId ?? ''}
                onChange={(e) => void setViewingOrganization(e.target.value || null)}
              >
                <option value="">All organizations</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} · {org.tier}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-primary" onClick={() => void pull()} disabled={busy}>
              Pull from Portfolio Manager
            </button>
            <button type="button" className="btn-secondary" onClick={() => void monitor()} disabled={busy}>
              Run monitor
            </button>
          </div>
        </section>

        {status === null ? (
          <Spinner label="Loading sync status" />
        ) : (
          <>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
              <Reading label="Last pull" value={dateLabel(status.lastPullAt)} />
              <Reading
                label="Awaiting push"
                value={int(status.pendingPushes)}
                tone={status.pendingPushes > 0 ? 'warn' : 'default'}
              />
              <Reading
                label="Rejected by ESPM"
                value={int(status.failedPushes)}
                tone={status.failedPushes > 0 ? 'bad' : 'default'}
              />
            </div>

            <section>
              <SectionHead title="Recent sync runs" />
              {status.runs.length === 0 ? (
                <Empty title="No sync runs yet." />
              ) : (
                <div className="panel overflow-x-auto">
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Direction</th>
                        <th>Scope</th>
                        <th>Status</th>
                        <th className="text-right">Done</th>
                        <th className="text-right">Failed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.runs.map((run) => (
                        <tr key={run.id}>
                          <td className="measure whitespace-nowrap text-tiny text-ink-3">
                            {dateLabel(run.startedAt)}
                          </td>
                          <td className="text-base text-ink">{run.direction}</td>
                          <td className="measure text-tiny text-ink-2">{run.scope}</td>
                          <td>
                            <span
                              className={
                                run.status === 'success'
                                  ? 'chip-good'
                                  : run.status === 'failed'
                                    ? 'chip-bad'
                                    : 'chip-warn'
                              }
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="measure text-right text-ink">{run.itemsProcessed}</td>
                          <td className="measure text-right text-ink">{run.itemsFailed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
