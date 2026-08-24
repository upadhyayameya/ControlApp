import { useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { useStore, MEASUREMENT_FIELDS, type Measurement } from '../state/store'
import { todayISO, prettyDate } from '../lib/date'
import { Card, Empty } from './ui'

export default function MeasurementsPage() {
  const { measurements, logMeasurement, removeMeasurement } = useStore()
  const [date, setDate] = useState(todayISO())
  const [draft, setDraft] = useState<Record<string, string>>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const m: Measurement = { date }
    let any = false
    for (const f of MEASUREMENT_FIELDS) {
      const v = Number(draft[f.key])
      if (Number.isFinite(v) && v > 0) {
        m[f.key] = v
        any = true
      }
    }
    if (any) {
      logMeasurement(m)
      setDraft({})
    }
  }

  const series = measurements.map((m) => ({ ...m, label: prettyDate(m.date) }))
  const first = measurements[0]
  const last = measurements[measurements.length - 1]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Sizes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Measure once a fortnight, first thing, same tape, same spots. When the scale stalls, the
          tape usually has not — that is when this page saves your motivation.
        </p>
      </div>

      {first && last && first !== last && (
        <Card title="Since you started" sub={`${prettyDate(first.date)} → ${prettyDate(last.date)}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MEASUREMENT_FIELDS.map((f) => {
              const a = first[f.key]
              const b = last[f.key]
              if (a === undefined || b === undefined) return null
              const d = b - a
              return (
                <div key={f.key} className="rounded-lg bg-ink px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{f.label}</div>
                  <div className="text-sm font-semibold tabular-nums text-slate-200">
                    {b.toFixed(1)} cm{' '}
                    <span className={d < 0 ? 'text-good' : d > 0 ? 'text-warn' : 'text-slate-600'}>
                      ({d > 0 ? '+' : ''}
                      {d.toFixed(1)})
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card title="New measurement">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor="m-date">
              Date
            </label>
            <input
              id="m-date"
              className="field"
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {MEASUREMENT_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label" htmlFor={`m-${f.key}`}>
                  {f.label} (cm)
                </label>
                <input
                  id={`m-${f.key}`}
                  className="field"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  placeholder="—"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
                <p className="mt-1 text-[11px] leading-snug text-slate-600">{f.hint}</p>
              </div>
            ))}
          </div>
          <button className="btn-primary" type="submit">
            Save measurement
          </button>
        </form>
      </Card>

      {series.length >= 2 && (
        <Card title="Waist and chest over time" sub="Waist down, chest holding — that is recomposition.">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#232c38" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #232c38', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line type="monotone" dataKey="waist" name="Waist" stroke="#f97316" strokeWidth={2.5} connectNulls dot={{ r: 2 }} />
                <Line type="monotone" dataKey="chest" name="Chest" stroke="#3b82f6" strokeWidth={2} connectNulls dot={{ r: 2 }} />
                <Line type="monotone" dataKey="arm" name="Arm" stroke="#22c55e" strokeWidth={2} connectNulls dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card title="History">
        {measurements.length === 0 ? (
          <Empty>No measurements yet. Take a baseline today — you cannot get it back later.</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-ink-line text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  {MEASUREMENT_FIELDS.map((f) => (
                    <th key={f.key} className="py-2 pr-3 font-medium">
                      {f.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {[...measurements].reverse().map((m) => (
                  <tr key={m.date}>
                    <td className="py-2 pr-3 text-slate-400">{prettyDate(m.date)}</td>
                    {MEASUREMENT_FIELDS.map((f) => (
                      <td key={f.key} className="py-2 pr-3 tabular-nums text-slate-200">
                        {m[f.key]?.toFixed(1) ?? '—'}
                      </td>
                    ))}
                    <td className="py-2 text-right">
                      <button
                        className="text-xs text-slate-600 hover:text-bad"
                        onClick={() => removeMeasurement(m.date)}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
