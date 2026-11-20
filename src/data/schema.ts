// ---------------------------------------------------------------------------
// Per-category port templates and nameplate field schemas.
//
// `portsFor(category)` gives each freshly-dropped node its physical
// connection points. `nameplateSchema(category)` drives the inspector's
// editable nameplate table and supplies defaults for every field.
// ---------------------------------------------------------------------------

import type { EquipmentCategory, NameplateField, Port } from '../types/domain'

let portSeq = 0
const pid = () => `p${portSeq++}`

function port(
  label: string,
  kind: Port['kind'],
  medium: Port['medium'],
  direction: Port['direction'],
): Port {
  return { id: pid(), label, kind, medium, direction }
}

/**
 * Default ports for a category. IDs are regenerated per node at creation time
 * (see store.createNode) so two nodes never share a port id.
 */
export function portsFor(category: EquipmentCategory): Port[] {
  switch (category) {
    case 'chiller':
      return [
        port('CHW Supply', 'water', 'chw', 'out'),
        port('CHW Return', 'water', 'chw', 'in'),
        port('CW Supply', 'water', 'cw', 'out'),
        port('CW Return', 'water', 'cw', 'in'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'boiler':
      return [
        port('HW Supply', 'water', 'hw', 'out'),
        port('HW Return', 'water', 'hw', 'in'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'ahu':
    case 'rtu':
      return [
        port('Supply Air', 'air', 'sa', 'out'),
        port('Return Air', 'air', 'ra', 'in'),
        port('Outside Air', 'air', 'oa', 'in'),
        port('CHW Coil', 'water', 'chw', 'in'),
        port('HW Coil', 'water', 'hw', 'in'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'fcu':
      return [
        port('Supply Air', 'air', 'sa', 'out'),
        port('Return Air', 'air', 'ra', 'in'),
        port('CHW Coil', 'water', 'chw', 'in'),
        port('HW Coil', 'water', 'hw', 'in'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'wshp':
      return [
        port('Supply Air', 'air', 'sa', 'out'),
        port('Return Air', 'air', 'ra', 'in'),
        port('CW Supply', 'water', 'cw', 'in'),
        port('CW Return', 'water', 'cw', 'out'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'hx':
      return [
        port('Primary In', 'water', 'hw', 'in'),
        port('Primary Out', 'water', 'hw', 'out'),
        port('Secondary In', 'water', 'chw', 'in'),
        port('Secondary Out', 'water', 'chw', 'out'),
      ]
    case 'pump':
      return [
        port('Suction', 'water', 'chw', 'in'),
        port('Discharge', 'water', 'chw', 'out'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'coolingTower':
      return [
        port('CW Return (hot)', 'water', 'cw', 'in'),
        port('CW Supply (cold)', 'water', 'cw', 'out'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'vav':
      return [
        port('Inlet Air', 'air', 'sa', 'in'),
        port('Discharge Air', 'air', 'sa', 'out'),
        port('HW Reheat', 'water', 'hw', 'in'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
    case 'zone':
      return [port('Supply Air', 'air', 'sa', 'in'), port('Return Air', 'air', 'ra', 'out')]
    case 'sensor':
      return [port('Signal', 'electrical', 'elec', 'out')]
    case 'vfd':
      return [
        port('Line', 'electrical', 'elec', 'in'),
        port('Motor', 'electrical', 'elec', 'out'),
      ]
    case 'other':
      return [
        port('In A', 'water', 'chw', 'in'),
        port('Out A', 'water', 'chw', 'out'),
        port('Power', 'electrical', 'elec', 'in'),
      ]
  }
}

const F = (
  key: string,
  label: string,
  unit: string,
  def: number,
  step = 1,
): NameplateField => ({ key, label, unit, default: def, step })

export function nameplateSchema(category: EquipmentCategory): NameplateField[] {
  switch (category) {
    case 'chiller':
      return [
        F('tons', 'Capacity', 'tons', 200, 5),
        F('kw', 'Design Power', 'kW', 220, 5),
        F('eer', 'EER', 'Btu/W·h', 11.2, 0.1),
        F('iplv', 'IPLV', 'Btu/W·h', 16.5, 0.1),
        F('cop', 'COP', '', 3.2, 0.1),
        F('chwSupplyF', 'Design CHWST', '°F', 44, 1),
        F('chwDeltaT', 'Design ΔT', '°F', 10, 1),
        F('minTurndownPct', 'Min Turndown', '%', 15, 1),
      ]
    case 'boiler':
      return [
        F('mbh', 'Input', 'MBH', 2000, 50),
        F('effPct', 'Thermal Eff.', '%', 95, 1),
        F('hwSupplyF', 'Design HWST', '°F', 140, 1),
        F('hwDeltaT', 'Design ΔT', '°F', 20, 1),
        F('minTurndownPct', 'Min Turndown', '%', 20, 1),
        F('parasiticKw', 'Parasitic Power', 'kW', 1.5, 0.1),
      ]
    case 'ahu':
    case 'rtu':
      return [
        F('cfm', 'Design Airflow', 'CFM', 20000, 500),
        F('minOaPct', 'Min OA', '%', 15, 1),
        F('fanKw', 'Fan Power', 'kW', 18, 0.5),
        F('coolTons', 'Cooling Coil', 'tons', 55, 1),
        F('heatMbh', 'Heating Coil', 'MBH', 400, 10),
        F('satDesignF', 'Design SAT', '°F', 55, 1),
        F('minStaticInWc', 'Min Static SP', 'in wc', 0.5, 0.05),
      ]
    case 'fcu':
      return [
        F('cfm', 'Design Airflow', 'CFM', 800, 25),
        F('fanKw', 'Fan Power', 'kW', 0.5, 0.05),
        F('coolTons', 'Cooling Coil', 'tons', 2, 0.25),
        F('heatMbh', 'Heating Coil', 'MBH', 24, 1),
      ]
    case 'wshp':
      return [
        F('cfm', 'Design Airflow', 'CFM', 1200, 25),
        F('coolTons', 'Capacity', 'tons', 3, 0.25),
        F('eer', 'EER', 'Btu/W·h', 14, 0.1),
        F('cop', 'Heating COP', '', 4.2, 0.1),
        F('compKw', 'Compressor Power', 'kW', 2.4, 0.1),
      ]
    case 'hx':
      return [
        F('mbh', 'Capacity', 'MBH', 1500, 50),
        F('approachF', 'Approach', '°F', 3, 0.5),
        F('gpm', 'Design Flow', 'GPM', 150, 5),
      ]
    case 'pump':
      return [
        F('gpm', 'Design Flow', 'GPM', 500, 10),
        F('headFt', 'Design Head', 'ft', 60, 1),
        F('hp', 'Motor', 'HP', 15, 0.5),
        F('effPct', 'Pump Eff.', '%', 78, 1),
      ]
    case 'coolingTower':
      return [
        F('tons', 'Capacity', 'tons', 250, 5),
        F('gpm', 'Design Flow', 'GPM', 750, 10),
        F('fanHp', 'Fan Motor', 'HP', 25, 1),
        F('approachF', 'Design Approach', '°F', 5, 0.5),
        F('rangeF', 'Design Range', '°F', 10, 0.5),
      ]
    case 'vav':
      return [
        F('maxCfm', 'Max Airflow', 'CFM', 1200, 25),
        F('minCfm', 'Min Airflow', 'CFM', 300, 25),
        F('reheatMbh', 'Reheat Coil', 'MBH', 20, 1),
      ]
    case 'zone':
      return [
        F('areaSqft', 'Floor Area', 'ft²', 2500, 50),
        F('capacitanceBtuF', 'Thermal Mass', 'Btu/°F', 9000, 250),
        F('envelopeUA', 'Envelope UA', 'Btu/h·°F', 380, 10),
        F('designOccupants', 'Design Occupancy', 'people', 20, 1),
        F('lightingWsf', 'Lighting', 'W/ft²', 0.9, 0.1),
        F('plugWsf', 'Plug Load', 'W/ft²', 1.2, 0.1),
      ]
    case 'sensor':
      return [F('driftF', 'Calibration Offset', '°F', 0, 0.5)]
    case 'vfd':
      return [
        F('hp', 'Rated Motor', 'HP', 15, 0.5),
        F('minSpeedPct', 'Min Speed', '%', 20, 1),
      ]
    case 'other':
      return [
        F('kw', 'Electrical Power', 'kW', 5, 0.5),
        F('mbh', 'Thermal Capacity', 'MBH', 0, 10),
      ]
  }
}

/** Build a full default nameplate object from a category's schema. */
export function defaultNameplate(category: EquipmentCategory): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of nameplateSchema(category)) out[f.key] = f.default
  return out
}

export const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  chiller: 'Chiller',
  boiler: 'Boiler',
  ahu: 'Air Handling Unit',
  rtu: 'Rooftop Unit',
  fcu: 'Fan Coil Unit',
  wshp: 'Water-Source Heat Pump',
  hx: 'Heat Exchanger',
  pump: 'Pump',
  coolingTower: 'Cooling Tower',
  vav: 'VAV Box',
  zone: 'Zone',
  sensor: 'Sensor',
  vfd: 'VFD',
  other: 'Other / Generic',
}
