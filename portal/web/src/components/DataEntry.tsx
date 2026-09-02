// ---------------------------------------------------------------------------
// Entering data, and pushing it back to Portfolio Manager.
//
// The design problem is trust: the customer is typing a number that lands in a
// regulated benchmarking record. So the round trip is never hidden — each row
// states exactly where it is, a rejection carries Portfolio Manager's own
// words, and a rejected row stays editable so a correction is one retry rather
// than a support ticket.
// ---------------------------------------------------------------------------

import { useMemo, useState, type FormEvent } from 'react'
import type { BuildingDetailResponse, SyncState } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor } from '../state/store'
import { dateLabel, int, usd } from '../lib/format'
import { Empty, ErrorNote, Notice, SectionHead } from './primitives'

const SYNC: Record<SyncState, { label: string; className: string }> = {
  remote: { label: 'From ESPM', className: 'chip-inert' },
  synced: { label: 'Sent to ESPM', className: 'chip-good' },
  local: { label: 'Only here', className: 'chip-warn' },
  pending: { label: 'Sending', className: 'chip-warn' },
  failed: { label: 'Rejected', className: 'chip-bad' },
}

function SyncChip({ state }: { state: SyncState }): JSX.Element {
  const { label, className } = SYNC[state]
  return <span className={className}>{label}</span>
}

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

  const selectedMeter = useMemo(() => meters.find((m) => m.id === meterId) ?? null, [meters, meterId])
  const meterNames = useMemo(() => new Map(meters.map((m) => [m.id, m.name])), [meters])

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
      <Empty
        title="No meters on this building yet."
        detail="Meters appear once the property is synced from Portfolio Manager."
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <div className="space-y-4">
        <form onSubmit={submit} className="panel panel-pad space-y-3.5">
          <SectionHead title="Add a reading" />
          {error && <ErrorNote message={error} />}
          {notice && <Notice message={notice} />}

          <div>
            <label className="field-label" htmlFor="meter">
              Meter
            </label>
            <select
              id="meter"
              className="field"
              value={meterId}
              onChange={(e) => setMeterId(e.target.value)}
              required
            >
              {meters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="start">
                Period start
              </label>
              <input
                id="start"
                type="date"
                className="field measure"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="end">
                Period end
              </label>
              <input
                id="end"
                type="date"
                className="field measure"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="quantity">
              Usage {selectedMeter && <span className="normal-case">· {selectedMeter.unit}</span>}
            </label>
            <input
              id="quantity"
              type="number"
              step="any"
              min="0"
              className="field measure"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="field-label" htmlFor="cost">
              Cost · optional
            </label>
            <input
              id="cost"
              type="number"
              step="any"
              min="0"
              className="field measure"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-base text-ink-2">
            <input
              type="checkbox"
              checked={estimated}
              onChange={(e) => setEstimated(e.target.checked)}
              className="rounded-sm border-line-strong"
            />
            This reading is estimated
          </label>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Sending' : 'Save and send to Portfolio Manager'}
          </button>
          <p className="text-tiny text-ink-3">
            Saved here first, then pushed. If Portfolio Manager rejects it, the reading stays in the
            portal with the reason — nothing is lost.
          </p>
        </form>

        {pending.length > 0 && (
          <div className="panel panel-pad">
            <SectionHead
              title={`${pending.length} awaiting ESPM`}
              action={
                <button type="button" className="btn-secondary btn-sm" onClick={retryAll} disabled={busy}>
                  Retry all
                </button>
              }
            />
            <ul className="divide-y divide-line border-t border-line">
              {pending.map((entry) => (
                <li key={entry.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="measure text-tiny text-ink">
                      {entry.startDate} → {entry.endDate}
                    </span>
                    <SyncChip state={entry.syncState} />
                  </div>
                  <p className="mt-0.5 text-tiny text-ink-3">
                    {meterNames.get(entry.meterId) ?? 'Unknown meter'}
                  </p>
                  {entry.syncError && <p className="mt-1 text-tiny text-bad">{entry.syncError}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="font-display text-h3 text-ink">Readings</h2>
          <span className="font-mono text-micro uppercase text-ink-3">
            synced {dateLabel(building.lastSyncedAt)}
          </span>
        </div>
        <div className="max-h-[34rem] overflow-y-auto">
          <table className="grid-table">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th>Period</th>
                <th>Meter</th>
                <th className="text-right">Usage</th>
                <th className="text-right">Cost</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {recentEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="measure whitespace-nowrap text-ink">
                    {entry.startDate} → {entry.endDate}
                    {entry.estimated && (
                      <span className="ml-1.5 font-mono text-micro uppercase text-warn">est</span>
                    )}
                  </td>
                  <td className="text-ink-2">{meterNames.get(entry.meterId) ?? '—'}</td>
                  <td className="measure whitespace-nowrap text-right text-ink">
                    {int(entry.quantity)}
                    <span className="ml-1 text-micro text-ink-3">{entry.unit}</span>
                  </td>
                  <td className="measure text-right text-ink-2">
                    {entry.cost === null ? '—' : usd(entry.cost)}
                  </td>
                  <td>
                    <SyncChip state={entry.syncState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentEntries.length === 0 && (
            <p className="p-6 text-center text-base text-ink-3">No readings recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
