// ---------------------------------------------------------------------------
// Energy dashboard: live kW / therms / running cost, a by-system breakdown,
// cost per square foot, and a baseline-vs-modified comparison so the savings
// from a setpoint change are visible and quantified. Capture a baseline, make
// a change, and watch the delta.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useStore } from '../state/store'
import type { EquipmentCategory, SimSnapshot, SystemConfig, TrendSample } from '../types/domain'

export function EnergyDashboard() {
  const snapshot = useStore((s) => s.snapshot)
  const config = useStore((s) => s.config)
  const trends = useStore((s) => s.trends)
  const baseline = useStore((s) => s.baseline)
  const captureBaseline = useStore((s) => s.captureBaseline)
  const clearBaseline = useStore((s) => s.clearBaseline)
  const [label, setLabel] = useState('Baseline')

  if (!snapshot) return <div className="p-4 text-[11px] text-forest-300">Waiting for simulation…</div>

  const totals = snapshot.totals
  const area = config.building.totalAreaSqft || 1
  const annualCost = totals.costPerHr * 8760
  const groups = systemBreakdown(config, snapshot)

  const currentAvg = avgCost(trends, baseline ? baseline.atMinute : -1, true)
  const baseAvg = baseline ? avgCost(baseline.trends, -1, false) : null
  const savingsPct = baseAvg && baseAvg > 0 ? ((baseAvg - currentAvg) / baseAvg) * 100 : null

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Demand" value={`${totals.kw.toFixed(1)}`} unit="kW" />
        <Stat label="Gas" value={`${totals.thermsPerHr.toFixed(2)}`} unit="therm/h" />
        <Stat label="Running Cost" value={`$${totals.costPerHr.toFixed(2)}`} unit="/hr" accent />
        <Stat label="Cost / ft²·yr" value={`$${(annualCost / area).toFixed(2)}`} unit="" />
      </div>

      {/* By-system breakdown */}
      <div className="rounded border border-forest-800 bg-panel-800 p-2">
        <div className="pb-1.5 text-[10px] uppercase tracking-wider text-copper-300">By System</div>
        <div className="flex flex-col gap-1.5">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="flex items-center justify-between text-[11px] text-cream-100">
                <span>{g.name}</span>
                <span className="readout text-forest-300">
                  {g.kw.toFixed(1)} kW{g.therms > 0 ? ` · ${g.therms.toFixed(2)} th/h` : ''}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-panel-900">
                <div className="h-full rounded" style={{ width: `${g.pct}%`, background: g.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Baseline comparison */}
      <div className="rounded border border-forest-800 bg-panel-800 p-2">
        <div className="flex items-center justify-between pb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-copper-300">Baseline vs Modified</div>
          {baseline ? (
            <button onClick={clearBaseline} className="readout text-[10px] text-forest-300 hover:text-alarm-critical">clear</button>
          ) : null}
        </div>
        {!baseline ? (
          <div className="flex items-center gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="readout w-28 rounded bg-panel-900 border border-forest-800 px-1.5 py-0.5 text-[11px] text-cream-100" />
            <button
              onClick={() => captureBaseline(label)}
              disabled={trends.length < 5}
              className="readout rounded bg-forest-600 px-2 py-1 text-[11px] text-cream-50 hover:bg-forest-500 disabled:opacity-40"
            >
              Capture baseline
            </button>
            <span className="text-[10px] text-forest-300">Run a while, capture, then change a setpoint.</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Compare label={baseline.label} value={baseAvg} unit="$/hr" />
            <Compare label="Modified" value={currentAvg} unit="$/hr" />
            <div className="rounded bg-panel-900 p-1.5">
              <div className="text-[9px] uppercase tracking-wide text-forest-300">Savings</div>
              <div className={`readout text-lg font-bold ${savingsPct !== null && savingsPct >= 0 ? 'text-alarm-ok' : 'text-alarm-critical'}`}>
                {savingsPct === null ? '—' : `${savingsPct.toFixed(1)}%`}
              </div>
              {baseAvg !== null && (
                <div className="text-[9px] text-forest-300">${((baseAvg - currentAvg) * 8760).toFixed(0)}/yr</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className={`rounded border p-2 ${accent ? 'border-copper-500/40 bg-copper-500/10' : 'border-forest-800 bg-panel-800'}`}>
      <div className="text-[9px] uppercase tracking-wide text-forest-300">{label}</div>
      <div className="readout text-lg font-bold text-cream-100">
        {value}
        <span className="ml-1 text-[10px] font-normal text-forest-300">{unit}</span>
      </div>
    </div>
  )
}

function Compare({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="rounded bg-panel-900 p-1.5">
      <div className="text-[9px] uppercase tracking-wide text-forest-300 truncate">{label}</div>
      <div className="readout text-lg font-bold text-cream-100">{value === null ? '—' : value.toFixed(2)}</div>
      <div className="text-[9px] text-forest-300">{unit}</div>
    </div>
  )
}

interface Group {
  name: string
  kw: number
  therms: number
  pct: number
  color: string
}

function systemBreakdown(config: SystemConfig, snap: SimSnapshot): Group[] {
  const catOf: Record<string, EquipmentCategory> = {}
  for (const n of config.nodes) catOf[n.id] = n.category
  const buckets: Record<string, { kw: number; therms: number; color: string }> = {
    Cooling: { kw: 0, therms: 0, color: '#3b9ed6' },
    Heating: { kw: 0, therms: 0, color: '#d64545' },
    'Fans / Air': { kw: 0, therms: 0, color: '#5bb98c' },
    'Pumps / Aux': { kw: 0, therms: 0, color: '#b56a33' },
  }
  for (const [id, st] of Object.entries(snap.nodeStates)) {
    const cat = catOf[id]
    if (!cat) continue
    let bucket: keyof typeof buckets = 'Pumps / Aux'
    if (cat === 'chiller' || cat === 'coolingTower' || cat === 'wshp') bucket = 'Cooling'
    else if (cat === 'boiler') bucket = 'Heating'
    else if (cat === 'ahu' || cat === 'rtu' || cat === 'fcu') bucket = 'Fans / Air'
    else if (cat === 'pump') bucket = 'Pumps / Aux'
    buckets[bucket].kw += st.kw
    buckets[bucket].therms += st.therms * 60
  }
  const maxKw = Math.max(1, ...Object.values(buckets).map((b) => b.kw))
  return Object.entries(buckets).map(([name, b]) => ({ name, kw: b.kw, therms: b.therms, pct: (b.kw / maxKw) * 100, color: b.color }))
}

function avgCost(trends: TrendSample[], afterMinute: number, after: boolean): number {
  const rows = trends.filter((t) => (after ? t.minute > afterMinute : true))
  const vals = rows.map((t) => t.values['building.costPerHr']).filter((v) => v !== undefined)
  if (!vals.length) return 0
  return vals.reduce((s, v) => s + v, 0) / vals.length
}
