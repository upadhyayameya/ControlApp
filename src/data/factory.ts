// ---------------------------------------------------------------------------
// Node/connection factories. One place that stamps out a fully-formed
// EquipmentNode (fresh port ids, default nameplate, default sequences) so the
// palette, the seed system, and load/save all agree on shape.
// ---------------------------------------------------------------------------

import type {
  Connection,
  EquipmentCategory,
  EquipmentNode,
  Port,
  PortKind,
  SensorMeasure,
} from '../types/domain'
import { catalogById } from './catalog'
import { defaultNameplate, portsFor, CATEGORY_LABELS } from './schema'
import { defaultSequences } from './sequences'

let counter = 1
export function uid(prefix = 'n'): string {
  return `${prefix}${(counter++).toString(36)}${Math.floor(performance.now() % 100000).toString(36)}`
}

function freshPorts(category: EquipmentCategory): Port[] {
  return portsFor(category).map((p) => ({ ...p, id: uid('p') }))
}

export interface CreateNodeOptions {
  catalogId?: string
  name?: string
  position?: { x: number; y: number }
  nameplate?: Record<string, number>
  sensorMeasure?: SensorMeasure
  areaSqft?: number
}

export function createNode(category: EquipmentCategory, opts: CreateNodeOptions = {}): EquipmentNode {
  const cat = opts.catalogId ? catalogById(opts.catalogId) : undefined
  const nameplate = { ...defaultNameplate(category), ...(cat?.nameplate ?? {}), ...(opts.nameplate ?? {}) }
  const id = uid(category)
  const name = opts.name ?? defaultName(category)
  return {
    id,
    category,
    name,
    manufacturer: cat?.manufacturer ?? (category === 'other' ? 'Custom' : 'Generic'),
    model: cat?.model ?? (category === 'other' ? 'Generic Block' : 'Custom'),
    variant: cat?.variant,
    catalogId: cat?.id,
    nameplate,
    ports: freshPorts(category),
    sequences: defaultSequences(category),
    position: opts.position ?? { x: 120, y: 120 },
    sensor: category === 'sensor' ? { measures: opts.sensorMeasure ?? 'temp' } : undefined,
    areaSqft: category === 'zone' ? nameplate.areaSqft : undefined,
  }
}

let nameCounters: Record<string, number> = {}
export function resetNameCounters() {
  nameCounters = {}
}
function defaultName(category: EquipmentCategory): string {
  const n = (nameCounters[category] = (nameCounters[category] ?? 0) + 1)
  const abbr: Partial<Record<EquipmentCategory, string>> = {
    chiller: 'CH',
    boiler: 'B',
    ahu: 'AHU',
    rtu: 'RTU',
    fcu: 'FCU',
    wshp: 'WSHP',
    hx: 'HX',
    pump: 'P',
    coolingTower: 'CT',
    vav: 'VAV',
    zone: 'ZN',
    sensor: 'S',
    vfd: 'VFD',
    other: 'GEN',
  }
  return `${abbr[category] ?? CATEGORY_LABELS[category]}-${n}`
}

export function connect(
  source: EquipmentNode,
  sourcePortId: string,
  target: EquipmentNode,
  targetPortId: string,
): Connection | null {
  const sp = source.ports.find((p) => p.id === sourcePortId)
  const tp = target.ports.find((p) => p.id === targetPortId)
  if (!sp || !tp) return null
  const kind: PortKind = sp.kind
  return {
    id: uid('c'),
    source: source.id,
    sourcePort: sourcePortId,
    target: target.id,
    targetPort: targetPortId,
    kind,
    medium: sp.medium,
  }
}
