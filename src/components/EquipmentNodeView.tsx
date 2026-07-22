// ---------------------------------------------------------------------------
// React Flow custom node: a piece of equipment drawn as a BAS-style block with
// port handles (colored by medium), a live value badge, and a spinning rotor
// when it's running. Reads its live state straight from the store snapshot.
// ---------------------------------------------------------------------------

import { Handle, NodeProps, Position } from 'reactflow'
import type { EquipmentNode } from '../types/domain'
import { useStore } from '../state/store'
import { CATEGORY_ICON, hasRotor, mediumColor } from './glyphs'

export interface NodeData {
  node: EquipmentNode
}

export function EquipmentNodeView({ id, data, selected }: NodeProps<NodeData>) {
  const node = data.node
  const state = useStore((s) => s.snapshot?.nodeStates[id])
  const zone = useStore((s) => s.snapshot?.zones.find((z) => z.nodeId === id))
  const alarms = useStore((s) => s.snapshot?.alarms.filter((a) => a.nodeId === id) ?? [])
  const running = !!state?.running || (node.category === 'zone' && !!zone?.occupied)

  const inputs = node.ports.filter((p) => p.direction === 'in')
  const outputs = node.ports.filter((p) => p.direction === 'out')
  const badge = node.category === 'zone' && zone
    ? `${zone.tempF.toFixed(1)}°F · ${zone.co2Ppm} ppm${zone.occupied ? ` · ${zone.occupants} occ` : ''}`
    : liveBadge(node, state)
  const hasAlarm = alarms.length > 0
  const critical = alarms.some((a) => a.severity === 'critical')

  return (
    <div
      className={`relative rounded-md border px-2 py-1.5 shadow-md min-w-[128px] text-[11px] transition-colors ${
        selected ? 'border-copper-400 ring-2 ring-copper-400/40' : 'border-forest-700'
      } ${running ? 'bg-panel-700' : 'bg-panel-800'}`}
      style={{ boxShadow: hasAlarm ? `0 0 0 2px ${critical ? '#e0533d' : '#e0a53a'}` : undefined }}
    >
      {/* Input handles on the left */}
      {inputs.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="target"
          position={p.kind === 'electrical' ? Position.Bottom : Position.Left}
          title={p.label}
          style={handleStyle(p.medium, p.kind === 'electrical' ? 'bottom' : 'left', i, inputs.length)}
        />
      ))}
      {/* Output handles on the right */}
      {outputs.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="source"
          position={p.kind === 'electrical' ? Position.Bottom : Position.Right}
          title={p.label}
          style={handleStyle(p.medium, p.kind === 'electrical' ? 'bottom' : 'right', i, outputs.length)}
        />
      ))}

      <div className="flex items-center gap-1.5">
        <span className={running && hasRotor(node.category) ? 'spin inline-block' : 'inline-block'}>
          {CATEGORY_ICON[node.category]}
        </span>
        <span className="font-semibold text-cream-100 truncate">{node.name}</span>
        <span className={`ml-auto h-2 w-2 rounded-full ${running ? 'bg-alarm-ok' : 'bg-gray-600'}`} title={running ? 'Running' : 'Off'} />
      </div>
      <div className="text-[9px] text-forest-300 truncate">{node.manufacturer} {node.model}</div>
      {badge && <div className="readout mt-0.5 text-copper-300 text-[10px]">{badge}</div>}
      {hasAlarm && <div className="text-[9px] text-alarm-warning mt-0.5">⚠ {alarms.length} alarm{alarms.length > 1 ? 's' : ''}</div>}
    </div>
  )
}

function handleStyle(medium: string, side: 'left' | 'right' | 'bottom', i: number, n: number): React.CSSProperties {
  const color = mediumColor(medium as never)
  if (side === 'bottom') {
    return { background: color, left: `${((i + 1) / (n + 1)) * 100}%`, bottom: -5 }
  }
  const top = `${((i + 1) / (n + 1)) * 100}%`
  return { background: color, top, [side]: -5 } as React.CSSProperties
}

function liveBadge(node: EquipmentNode, state?: { outputs: Record<string, number>; kw: number; running: boolean }): string {
  if (!state) return ''
  const o = state.outputs
  switch (node.category) {
    case 'chiller':
      return state.running ? `${fmt(o.loadTons)}t · ${fmt(state.kw)}kW · ${fmt(o.chwSupplyF)}°F` : 'off'
    case 'boiler':
      return state.running ? `${fmt(o.loadMbh)} MBH` : 'off'
    case 'ahu':
    case 'rtu':
      return state.running ? `SA ${fmt(o.satF)}°F · OA ${fmt(o.oaPct)}% · ${fmt(o.cfm)} cfm` : 'off'
    case 'pump':
      return state.running ? `${fmt(o.loadPct)}% · ${fmt(state.kw)}kW` : 'off'
    case 'coolingTower':
      return state.running ? `CW ${fmt(o.cwSupplyF)}°F · ${fmt(o.stagePct)}%` : 'off'
    case 'wshp':
    case 'fcu':
      return state.running ? `${fmt(o.loadPct)}% · ${fmt(state.kw)}kW` : 'off'
    default:
      return ''
  }
}

function fmt(v?: number): string {
  if (v === undefined) return '—'
  return (Math.round(v * 10) / 10).toString()
}
