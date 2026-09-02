// ---------------------------------------------------------------------------
// Entering new data and pushing it back to Portfolio Manager.
//
// The design problem here is trust: the customer is typing a number that will
// land in a regulated benchmarking record. So the UI never hides the round
// trip — each row shows exactly where it is (only here / sent / rejected), a
// rejection shows Portfolio Manager's own words, and a rejected row stays
// editable so a correction is one retry rather than a support ticket.
// ---------------------------------------------------------------------------

import { useMemo, useState, type FormEvent } from 'react'
import type { BuildingDetailResponse, ConsumptionEntry, SyncState } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor } from '../state/store'
import { dateLabel, int, usd } from '../lib/format'
import { EmptyState, ErrorNote, SectionHeading } from './primitives'

export function DataEntry({
  detail,
  onChanged,
}: {
  detail: BuildingDetailResponse
  onChanged: () => void
}): JSX.Element {
  const { building, meters, recentEntries } = detail
  const [meterId, setMeterId] = useState(meters[0]?.id ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [quantity, setQuantity] = useState('')
  const [cost, setCost] = useState('')
  const [estimated, setEstimated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedMeter = useMemo(
    () => meters.find((m) => m.id === meterId) ?? null,
    [meters, meterId],
  )

  const meterNames = useMemo(
    () => new Map(meters.map((m) => [m.id, m.name])),
    [meters],
  )

  const pending = recentEntries.filter(
    (e) => e.syncState === 'local' || e.syncState === 'failed' || e.syncState === 'pending',
  )

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const result = await api.addConsumption(building.id, {
        meterId,
        startDate,
        endDate,
        quantity: Number(quantity),
        cost: cost === '' ? null : Number(cost),
        estimated,
      })
      setNotice(result.message)
      setQuantity('')
      setCost('')
      onChanged()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  async function retryAll(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await api.push(building.id)
      setNotice(
        result.failed === 0
          ? `Sent ${result.processed} entr${result.processed === 1 ? 'y' : 'ies'} to Portfolio Manager.`
          : `${result.processed} sent, ${result.failed} still failing. ${result.messages[0] ?? ''}`,
      )
      onChanged()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  if (meters.length === 0) {
    return (
      <EmptyState
        title="No meters on this building yet."
        detail="Meters appear once the property is synced from Portfolio Manager."
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="space-y-4">
        <form onSubmit={submit} className="card card-pad space-y-3">
          <SectionHeading title="Add a meter reading" />
          {error && <ErrorNote message={error} />}
          {notice && (
            <div className="rounded-md border border-forest-200 bg-forest-50 px-3 py-2 text-sm text-forest-700">
              {notice}
            </div>
          )}

          <div>
            <label className="label" htmlFor="meter">
              Meter
            </label>
            <select
              id="meter"
              className="input mt-1"
              value={meterId}
              onChange={(e) => setMeterId(e.target.value)}
              required
            >
              {meters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.type})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="start">
                Period start
              </label>
              <input
                id="start"
                type="date"
                className="input mt-1"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="end">
                Period end
              </label>
              <input
                id="end"
                type="date"
                className="input mt-1"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="quantity">
              Usage {selectedMeter && <span className="normal-case">({selectedMeter.unit})</span>}
            </label>
            <input
              id="quantity"
              type="number"
              step="any"
              min="0"
              className="input mt-1 tabular"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="cost">
              Cost (optional)
            </label>
            <input
              id="cost"
              type="number"
              step="any"
              min="0"
              className="input mt-1 tabular"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-forest-800">
            <input
              type="checkbox"
              checked={estimated}
              onChange={(e) => setEstimated(e.target.checked)}
              className="rounded border-cream-300"
            />
            This reading is estimated
          </label>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Save and send to Portfolio Manager'}
          </button>
          <p className="text-xs text-forest-800/60">
            Saved here first, then pushed. If Portfolio Manager rejects it the reading stays in the
            portal with the reason, so nothing is lost.
          </p>
        </form>

        {pending.length > 0 && (
          <div className="card card-pad">
            <SectionHeading
              title={`${pending.length} awaiting Portfolio Manager`}
              action={
                <button type="button" className="btn-secondary" onClick={retryAll} disabled={busy}>
                  Retry all
                </button>
              }
            />
            <ul className="space-y-2 text-sm">
              {pending.map((entry) => (
                <li key={entry.id} className="border-b border-cream-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular">
                      {entry.startDate} → {entry.endDate}
                    </span>
                    <SyncBadge state={entry.syncState} />
                  </div>
                  <p className="text-xs text-forest-800/50">
                    {meterNames.get(entry.meterId) ?? 'Unknown meter'}
                  </p>
                  {entry.syncError && (
                    <p className="mt-1 text-xs text-red-800">{entry.syncError}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-cream-200 bg-cream-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-forest-700">
            Recent readings
          </h2>
        </div>
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-forest-700/70">
              <tr>
                <th className="px-4 py-2 font-semibold">Period</th>
                <th className="px-4 py-2 font-semibold">Meter</th>
                <th className="px-4 py-2 text-right font-semibold">Usage</th>
                <th className="px-4 py-2 text-right font-semibold">Cost</th>
                <th className="px-4 py-2 font-semibold">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100">
              {recentEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="tabular px-4 py-2">
                    {entry.startDate} → {entry.endDate}
                    {entry.estimated && (
                      <span className="ml-1.5 text-xs text-copper-600">estimated</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-forest-800/70">
                    {meterNames.get(entry.meterId) ?? '—'}
                  </td>
                  <td className="tabular px-4 py-2 text-right">
                    {int(entry.quantity)}{' '}
                    <span className="text-xs text-forest-800/50">{entry.unit}</span>
                  </td>
                  <td className="tabular px-4 py-2 text-right text-forest-800/70">
                    {entry.cost === null ? '—' : usd(entry.cost)}
                  </td>
                  <td className="px-4 py-2">
                    <SyncBadge state={entry.syncState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentEntries.length === 0 && (
            <p className="p-6 text-center text-sm text-forest-800/60">No readings recorded yet.</p>
          )}
        </div>
        <div className="border-t border-cream-200 px-4 py-2 text-xs text-forest-800/50">
          Last synced {dateLabel(building.lastSyncedAt)}
        </div>
      </div>
    </div>
  )
}

/** The whole point of the two-way design is that this badge is never ambiguous. */
function SyncBadge({ state }: { state: SyncState }): JSX.Element {
  const config: Record<SyncState, { label: string; className: string }> = {
    remote: { label: 'From ESPM', className: 'bg-cream-100 text-forest-800/70' },
    synced: { label: 'Sent to ESPM', className: 'bg-forest-100 text-forest-700' },
    local: { label: 'Only here', className: 'bg-copper-100 text-copper-600' },
    pending: { label: 'Sending…', className: 'bg-copper-100 text-copper-600' },
    failed: { label: 'Rejected', className: 'bg-red-50 text-red-800' },
  }
  const { label, className } = config[state]
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
