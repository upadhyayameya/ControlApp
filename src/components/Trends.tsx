// ---------------------------------------------------------------------------
// Multi-point trend charts, exactly like reading BAS trend data. Any logged
// point can be overlaid on a shared time axis; ranges span the last hour to
// the whole run; and the whole selection exports to CSV for Excel analysis.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useStore } from '../state/store'
import type { SystemConfig, TrendSample } from '../types/domain'

const RANGES: { label: string; minutes: number }[] = [
  { label: '1h', minutes: 60 },
  { label: '1d', minutes: 1440 },
  { label: '1w', minutes: 10080 },
  { label: '1mo', minutes: 43200 },
  { label: 'All', minutes: Infinity },
]

const SERIES_COLORS = ['#5bb98c', '#3b9ed6', '#e0b23a', '#d64545', '#b56a33', '#9b8bd6', '#7c8aa5', '#e07a9c']

export function Trends() {
  const trends = useStore((s) => s.trends)
  const config = useStore((s) => s.config)
  const [range, setRange] = useState(1440)
  const [selected, setSelected] = useState<string[]>(() => defaultSelection(config))

  const keys = useMemo(() => collectKeys(trends), [trends])
  const nowMin = trends.length ? trends[trends.length - 1].minute : 0

  const data = useMemo(() => {
    const from = nowMin - range
    return trends
      .filter((t) => t.minute >= from)
      .map((t) => {
        const row: Record<string, number> = { minute: t.minute }
        for (const k of selected) if (t.values[k] !== undefined) row[k] = round2(t.values[k])
        return row
      })
  }, [trends, range, selected, nowMin])

  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  const exportCsv = () => {
    const cols = ['minute', 'day', 'time', ...selected]
    const lines = [cols.join(',')]
    const from = nowMin - range
    for (const t of trends) {
      if (t.minute < from) continue
      const day = Math.floor(t.minute / 1440) + 1
      const time = `${pad(Math.floor((t.minute % 1440) / 60))}:${pad(t.minute % 60)}`
      const row = [t.minute, day, time, ...selected.map((k) => (t.values[k] !== undefined ? round2(t.values[k]) : ''))]
      lines.push(row.join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trend_export_day${Math.floor(nowMin / 1440) + 1}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-forest-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-forest-300">Trends</span>
        <div className="flex gap-0.5 rounded bg-panel-800 p-0.5 border border-forest-800">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.minutes)}
              className={`readout rounded px-2 py-0.5 text-[10px] ${range === r.minutes ? 'bg-forest-500 text-cream-50' : 'text-forest-300 hover:bg-forest-700/50'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={exportCsv} className="readout ml-auto rounded bg-copper-500/20 border border-copper-500/40 px-2 py-0.5 text-[10px] text-copper-300 hover:bg-copper-500/30">
          ↧ Export CSV
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Point picker */}
        <div className="w-40 shrink-0 overflow-y-auto border-r border-forest-800 p-2">
          <div className="pb-1 text-[9px] uppercase tracking-wider text-forest-300/70">Points</div>
          {keys.map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[10.5px] text-cream-100/90">
              <input type="checkbox" checked={selected.includes(k)} onChange={() => toggle(k)} className="accent-forest-500" />
              <span className="inline-block h-2 w-2 rounded-sm shrink-0" style={{ background: selected.includes(k) ? SERIES_COLORS[selected.indexOf(k) % SERIES_COLORS.length] : '#3a4a3e' }} />
              <span className="truncate" title={labelForKey(k, config)}>{labelForKey(k, config)}</span>
            </label>
          ))}
        </div>

        {/* Chart */}
        <div className="min-w-0 flex-1 p-2">
          {data.length < 2 ? (
            <div className="flex h-full items-center justify-center text-[11px] text-forest-300">Press play to accumulate trend data.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#233029" strokeDasharray="3 3" />
                <XAxis dataKey="minute" tickFormatter={fmtTick} stroke="#7fa587" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis stroke="#7fa587" tick={{ fontSize: 10 }} width={40} />
                <Tooltip contentStyle={{ background: '#151d18', border: '1px solid #1c4227', fontSize: 11 }} labelFormatter={(m) => fmtFull(Number(m))} formatter={(v: number, n: string) => [v, labelForKey(n, config)]} />
                {selected.map((k, i) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}

function collectKeys(trends: TrendSample[]): string[] {
  const set = new Set<string>()
  for (const t of trends.slice(-20)) for (const k of Object.keys(t.values)) set.add(k)
  return [...set].sort()
}

function defaultSelection(config: SystemConfig): string[] {
  const zone = config.nodes.find((n) => n.category === 'zone')
  const out = ['weather.oatF', 'plant.chwSupplyF']
  if (zone) out.unshift(`${zone.id}.tempF`)
  return out
}

function labelForKey(key: string, config: SystemConfig): string {
  const [prefix, field] = key.split('.')
  const fieldLabel: Record<string, string> = {
    tempF: 'Temp °F',
    co2: 'CO₂',
    satF: 'SAT °F',
    oaPct: 'OA %',
    cfm: 'CFM',
    chwSupplyF: 'CHW Supply',
    hwSupplyF: 'HW Supply',
    cwSupplyF: 'CW Supply',
    oatF: 'OAT °F',
    sensedOatF: 'OAT (sensed)',
    kw: 'kW',
    costPerHr: '$/hr',
  }
  const fl = fieldLabel[field] ?? field
  if (prefix === 'plant' || prefix === 'weather' || prefix === 'building') return `${cap(prefix)} ${fl}`
  const node = config.nodes.find((n) => n.id === prefix)
  return `${node?.name ?? prefix} ${fl}`
}

function fmtTick(m: number): string {
  const day = Math.floor(m / 1440) + 1
  const h = Math.floor((m % 1440) / 60)
  return `D${day} ${pad(h)}:00`
}
function fmtFull(m: number): string {
  const day = Math.floor(m / 1440) + 1
  return `Day ${day} ${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
