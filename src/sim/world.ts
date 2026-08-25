// ---------------------------------------------------------------------------
// SimWorld — the mutable runtime state the engine advances one minute at a
// time, plus the topology index derived from the wired SystemConfig. Kept in
// its own module so both the stepper (model.ts) and the reasoning engine
// (reasoning.ts) can read it.
// ---------------------------------------------------------------------------

import type { Connection, EquipmentNode, Fault, SystemConfig } from '../types/domain'

export interface NodeTimer {
  running: boolean
  /** Sim-minute of the last on→off / off→on transition (for min on/off timers). */
  lastChangeMin: number
}

export interface TopologyIndex {
  byId: Record<string, EquipmentNode>
  zones: EquipmentNode[]
  ahus: EquipmentNode[] // includes RTUs
  vavs: EquipmentNode[]
  chillers: EquipmentNode[]
  boilers: EquipmentNode[]
  pumps: EquipmentNode[]
  towers: EquipmentNode[]
  wshps: EquipmentNode[]
  fcus: EquipmentNode[]
  sensors: EquipmentNode[]
  /** vavId → zoneId it discharges into (air connection). */
  vavZone: Record<string, string>
  /** vavId → ahuId feeding its inlet (air connection). */
  vavAhu: Record<string, string>
  /** ahuId → list of vavIds it serves. */
  ahuVavs: Record<string, string[]>
  /** ahuId → true if a CHW connection exists (on the chilled-water loop). */
  ahuOnChw: Record<string, boolean>
  ahuOnHw: Record<string, boolean>
  /** Designated OAT sensor node id, if any temp sensor is placed. */
  oatSensorId?: string
}

export interface SimWorld {
  config: SystemConfig
  minute: number
  zoneTemp: Record<string, number>
  zoneCo2: Record<string, number>
  timers: Record<string, NodeTimer>
  /** bankId → index offset applied for lead/lag rotation. */
  rotation: Record<string, number>
  loops: {
    chwSupplyF: number
    chwReturnF: number
    hwSupplyF: number
    hwReturnF: number
    cwSupplyF: number
    cwReturnF: number
  }
  index: TopologyIndex
}

const AHU_CATS = new Set(['ahu', 'rtu'])

export function buildIndex(config: SystemConfig): TopologyIndex {
  const byId: Record<string, EquipmentNode> = {}
  for (const n of config.nodes) byId[n.id] = n

  const pick = (pred: (n: EquipmentNode) => boolean) => config.nodes.filter(pred)
  const zones = pick((n) => n.category === 'zone')
  const ahus = pick((n) => AHU_CATS.has(n.category))
  const vavs = pick((n) => n.category === 'vav')
  const chillers = pick((n) => n.category === 'chiller')
  const boilers = pick((n) => n.category === 'boiler')
  const pumps = pick((n) => n.category === 'pump')
  const towers = pick((n) => n.category === 'coolingTower')
  const wshps = pick((n) => n.category === 'wshp')
  const fcus = pick((n) => n.category === 'fcu')
  const sensors = pick((n) => n.category === 'sensor')

  const portMedium = (nodeId: string, portId: string) =>
    byId[nodeId]?.ports.find((p) => p.id === portId)?.medium

  const vavZone: Record<string, string> = {}
  const vavAhu: Record<string, string> = {}
  const ahuVavs: Record<string, string[]> = {}
  const ahuOnChw: Record<string, boolean> = {}
  const ahuOnHw: Record<string, boolean> = {}

  const isAir = (c: Connection) => c.kind === 'air'

  for (const c of config.connections) {
    const src = byId[c.source]
    const tgt = byId[c.target]
    if (!src || !tgt) continue

    // VAV discharge → zone supply
    if (isAir(c) && src.category === 'vav' && tgt.category === 'zone') vavZone[src.id] = tgt.id
    if (isAir(c) && tgt.category === 'vav' && src.category === 'zone') vavZone[tgt.id] = src.id

    // AHU supply → VAV inlet
    if (isAir(c) && AHU_CATS.has(src.category) && tgt.category === 'vav') {
      vavAhu[tgt.id] = src.id
      ;(ahuVavs[src.id] ||= []).push(tgt.id)
    }
    if (isAir(c) && AHU_CATS.has(tgt.category) && src.category === 'vav') {
      vavAhu[src.id] = tgt.id
      ;(ahuVavs[tgt.id] ||= []).push(src.id)
    }

    // AHU on chilled/hot-water loop (any chw/hw connection to the AHU)
    for (const ahu of [src, tgt]) {
      if (!AHU_CATS.has(ahu.category)) continue
      const otherPort = ahu.id === c.source ? c.sourcePort : c.targetPort
      const med = portMedium(ahu.id, otherPort)
      if (med === 'chw') ahuOnChw[ahu.id] = true
      if (med === 'hw') ahuOnHw[ahu.id] = true
    }
  }

  // Fallback: an AHU with no explicit VAV wiring is assumed to serve every
  // unassigned VAV so a partially-wired system still simulates.
  if (ahus.length && vavs.length) {
    const unassigned = vavs.filter((v) => !vavAhu[v.id])
    if (unassigned.length && ahus.length) {
      const a = ahus[0]
      for (const v of unassigned) {
        vavAhu[v.id] = a.id
        ;(ahuVavs[a.id] ||= []).push(v.id)
      }
    }
  }

  const oatSensor = sensors.find((s) => s.sensor?.measures === 'temp' && /oat|outside|oa/i.test(s.name))
  const anyTempSensor = sensors.find((s) => s.sensor?.measures === 'temp')

  return {
    byId,
    zones,
    ahus,
    vavs,
    chillers,
    boilers,
    pumps,
    towers,
    wshps,
    fcus,
    sensors,
    vavZone,
    vavAhu,
    ahuVavs,
    ahuOnChw,
    ahuOnHw,
    oatSensorId: (oatSensor ?? anyTempSensor)?.id,
  }
}

export function createWorld(config: SystemConfig): SimWorld {
  const index = buildIndex(config)
  const zoneTemp: Record<string, number> = {}
  const zoneCo2: Record<string, number> = {}
  const timers: Record<string, NodeTimer> = {}
  for (const z of index.zones) {
    zoneTemp[z.id] = 72
    zoneCo2[z.id] = 480
  }
  for (const n of config.nodes) timers[n.id] = { running: false, lastChangeMin: 0 }

  return {
    config,
    minute: 0,
    zoneTemp,
    zoneCo2,
    timers,
    rotation: {},
    loops: {
      chwSupplyF: 44,
      chwReturnF: 54,
      hwSupplyF: 140,
      hwReturnF: 120,
      cwSupplyF: 75,
      cwReturnF: 85,
    },
    index,
  }
}

/** Active faults for a node, keyed by kind for quick lookup in the stepper. */
export function faultsForNode(config: SystemConfig, nodeId: string): Fault[] {
  return config.faults.filter((f) => f.enabled && f.targetNodeId === nodeId)
}
