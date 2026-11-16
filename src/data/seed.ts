// ---------------------------------------------------------------------------
// A ready-to-run demonstration building: a two-chiller air-cooled plant, a
// condensing boiler, primary pumps, one air handler feeding three VAV-with-
// reheat boxes into three zones, and an outside-air temperature sensor. This
// is what the app opens with so the trainee sees a live system immediately.
// ---------------------------------------------------------------------------

import type { BuildingConfig, Connection, EquipmentNode, SystemConfig } from '../types/domain'
import { connect, createNode, resetNameCounters, uid } from './factory'

const portByLabel = (node: EquipmentNode, label: string) =>
  node.ports.find((p) => p.label === label)!.id

export function buildSeedSystem(): SystemConfig {
  resetNameCounters()
  const nodes: EquipmentNode[] = []
  const connections: Connection[] = []
  const add = (n: EquipmentNode) => (nodes.push(n), n)
  const wire = (s: EquipmentNode, sp: string, t: EquipmentNode, tp: string) => {
    const c = connect(s, portByLabel(s, sp), t, portByLabel(t, tp))
    if (c) connections.push(c)
  }

  // --- Plant ---------------------------------------------------------------
  const ch1 = add(createNode('chiller', { catalogId: 'trane-rtac-200', position: { x: 40, y: 40 } }))
  const ch2 = add(createNode('chiller', { catalogId: 'trane-rtac-200', position: { x: 40, y: 200 } }))
  ch2.sequences.staging!.order = 1
  const chwPump = add(createNode('pump', { catalogId: 'bg-e1510-chw', name: 'CHW-P-1', position: { x: 300, y: 120 } }))
  const boiler = add(createNode('boiler', { catalogId: 'aerco-benchmark-3000', position: { x: 40, y: 360 } }))
  const hwPump = add(createNode('pump', { catalogId: 'grundfos-cr64-hw', name: 'HW-P-1', position: { x: 300, y: 360 } }))

  // --- Air handler ---------------------------------------------------------
  const ahu = add(createNode('ahu', { catalogId: 'trane-cscf-20', position: { x: 560, y: 200 } }))

  // --- Terminals + zones ---------------------------------------------------
  const zoneDefs = [
    { name: 'VAV-1', zone: 'Zone 1 — North', y: 40, area: 2800, occ: 18 },
    { name: 'VAV-2', zone: 'Zone 2 — Core', y: 220, area: 3400, occ: 24 },
    { name: 'VAV-3', zone: 'Zone 3 — South', y: 400, area: 2600, occ: 16 },
  ]
  for (const zd of zoneDefs) {
    // Size the terminal at ~1 CFM/ft² so the seed system is balanced: healthy
    // at baseline, so an injected fault clearly stands out.
    const maxCfm = Math.round(zd.area * 1.1)
    const vav = add(
      createNode('vav', {
        catalogId: 'titus-dtqs-08-reheat',
        name: zd.name,
        position: { x: 820, y: zd.y },
        nameplate: { maxCfm, minCfm: Math.round(maxCfm * 0.3), reheatMbh: Math.round(zd.area * 0.012) },
      }),
    )
    const zone = add(
      createNode('zone', {
        name: zd.zone,
        position: { x: 1080, y: zd.y },
        nameplate: { areaSqft: zd.area, designOccupants: zd.occ, capacitanceBtuF: zd.area * 3.6, envelopeUA: zd.area * 0.16 },
        areaSqft: zd.area,
      }),
    )
    wire(ahu, 'Supply Air', vav, 'Inlet Air')
    wire(vav, 'Discharge Air', zone, 'Supply Air')
    wire(hwPump, 'Discharge', vav, 'HW Reheat')
  }

  // --- Sensor --------------------------------------------------------------
  add(createNode('sensor', { name: 'OAT Sensor', sensorMeasure: 'temp', position: { x: 560, y: 40 } }))

  // --- Loop wiring ---------------------------------------------------------
  wire(ch1, 'CHW Supply', chwPump, 'Suction')
  wire(chwPump, 'Discharge', ahu, 'CHW Coil')
  wire(ch2, 'CHW Supply', chwPump, 'Suction')
  wire(boiler, 'HW Supply', hwPump, 'Suction')
  wire(hwPump, 'Discharge', ahu, 'HW Coil')

  const building: BuildingConfig = {
    city: 'St. Louis, MO',
    weather: {
      mode: 'sine',
      meanOatF: 57,
      dailyAmplitudeF: 14,
      seasonalAmplitudeF: 26,
      meanRhPct: 55,
    },
    electricRatePerKwh: 0.12,
    gasRatePerTherm: 1.1,
    totalAreaSqft: zoneDefs.reduce((s, z) => s + z.area, 0),
  }

  return {
    id: uid('sys'),
    name: 'Demo Building — 1 AHU / 3 VAV',
    nodes,
    connections,
    building,
    faults: [],
    version: 1,
  }
}
