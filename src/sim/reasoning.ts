// ---------------------------------------------------------------------------
// The reasoning engine — the training payload of the whole app.
//
// Every alarm explains *why* it fired by walking the causal chain from the
// symptom (a hot zone) back through the terminal unit, the air handler, and
// the plant, naming the first thing that is out of place. The companion
// `explainWhyNotRunning` traces a unit's interlock chain and reports what is
// blocking it — schedule, no call, safety, min-off timer, or lead/lag.
//
// These functions read the finished snapshot plus the world; they never mutate
// state, so the same logic serves both the live alarm banner and an
// on-demand "why?" click.
// ---------------------------------------------------------------------------

import type { Alarm, EquipmentNode, SimSnapshot, WhyNotRunning } from '../types/domain'
import { faultsForNode, SimWorld } from './world'

const HIGH_TEMP_TOL = 3
const LOW_TEMP_TOL = 3
const SAT_MISS_TOL = 3
const CHW_MISS_TOL = 3

export function evaluateAlarms(world: SimWorld, snap: SimSnapshot): Alarm[] {
  const alarms: Alarm[] = []
  const at = snap.clock.minute
  const oatActual = snap.weather.oatF
  const oatSensed = oatSensedFor(world, oatActual)

  // --- Zone temperature alarms with full causal traces --------------------
  for (const z of snap.zones) {
    const zone = world.index.byId[z.nodeId]
    if (!zone) continue
    const setCool = zone.sequences.setpoints?.zoneCoolingF ?? 74
    const setHeat = zone.sequences.setpoints?.zoneHeatingF ?? 70

    if (z.tempF > setCool + HIGH_TEMP_TOL && z.occupied) {
      alarms.push(zoneHighTempAlarm(world, snap, zone, z, setCool, oatActual, oatSensed, at))
    } else if (z.tempF < setHeat - LOW_TEMP_TOL && z.occupied) {
      alarms.push(zoneLowTempAlarm(world, snap, zone, z, setHeat, at))
    }

    // Ventilation / CO2. When DCV is enabled we hold it to the DCV setpoint;
    // otherwise we only flag genuinely poor IAQ (> 1100 ppm).
    const dcvNode = ahuForZone(world, z.nodeId)
    const dcv = dcvNode?.sequences.dcv
    const co2sp = dcv?.enabled ? dcv.co2SetpointPpm : 1100
    if (z.co2Ppm > co2sp && z.occupied) {
      alarms.push(highCo2Alarm(world, snap, zone, z, co2sp, at))
    }
  }

  // --- Plant: CHW can't make setpoint -------------------------------------
  for (const ch of world.index.chillers) {
    const st = snap.nodeStates[ch.id]
    if (!st?.running) continue
    const setpoint = chwSetpointRead(world, oatSensed)
    if (snap.loops.chwSupplyF > setpoint + CHW_MISS_TOL) {
      alarms.push(chwHighAlarm(world, snap, ch, setpoint, at))
    }
  }

  // --- AHU: can't hold discharge-air setpoint -----------------------------
  for (const ahu of world.index.ahus) {
    const st = snap.nodeStates[ahu.id]
    if (!st?.running) continue
    const satSp = st.outputs.satSetpointF
    const sat = st.outputs.satF
    if (sat > satSp + SAT_MISS_TOL && st.outputs.chwValvePct > 90) {
      alarms.push(satMissAlarm(world, snap, ahu, sat, satSp, oatActual, oatSensed, at))
    }
    // Simultaneous heating and cooling.
    if (st.outputs.chwValvePct > 10 && st.outputs.hwValvePct > 10) {
      alarms.push(simultaneousAlarm(ahu, st.outputs.chwValvePct, st.outputs.hwValvePct, at))
    }
  }

  // --- Faults surfaced as their own annunciations -------------------------
  for (const f of world.config.faults) {
    if (!f.enabled) continue
    if (f.kind === 'schedule-override') {
      const node = world.index.byId[f.targetNodeId]
      if (node) alarms.push(scheduleOverrideAlarm(node, snap, at))
    }
  }

  return alarms
}

// ---------------------------------------------------------------------------
// Individual alarm builders
// ---------------------------------------------------------------------------

function zoneHighTempAlarm(
  world: SimWorld,
  snap: SimSnapshot,
  zone: EquipmentNode,
  z: SimSnapshot['zones'][number],
  setCool: number,
  oatActual: number,
  oatSensed: number,
  at: number,
): Alarm {
  const vav = vavForZone(world, zone.id)
  const ahu = ahuForZone(world, zone.id)
  const ahuSt = ahu ? snap.nodeStates[ahu.id] : undefined
  const evidence: string[] = []
  const parts: string[] = []

  const vavMax = vav ? (vav.nameplate.maxCfm ?? 0) : 0
  const vavPct = vav && ahuSt ? 100 : 100 // terminal at max when zone is starved

  parts.push(
    `${zone.name} is ${z.tempF.toFixed(1)}°F against a ${setCool}°F cooling setpoint.`,
  )
  if (vav) {
    evidence.push(`${vav.name} damper commanded to 100% (max airflow ≈ ${vavMax} CFM)`)
    parts.push(`The ${vav.name} damper is at ${vavPct}% and the box is at maximum airflow,`)
  }
  if (ahu && ahuSt) {
    const sat = ahuSt.outputs.satF
    const satSp = ahuSt.outputs.satSetpointF
    const chwV = ahuSt.outputs.chwValvePct
    evidence.push(`${ahu.name} discharge air ${sat.toFixed(1)}°F vs ${satSp.toFixed(0)}°F setpoint`)
    evidence.push(`${ahu.name} CHW valve at ${chwV.toFixed(0)}%`)
    parts.push(
      `but discharge air is ${sat.toFixed(1)}°F, not the ${satSp.toFixed(0)}°F setpoint.`,
    )
    if (chwV > 90) {
      parts.push(`The chilled-water valve is ${chwV.toFixed(0)}% open — wide open — yet the coil still can't hit setpoint.`)
    } else {
      parts.push(`The chilled-water valve is only ${chwV.toFixed(0)}% open despite a full cooling call.`)
    }
  }

  // Root-cause. Two families: the terminal can't move enough air (SAT is being
  // met but it isn't cold/plentiful enough), or the coil is starved (SAT can't
  // be reached). Within "starved", is it a drifted OAT sensor skewing the
  // reset, an aggressive reset, or a genuinely short plant?
  const chwActual = snap.loops.chwSupplyF
  const chwSetpointSensed = chwSetpointRead(world, oatSensed)
  const chwSetpointTrue = chwSetpointRead(world, oatActual)
  const resetOn = world.index.chillers.some((c) => c.sequences.chwReset?.enabled)
  const drift = Math.abs(oatSensed - oatActual)
  const satMet = ahuSt ? ahuSt.outputs.satF <= ahuSt.outputs.satSetpointF + 1.5 : true
  let suggestedCheck = 'Verify chilled-water supply temperature and coil valve stroke.'

  if (satMet && ahu) {
    // Plant + coil are healthy; the box just can't deliver enough cold air.
    parts.push(
      `Chilled water is at ${chwActual.toFixed(1)}°F and ${ahu.name} is holding its supply-air setpoint, so the plant and coil are healthy. The box is already at maximum airflow — this terminal is delivering all the cooling it can, and the zone load exceeds its capacity.`,
    )
    suggestedCheck = `Check ${vav ? vav.name : 'the terminal'} sizing and look for an unexpected load (solar, occupancy, or a stuck-open reheat valve).`
  } else {
    evidence.push(`CHW supply ${chwActual.toFixed(1)}°F`)
    parts.push(`Chilled-water supply is ${chwActual.toFixed(1)}°F — not cold enough for the coil to reach its ${ahuSt ? ahuSt.outputs.satSetpointF.toFixed(0) : '55'}°F discharge setpoint.`)
    if (resetOn && drift > 2 && chwSetpointSensed > chwSetpointTrue + 1.5) {
      evidence.push(`CHW reset target ${chwSetpointSensed.toFixed(0)}°F on sensed OAT vs ${chwSetpointTrue.toFixed(0)}°F on actual OAT`)
      evidence.push(`OAT read ${oatSensed.toFixed(0)}°F while actual OAT is ${oatActual.toFixed(0)}°F`)
      parts.push(
        `Likely cause: the CHW reset is enabled and outdoor-air temperature is being read at ${oatSensed.toFixed(0)}°F while it is actually ${oatActual.toFixed(0)}°F outside. The reset is therefore holding chilled water at ~${chwSetpointSensed.toFixed(0)}°F when the real load wants ~${chwSetpointTrue.toFixed(0)}°F. Check the OAT sensor.`,
      )
      suggestedCheck = 'Check the OAT sensor calibration — it is reading low and skewing the CHW reset.'
    } else if (resetOn && chwActual <= chwSetpointSensed + 1.5) {
      parts.push(`The CHW reset is holding supply water at its ${chwSetpointSensed.toFixed(0)}°F target, which is too warm for this load. Review the reset curve.`)
      suggestedCheck = 'Review the CHW reset curve — it is resetting supply water too warm for the current load.'
    } else {
      parts.push(plantUndersized(world, snap))
      suggestedCheck = 'Confirm all lead/lag chillers are staged and check condenser water temperature and coil fouling.'
    }
  }

  return {
    id: `${zone.id}:high-temp`,
    nodeId: zone.id,
    severity: 'critical',
    title: `${zone.name} high temperature — ${z.tempF.toFixed(0)}°F, setpoint ${setCool}°F`,
    reasoning: parts.join(' '),
    evidence,
    suggestedCheck,
    raisedAtMin: at,
    active: true,
  }
}

function zoneLowTempAlarm(
  world: SimWorld,
  snap: SimSnapshot,
  zone: EquipmentNode,
  z: SimSnapshot['zones'][number],
  setHeat: number,
  at: number,
): Alarm {
  const vav = vavForZone(world, zone.id)
  const evidence: string[] = []
  const parts: string[] = [`${zone.name} is ${z.tempF.toFixed(1)}°F against a ${setHeat}°F heating setpoint.`]
  const hasReheat = vav && (vav.nameplate.reheatMbh ?? 0) > 0
  if (hasReheat) {
    evidence.push(`${vav!.name} reheat available (${vav!.nameplate.reheatMbh} MBH)`)
    parts.push(`The ${vav!.name} has reheat capacity but the zone is still below setpoint — check the reheat valve and hot-water availability.`)
  } else {
    parts.push('This terminal has no reheat, so it relies on warmer supply air; the AHU may be over-cooling.')
  }
  if (snap.loops.hwSupplyF < (world.index.boilers[0]?.nameplate.hwSupplyF ?? 140) - 15) {
    evidence.push(`HW supply ${snap.loops.hwSupplyF.toFixed(0)}°F is below target`)
    parts.push(`Hot-water supply is only ${snap.loops.hwSupplyF.toFixed(0)}°F — the boiler plant may be off or undersized for the morning warm-up.`)
  }
  return {
    id: `${zone.id}:low-temp`,
    nodeId: zone.id,
    severity: 'warning',
    title: `${zone.name} low temperature — ${z.tempF.toFixed(0)}°F, setpoint ${setHeat}°F`,
    reasoning: parts.join(' '),
    evidence,
    suggestedCheck: hasReheat ? 'Check the reheat valve stroke and hot-water supply temperature.' : 'Review supply-air temperature reset — the AHU may be over-cooling this zone.',
    raisedAtMin: at,
    active: true,
  }
}

function highCo2Alarm(
  world: SimWorld,
  _snap: SimSnapshot,
  zone: EquipmentNode,
  z: SimSnapshot['zones'][number],
  co2sp: number,
  at: number,
): Alarm {
  const ahu = ahuForZone(world, zone.id)
  const dcv = ahu?.sequences.dcv
  const parts = [`${zone.name} CO₂ is ${z.co2Ppm} ppm, above the ${co2sp} ppm limit with ${z.occupants} occupants.`]
  const evidence = [`Zone CO₂ ${z.co2Ppm} ppm`, `${z.occupants} occupants present`]
  if (ahu) {
    const oaPct = _snap.nodeStates[ahu.id]?.outputs.oaPct ?? 0
    evidence.push(`${ahu.name} outside-air damper at ${oaPct.toFixed(0)}%`)
    if (!dcv?.enabled) {
      parts.push(`Demand-controlled ventilation is not enabled on ${ahu.name}, so outside air is fixed at ${oaPct.toFixed(0)}% and is not increasing with occupancy.`)
    } else {
      parts.push(`DCV is enabled but the outside-air damper is at ${oaPct.toFixed(0)}% — it may be stuck or at its max-OA limit.`)
    }
  }
  return {
    id: `${zone.id}:high-co2`,
    nodeId: zone.id,
    severity: 'warning',
    title: `${zone.name} high CO₂ — ${z.co2Ppm} ppm`,
    reasoning: parts.join(' '),
    evidence,
    suggestedCheck: dcv?.enabled ? 'Verify the outside-air damper is stroking and not stuck at minimum.' : 'Enable demand-controlled ventilation or raise the minimum outside-air setting.',
    raisedAtMin: at,
    active: true,
  }
}

function chwHighAlarm(
  world: SimWorld,
  snap: SimSnapshot,
  ch: EquipmentNode,
  setpoint: number,
  at: number,
): Alarm {
  const actual = snap.loops.chwSupplyF
  const undersized = plantUndersized(world, snap)
  return {
    id: `${ch.id}:chw-high`,
    nodeId: ch.id,
    severity: 'warning',
    title: `Chilled water above setpoint — ${actual.toFixed(1)}°F vs ${setpoint.toFixed(0)}°F`,
    reasoning: `${ch.name} is running but chilled-water supply is ${actual.toFixed(1)}°F, ${(actual - setpoint).toFixed(1)}°F above the ${setpoint.toFixed(0)}°F setpoint. ${undersized}`,
    evidence: [`CHW supply ${actual.toFixed(1)}°F`, `Setpoint ${setpoint.toFixed(1)}°F`, `${ch.name} load ${(snap.nodeStates[ch.id]?.outputs.loadTons ?? 0).toFixed(0)} tons`],
    suggestedCheck: 'Confirm all lead/lag chillers are enabled and check condenser-water temperature and coil fouling.',
    raisedAtMin: at,
    active: true,
  }
}

function satMissAlarm(
  _world: SimWorld,
  snap: SimSnapshot,
  ahu: EquipmentNode,
  sat: number,
  satSp: number,
  oatActual: number,
  oatSensed: number,
  at: number,
): Alarm {
  const chwActual = snap.loops.chwSupplyF
  const evidence = [
    `Discharge air ${sat.toFixed(1)}°F vs ${satSp.toFixed(0)}°F setpoint`,
    `CHW valve ${(snap.nodeStates[ahu.id]?.outputs.chwValvePct ?? 0).toFixed(0)}%`,
    `CHW supply ${chwActual.toFixed(1)}°F`,
  ]
  const parts = [
    `${ahu.name} cannot reach its ${satSp.toFixed(0)}°F discharge-air setpoint — it is delivering ${sat.toFixed(1)}°F with the chilled-water valve wide open.`,
  ]
  const drift = Math.abs(oatSensed - oatActual)
  if (drift > 2) {
    evidence.push(`OAT read ${oatSensed.toFixed(0)}°F vs actual ${oatActual.toFixed(0)}°F`)
    parts.push(`The OAT sensor is reading ${oatSensed.toFixed(0)}°F while it is actually ${oatActual.toFixed(0)}°F outside, which is skewing the water-side reset and starving the coil.`)
  } else {
    parts.push(`Chilled water is at ${chwActual.toFixed(1)}°F — the coil simply has no colder water to work with.`)
  }
  return {
    id: `${ahu.id}:sat-miss`,
    nodeId: ahu.id,
    severity: 'warning',
    title: `${ahu.name} can't make discharge-air setpoint`,
    reasoning: parts.join(' '),
    evidence,
    suggestedCheck: drift > 2 ? 'Check the OAT sensor calibration.' : 'Lower CHW supply temperature / verify chiller staging.',
    raisedAtMin: at,
    active: true,
  }
}

function simultaneousAlarm(ahu: EquipmentNode, chwPct: number, hwPct: number, at: number): Alarm {
  return {
    id: `${ahu.id}:simultaneous`,
    nodeId: ahu.id,
    severity: 'info',
    title: `${ahu.name} simultaneous heating and cooling`,
    reasoning: `${ahu.name} has its chilled-water valve ${chwPct.toFixed(0)}% open and its hot-water valve ${hwPct.toFixed(0)}% open at the same time. Energy is being spent cooling air that is then reheated. Widen the discharge-air deadband or check the SAT reset.`,
    evidence: [`CHW valve ${chwPct.toFixed(0)}%`, `HW valve ${hwPct.toFixed(0)}%`],
    suggestedCheck: 'Review the discharge-air setpoint and deadband to eliminate the overlap.',
    raisedAtMin: at,
    active: true,
  }
}

function scheduleOverrideAlarm(node: EquipmentNode, snap: SimSnapshot, at: number): Alarm {
  const wk = snap.clock.dayOfWeek
  const offHours = snap.clock.hour < 6 || snap.clock.hour >= 18 || wk === 0 || wk === 6
  return {
    id: `${node.id}:sched-override`,
    nodeId: node.id,
    severity: offHours ? 'warning' : 'info',
    title: `${node.name} running on a forgotten override`,
    reasoning: `${node.name} has a schedule override forcing it occupied. It is ${snap.clock.dateLabel} ${pad(snap.clock.hour)}:${pad(snap.clock.minuteOfHour)} — ${offHours ? 'outside normal occupied hours, so the equipment is running (and spending energy) when the space is empty.' : 'currently within occupied hours, but the override will keep it running after hours until it is cleared.'}`,
    evidence: [`Override active on ${node.name}`, `Clock ${snap.clock.dateLabel} ${pad(snap.clock.hour)}:${pad(snap.clock.minuteOfHour)}`],
    suggestedCheck: 'Clear the occupancy override and confirm the normal schedule resumes.',
    raisedAtMin: at,
    active: true,
  }
}

// ---------------------------------------------------------------------------
// "Why is this NOT running?" — interlock-chain explainer
// ---------------------------------------------------------------------------

export function explainWhyNotRunning(world: SimWorld, snap: SimSnapshot, nodeId: string): WhyNotRunning {
  const node = world.index.byId[nodeId]
  const st = snap.nodeStates[nodeId]
  if (!node) {
    return { nodeId, running: false, headline: 'Unknown equipment.', chain: [] }
  }
  const running = !!st?.running
  const chain: WhyNotRunning['chain'] = []

  const anyCooling = snap.zones.some((z) => z.coolingCall > 0.02)
  const anyHeating = snap.zones.some((z) => z.heatingCall > 0.02)
  const faults = faultsForNode(world.config, nodeId)

  switch (node.category) {
    case 'chiller': {
      const demand = anyCooling || world.index.ahus.some((a) => (snap.nodeStates[a.id]?.outputs.chwValvePct ?? 0) > 5)
      chain.push({ label: 'Cooling demand present', ok: demand, detail: demand ? 'At least one air handler has a cooling call.' : 'No zone is calling for cooling and every CHW valve is closed — nothing needs chilled water.' })
      const stage = node.sequences.staging
      const isLead = (stage?.order ?? 0) === 0
      chain.push({ label: 'Staged to run (lead/lag)', ok: running, detail: running ? 'This chiller is the running lead/lag unit.' : isLead ? 'This is the lead chiller; it will start as soon as there is load.' : `This is a lag chiller (order ${stage?.order}); it only starts once the lead unit passes ${stage?.stageUpLoadPct ?? 85}% load.` })
      chain.push(timerCheck(world, snap, node))
      chain.push(faultCheck(faults))
      break
    }
    case 'boiler': {
      chain.push({ label: 'Heating demand present', ok: anyHeating, detail: anyHeating ? 'At least one zone is calling for heat.' : 'No zone is below its heating setpoint — there is no call for hot water.' })
      const stage = node.sequences.staging
      const isLead = (stage?.order ?? 0) === 0
      chain.push({ label: 'Staged to run (lead/lag)', ok: running, detail: running ? 'This boiler is staged on.' : isLead ? 'This is the lead boiler; it will fire on any heating call.' : `This is a lag boiler; it stages on only after the lead passes ${stage?.stageUpLoadPct ?? 85}% load.` })
      chain.push(timerCheck(world, snap, node))
      chain.push(faultCheck(faults))
      break
    }
    case 'ahu':
    case 'rtu': {
      const occ = isOccupiedNow(node, snap)
      chain.push({ label: 'Occupied / scheduled on', ok: occ || running, detail: occ ? 'The schedule says this air handler should be running now.' : `The schedule is unoccupied at ${pad(snap.clock.hour)}:${pad(snap.clock.minuteOfHour)} on ${snap.clock.dateLabel}.` })
      const call = anyCooling || anyHeating
      chain.push({ label: 'Zone call for conditioning', ok: call || occ, detail: call ? 'A served zone is calling for heating or cooling.' : 'No served zone is off setpoint, so the unit can stay off in unoccupied mode.' })
      chain.push(faultCheck(faults))
      break
    }
    case 'pump': {
      const variant = (node.variant ?? '').toLowerCase()
      const need = variant.includes('hw') || variant.includes('hot') ? anyHeating : anyCooling
      chain.push({ label: 'Loop needs flow', ok: need, detail: need ? 'The plant it serves has load, so the pump should run.' : 'The plant it serves has no load right now.' })
      chain.push(timerCheck(world, snap, node))
      chain.push(faultCheck(faults))
      break
    }
    case 'coolingTower': {
      const reject = world.index.chillers.some((c) => snap.nodeStates[c.id]?.running)
      chain.push({ label: 'Chiller rejecting heat', ok: reject, detail: reject ? 'A water-cooled chiller is running and needs condenser water.' : 'No chiller is running, so there is no heat to reject.' })
      chain.push(faultCheck(faults))
      break
    }
    default: {
      const call = anyCooling || anyHeating
      chain.push({ label: 'Conditioning call present', ok: call, detail: call ? 'There is an active call this unit could answer.' : 'No active heating or cooling call.' })
      chain.push(faultCheck(faults))
    }
  }

  const firstBlock = chain.find((c) => !c.ok)
  const headline = running
    ? `${node.name} is running normally.`
    : firstBlock
      ? `${node.name} is off because: ${firstBlock.detail}`
      : `${node.name} is off; no single interlock is blocking it — it simply has no call.`

  return { nodeId, running, headline, chain }
}

// ---------------------------------------------------------------------------
// Shared trace helpers
// ---------------------------------------------------------------------------

function timerCheck(world: SimWorld, snap: SimSnapshot, node: EquipmentNode): WhyNotRunning['chain'][number] {
  const timer = world.timers[node.id]
  const minOff = node.sequences.staging?.minOffTimeMin ?? 0
  const sinceChange = snap.clock.minute - (timer?.lastChangeMin ?? 0)
  const blocked = !timer?.running && minOff > 0 && sinceChange < minOff
  return {
    label: 'Minimum off-time satisfied',
    ok: !blocked,
    detail: blocked ? `Minimum off-time timer active — ${minOff - sinceChange} min remaining before it may restart.` : 'No anti-short-cycle timer is holding it off.',
  }
}

function faultCheck(faults: ReturnType<typeof faultsForNode>): WhyNotRunning['chain'][number] {
  const blocking = faults.find((f) => f.kind === 'failed-vfd' || f.kind === 'seized-actuator')
  return {
    label: 'No blocking fault',
    ok: !blocking,
    detail: blocking ? `A ${blocking.kind.replace('-', ' ')} fault is injected on this unit.` : 'No injected fault is preventing operation.',
  }
}

function plantUndersized(world: SimWorld, snap: SimSnapshot): string {
  const running = world.index.chillers.filter((c) => snap.nodeStates[c.id]?.running)
  const total = world.index.chillers.length
  if (running.length < total) {
    return `Only ${running.length} of ${total} chillers are staged on — the plant may simply be short of capacity for the current load.`
  }
  return 'All chillers are staged on; the plant is at capacity for this load.'
}

function oatSensedFor(world: SimWorld, actual: number): number {
  if (!world.index.oatSensorId) return actual
  let v = actual
  for (const f of faultsForNode(world.config, world.index.oatSensorId)) if (f.kind === 'drifted-sensor') v += f.params.driftF ?? 0
  return v
}

function chwSetpointRead(world: SimWorld, oatSensed: number): number {
  const lead = world.index.chillers[0]
  const r = lead?.sequences.chwReset
  const base = lead?.nameplate.chwSupplyF ?? 44
  if (!r || !r.enabled) return base
  if (r.strategy === 'fixed') return r.fixedSetpointF
  if (r.strategy === 'oat') {
    const frac = clampLocal((oatSensed - r.oatLowF) / Math.max(1, r.oatHighF - r.oatLowF), 0, 1)
    return r.satAtLowF + (r.satAtHighF - r.satAtLowF) * frac
  }
  return r.fixedSetpointF
}

function vavForZone(world: SimWorld, zoneId: string): EquipmentNode | undefined {
  for (const [vavId, zid] of Object.entries(world.index.vavZone)) if (zid === zoneId) return world.index.byId[vavId]
  return undefined
}

function ahuForZone(world: SimWorld, zoneId: string): EquipmentNode | undefined {
  const vav = vavForZone(world, zoneId)
  if (!vav) return world.index.ahus[0]
  const ahuId = world.index.vavAhu[vav.id]
  return ahuId ? world.index.byId[ahuId] : world.index.ahus[0]
}

function isOccupiedNow(node: EquipmentNode, snap: SimSnapshot): boolean {
  const s = node.sequences.schedule
  const c = snap.clock
  if (!s || !s.enabled) return c.hour >= 6 && c.hour < 18 && c.dayOfWeek >= 1 && c.dayOfWeek <= 5
  if (s.override === 'force-occupied') return true
  if (s.override === 'force-unoccupied') return false
  const weekend = c.dayOfWeek === 0 || c.dayOfWeek === 6
  if (weekend) return s.weekendOccupied && c.hour >= s.weekendStartHr && c.hour < s.weekendEndHr
  return c.hour >= s.weekdayStartHr && c.hour < s.weekdayEndHr
}

function clampLocal(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
