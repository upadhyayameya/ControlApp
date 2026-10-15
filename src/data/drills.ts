// ---------------------------------------------------------------------------
// Training drills — one-click fault scenarios an instructor loads for a
// trainee to diagnose. Each drill starts from a fresh demo building, applies
// its sequence changes + hidden faults, and seeks the clock to a season where
// the fault actually bites. `symptom` is what the trainee is told; `answer` is
// the reveal for after they've worked it out.
// ---------------------------------------------------------------------------

import type { EquipmentNode, SystemConfig } from '../types/domain'

export interface Drill {
  id: string
  name: string
  season: string
  /** Trainee-facing complaint — the starting clue. */
  symptom: string
  /** The reveal: root cause + where to look. */
  answer: string
  /** Sim minute to seek to (afternoon of a representative day). */
  startMinute: number
  apply: (config: SystemConfig) => void
}

// Afternoon (15:00) of a given day-of-year; seasons chosen to land on weekdays.
const at = (dayIndex: number, hour = 15) => dayIndex * 1440 + hour * 60
const WINTER = 10 // mid-January, Thu
const SPRING = 105 // mid-April, Mon
const SUMMER = 197 // mid-July, Tue
const FALL = 289 // mid-October

export const SEASONS: { label: string; minute: number }[] = [
  { label: 'Winter', minute: at(WINTER) },
  { label: 'Spring', minute: at(SPRING) },
  { label: 'Summer', minute: at(SUMMER) },
  { label: 'Fall', minute: at(FALL) },
]

const find = (c: SystemConfig, pred: (n: EquipmentNode) => boolean) => c.nodes.filter(pred)
const oatSensor = (c: SystemConfig) => c.nodes.find((n) => n.category === 'sensor')
const ahu1 = (c: SystemConfig) => c.nodes.find((n) => n.category === 'ahu')

export const DRILLS: Drill[] = [
  {
    id: 'oat-drift',
    name: 'Warm chilled water on a hot day',
    season: 'Summer',
    symptom: 'Every hot afternoon the zones drift 3–5°F above their cooling setpoint, even though a chiller is running and the CHW valves are wide open.',
    answer:
      'The OAT sensor is reading ~25°F low. With CHW reset enabled and driven off that bad reading, the plant holds chilled water near 51°F instead of ~44°F, so the coil can never make its 55°F supply-air setpoint. Fix the OAT sensor calibration.',
    startMinute: at(SUMMER),
    apply: (c) => {
      for (const ch of find(c, (n) => n.category === 'chiller')) if (ch.sequences.chwReset) ch.sequences.chwReset.enabled = true
      const oat = oatSensor(c)
      const ahu = ahu1(c)
      if (oat) c.faults.push(fault('d1', 'drifted-sensor', oat.id, { driftF: -25 }))
      if (ahu) c.faults.push(fault('d2', 'fouled-coil', ahu.id, { foulPct: 45 }))
    },
  },
  {
    id: 'stuffy-zone',
    name: 'Stuffy core zone',
    season: 'Summer',
    symptom: 'Occupants in the core zone complain it feels stuffy by mid-afternoon, though the temperature is fine.',
    answer:
      'The outside-air damper is stuck near 8%, well below what design occupancy needs, and demand-controlled ventilation is disabled — so CO₂ climbs well past 1,100 ppm. Free the damper and/or enable DCV on the AHU.',
    startMinute: at(SUMMER),
    apply: (c) => {
      const ahu = ahu1(c)
      if (ahu) c.faults.push(fault('s1', 'stuck-damper', ahu.id, { stuckPct: 8 }))
    },
  },
  {
    id: 'failed-vfd',
    name: 'Fan runs flat out',
    season: 'Summer',
    symptom: 'No temperature or CO₂ alarm — but on the Energy tab, Fans/Air power is much higher than it should be all day, and static pressure won’t reset down at low airflow. (A good reminder that not every fault trips an alarm.)',
    answer:
      'The supply-fan VFD has failed to full speed, so it can’t modulate with the static-pressure reset. The fan draws its full design power regardless of load. Check the drive.',
    startMinute: at(SUMMER),
    apply: (c) => {
      const ahu = ahu1(c)
      if (ahu) {
        if (ahu.sequences.staticPressureReset) ahu.sequences.staticPressureReset.enabled = true
        c.faults.push(fault('v1', 'failed-vfd', ahu.id, {}))
      }
    },
  },
  {
    id: 'weekend-ghost',
    name: 'Weekend ghost',
    season: 'Summer (Saturday)',
    symptom: 'The air handler and plant are running Saturday morning with the building empty, and energy is being spent all weekend.',
    answer:
      'A forgotten occupancy override is forcing the AHU occupied 24/7. It never drops to unoccupied mode on weekends. Clear the override and confirm the normal schedule resumes.',
    startMinute: at(194, 10), // a Saturday morning
    apply: (c) => {
      const ahu = ahu1(c)
      if (ahu) {
        if (ahu.sequences.schedule) ahu.sequences.schedule.override = 'force-occupied'
        c.faults.push(fault('w1', 'schedule-override', ahu.id, {}))
      }
    },
  },
]

function fault(id: string, kind: SystemConfig['faults'][number]['kind'], targetNodeId: string, params: Record<string, number>) {
  return { id: `drill-${id}`, kind, targetNodeId, enabled: true, params, note: 'Loaded from a training drill' }
}
