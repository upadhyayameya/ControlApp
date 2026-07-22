// ---------------------------------------------------------------------------
// Instructor console — hidden fault injection. The instructor arms a fault
// against a piece of equipment; the trainee then has to find it using the
// trends, alarms, and the reasoning engine. (Single-screen for v1; the same
// fault list is what a future backend would push to remote trainee sessions.)
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useStore } from '../state/store'
import type { EquipmentNode, FaultKind } from '../types/domain'
import { CATEGORY_LABELS } from '../data/schema'

const FAULTS: { kind: FaultKind; label: string; blurb: string; targets: (n: EquipmentNode) => boolean; param?: { key: string; label: string; unit: string } }[] = [
  { kind: 'drifted-sensor', label: 'Drifted sensor', blurb: 'Sensor reads off by an offset — classic OAT drift that fools resets.', targets: (n) => n.category === 'sensor', param: { key: 'driftF', label: 'Drift', unit: '°F' } },
  { kind: 'stuck-damper', label: 'Stuck OA damper', blurb: 'Outside-air damper frozen at a position; kills economizer or over-ventilates.', targets: (n) => n.category === 'ahu' || n.category === 'rtu', param: { key: 'stuckPct', label: 'Stuck at', unit: '%' } },
  { kind: 'leaking-valve', label: 'Leaking coil valve', blurb: 'Cooling valve leaks by even when commanded shut — chronic overcooling.', targets: (n) => n.category === 'ahu' || n.category === 'rtu', param: { key: 'leakPct', label: 'Leak', unit: '%' } },
  { kind: 'fouled-coil', label: 'Fouled coil', blurb: 'Coil approach widens; the AHU can no longer reach its SAT setpoint.', targets: (n) => n.category === 'ahu' || n.category === 'rtu', param: { key: 'foulPct', label: 'Fouling', unit: '%' } },
  { kind: 'failed-vfd', label: 'Failed VFD', blurb: 'Drive fails to full speed — no modulation, energy penalty.', targets: (n) => n.category === 'ahu' || n.category === 'pump' || n.category === 'rtu' },
  { kind: 'seized-actuator', label: 'Seized VAV actuator', blurb: 'VAV damper seized; the zone can’t modulate airflow.', targets: (n) => n.category === 'vav', param: { key: 'stuckPct', label: 'Stuck at', unit: '%' } },
  { kind: 'schedule-override', label: 'Forgotten override', blurb: 'Equipment left in a permanent occupied override — runs after hours.', targets: (n) => n.category === 'ahu' || n.category === 'rtu' || n.category === 'zone' || n.category === 'vav' },
]

export function InstructorPanel() {
  const config = useStore((s) => s.config)
  const addFault = useStore((s) => s.addFault)
  const toggleFault = useStore((s) => s.toggleFault)
  const deleteFault = useStore((s) => s.deleteFault)
  const updateFaultParams = useStore((s) => s.updateFaultParams)

  const [kind, setKind] = useState<FaultKind>('drifted-sensor')
  const def = FAULTS.find((f) => f.kind === kind)!
  const targets = config.nodes.filter(def.targets)
  const [targetId, setTargetId] = useState<string>(targets[0]?.id ?? '')
  const [paramVal, setParamVal] = useState<number>(-20)

  const currentTargets = config.nodes.filter(def.targets)

  const arm = () => {
    if (!targetId) return
    const params = def.param ? { [def.param.key]: paramVal } : {}
    addFault(kind, targetId, params, def.blurb)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-forest-800 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-copper-300">Instructor — Fault Injection</div>
        <div className="text-[10px] text-forest-300">Arm a hidden fault; have the trainee diagnose it.</div>
      </div>

      <div className="border-b border-forest-800 px-3 py-2">
        <label className="block pb-1 text-[10px] uppercase tracking-wider text-forest-300/70">Fault type</label>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as FaultKind
            setKind(k)
            const d = FAULTS.find((f) => f.kind === k)!
            const t = config.nodes.filter(d.targets)
            setTargetId(t[0]?.id ?? '')
          }}
          className="w-full rounded bg-panel-900 border border-forest-800 px-1.5 py-1 text-[11px] text-cream-100"
        >
          {FAULTS.map((f) => (
            <option key={f.kind} value={f.kind}>{f.label}</option>
          ))}
        </select>
        <div className="pt-1 text-[10px] leading-snug text-forest-300">{def.blurb}</div>

        <label className="mt-2 block pb-1 text-[10px] uppercase tracking-wider text-forest-300/70">Target</label>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full rounded bg-panel-900 border border-forest-800 px-1.5 py-1 text-[11px] text-cream-100">
          {currentTargets.length === 0 && <option value="">No eligible equipment</option>}
          {currentTargets.map((n) => (
            <option key={n.id} value={n.id}>{n.name} — {CATEGORY_LABELS[n.category]}</option>
          ))}
        </select>

        {def.param && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-forest-300">{def.param.label}</span>
            <input type="number" value={paramVal} onChange={(e) => setParamVal(parseFloat(e.target.value))} className="readout w-20 rounded bg-panel-900 border border-forest-800 px-1.5 py-0.5 text-right text-[11px] text-cream-100" />
            <span className="text-[10px] text-forest-300">{def.param.unit}</span>
          </div>
        )}

        <button onClick={arm} disabled={!targetId} className="mt-2 w-full rounded bg-alarm-critical/80 px-2 py-1 text-[11px] font-medium text-cream-50 hover:bg-alarm-critical disabled:opacity-40">
          Arm fault
        </button>
      </div>

      <div className="px-3 py-2">
        <div className="pb-1 text-[10px] uppercase tracking-wider text-forest-300/70">Armed faults ({config.faults.length})</div>
        {config.faults.length === 0 && <div className="text-[11px] text-forest-300">No faults armed.</div>}
        <div className="flex flex-col gap-1.5">
          {config.faults.map((f) => {
            const node = config.nodes.find((n) => n.id === f.targetNodeId)
            const meta = FAULTS.find((x) => x.kind === f.kind)
            return (
              <div key={f.id} className={`rounded border p-2 ${f.enabled ? 'border-alarm-critical/50 bg-alarm-critical/5' : 'border-forest-800 bg-panel-800'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-cream-100">{meta?.label ?? f.kind}</span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toggleFault(f.id, !f.enabled)} className={`readout rounded px-1.5 text-[10px] ${f.enabled ? 'bg-alarm-critical/30 text-alarm-critical' : 'bg-forest-700/40 text-forest-300'}`}>
                      {f.enabled ? 'ARMED' : 'off'}
                    </button>
                    <button onClick={() => deleteFault(f.id)} className="text-forest-300 hover:text-alarm-critical text-[11px]">✕</button>
                  </div>
                </div>
                <div className="text-[10px] text-forest-300">on {node?.name ?? '—'}</div>
                {meta?.param && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] text-forest-300">{meta.param.label}</span>
                    <input
                      type="number"
                      value={f.params[meta.param.key] ?? 0}
                      onChange={(e) => updateFaultParams(f.id, { [meta.param!.key]: parseFloat(e.target.value) })}
                      className="readout w-16 rounded bg-panel-900 border border-forest-800 px-1 py-0.5 text-right text-[10px] text-cream-100"
                    />
                    <span className="text-[10px] text-forest-300">{meta.param.unit}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
