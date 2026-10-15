// ---------------------------------------------------------------------------
// The HBS staff console: pick a tenant, pull from Portfolio Manager, run the
// monitor.
//
// Customers never see this route — and the API refuses every call on it for a
// non-staff session, so hiding the nav link is presentation, not security.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StaffClientSummary, StaffOverviewResponse, SyncStatusResponse } from '@hbs/shared'
import { buildTree } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { dateLabel, int, usdCompact } from '../lib/format'
import { PortfolioTree } from '../components/PortfolioTree'
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
  const [overview, setOverview] = useState<StaffOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api.staffClients())
    } catch (err) {
      setError(messageFor(err))
    }
  }, [])

  useEffect(() => {
    api
      .syncStatus()
      .then(setStatus)
      .catch((err: unknown) => setError(messageFor(err)))
    void loadOverview()
  }, [loadOverview])

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
      await loadOverview()
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
      <PageHead
        eyebrow="HBS"
        title="Every client"
        detail="All portfolios across every account, and the Portfolio Manager sync behind them."
      />

      <div className="space-y-5">
        {error && <ErrorNote message={error} />}
        {notice && <Notice message={notice} />}

        {overview && (
          <>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-4">
              <Reading label="Clients" value={int(overview.clients.length)} />
              <Reading label="Buildings" value={int(overview.totals.buildings)} />
              <Reading
                label="Below standard"
                value={int(overview.totals.nonCompliant)}
                tone={overview.totals.nonCompliant > 0 ? 'bad' : 'default'}
              />
              <Reading
                label="Exposure"
                value={usdCompact(overview.totals.estimatedPenaltyExposure)}
                tone={overview.totals.estimatedPenaltyExposure > 0 ? 'bad' : 'default'}
                sub={overview.totals.exposureVerified ? 'across all clients' : 'provisional'}
              />
            </div>

            <section>
              <SectionHead
                title="Clients"
                detail="Largest exposure first — the question this screen exists to answer"
              />
              <div className="space-y-4">
                {overview.clients.map((client) => (
                  <ClientCard key={client.organization.id} client={client} />
                ))}
              </div>
            </section>
          </>
        )}

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

/**
 * One client, with their whole portfolio tree. Collapsed by default — a staff
 * member scanning ten accounts wants the roll-up first, and the buildings only
 * once they have picked one.
 */
function ClientCard({ client }: { client: StaffClientSummary }): JSX.Element {
  const [open, setOpen] = useState(false)
  const tree = buildTree(client.groups, client.entries)

  return (
    <article className="panel">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm font-display text-tiny font-bold text-white"
            style={{ background: client.profile.accentColor }}
          >
            {client.profile.logoMark ?? client.organization.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-h3 text-ink">{client.organization.name}</p>
            <p className="font-mono text-micro uppercase text-ink-3">
              {client.profile.tier} · {int(client.memberCount)}{' '}
              {client.memberCount === 1 ? 'person' : 'people'} ·{' '}
              {int(client.totals.buildings)}{' '}
              {client.totals.buildings === 1 ? 'building' : 'buildings'} ·{' '}
              <span
                className={
                  client.connectionStatus === 'connected'
                    ? 'text-good'
                    : client.connectionStatus === 'error'
                      ? 'text-bad'
                      : 'text-ink-3'
                }
              >
                ESPM {client.connectionStatus}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="eyebrow">Exposure</p>
            <p className="measure text-h3 font-medium text-bad">
              {client.totals.estimatedPenaltyExposure > 0
                ? usdCompact(client.totals.estimatedPenaltyExposure)
                : '—'}
            </p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide portfolios' : 'View portfolios'}
          </button>
        </div>
      </header>

      {open && (
        <div className="border-t border-line p-3">
          {tree.totals.buildings === 0 ? (
            <p className="px-1 py-2 text-base text-ink-3">
              No buildings synced for this client yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              {/* Read-only here: filing a customer's buildings is their
                  decision, and doing it on their behalf without a trail would
                  be invisible to them. */}
              <PortfolioTree tree={tree} manage={false} />
            </div>
          )}
        </div>
      )}
    </article>
  )
}
