// ---------------------------------------------------------------------------
// The per-minute simulation step. Lumped-parameter, directionally correct and
// explainable — the guiding standard for this training tool. Each step:
//   1. clock + weather
//   2. occupancy, internal + solar gains, zone cooling/heating calls
//   3. air side: SAT reset, economizer/OA, VAV airflow, coil loads
//   4. water side: chiller/boiler staging, loop supply temps, achievable SAT
//   5. energy per node
//   6. integrate zone temperatures and CO2
//   7. build the snapshot (alarms are attached by reasoning.ts)
//
// Faults are woven in at the exact points a real fault would bite: a drifted
// sensor changes what the *controls read*, a stuck damper overrides the *OA
// position*, a fouled coil widens the *coil approach*, and so on.
// ---------------------------------------------------------------------------

import type {
  Alarm,
  EquipmentNode,
  NodeState,
  SimClock,
  SimSnapshot,
  TrendSample,
  Weather,
  ZoneRuntime,
} from '../types/domain'
import { clamp, weatherAt } from './weather'
import { faultsForNode, SimWorld } from './world'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const COIL_APPROACH_F = 7 // CHW-to-air approach at the cooling coil
const HEAT_COIL_APPROACH_F = 12 // HW-to-air approach at the heating coil
const OUTDOOR_CO2 = 420
const CP_AIR = 1.08 // Btu/(h·cfm·°F), sensible

export function computeClock(minute: number): SimClock {
  const dayIndex = Math.floor(minute / 1440)
  const hour = Math.floor((minute % 1440) / 60)
  const minuteOfHour = minute % 60
  const dayOfWeek = (dayIndex + 1) % 7 // day 0 = Monday-ish start on a Mon → use +1 so 0=Sun mapping
  // Calendar starting Jan 1.
  let d = dayIndex % 365
  let month = 0
  while (d >= DAYS_IN_MONTH[month]) {
    d -= DAYS_IN_MONTH[month]
    month++
  }
  const dateLabel = `${DAYS[dayOfWeek]} ${MONTHS[month]} ${d + 1}`
  return { minute, dayOfWeek, hour, minuteOfHour, dayIndex, dateLabel }
}

interface AhuCompute {
  running: boolean
  satSetpointF: number // what the reset asks for
  satDeliveredF: number // what the coil can actually make
  oaFraction: number
  mixedAirF: number
  totalCfm: number
  designCfm: number
  chwValvePct: number
  hwValvePct: number
  coilLoadTons: number
  economizerActive: boolean
  fanKw: number
  blocked?: string[]
}

/** Advance the world one minute and return the resulting snapshot + trend row. */
export function step(world: SimWorld): { snapshot: SimSnapshot; trend: TrendSample } {
  const cfg = world.config
  const idx = world.index
  world.minute += 1
  const minute = world.minute
  const clock = computeClock(minute)
  const weather = weatherAt(minute, cfg.building)

  const nodeStates: Record<string, NodeState> = {}
  const trendValues: Record<string, number> = {}

  // --- OAT as the controls read it (drift fault on the OAT sensor) ----------
  let sensedOat = weather.oatF
  if (idx.oatSensorId) {
    for (const f of faultsForNode(cfg, idx.oatSensorId)) {
      if (f.kind === 'drifted-sensor') sensedOat += f.params.driftF ?? 0
    }
  }
  const sensedWeather: Weather = { ...weather, oatF: sensedOat }

  // --- 1. Occupancy + zone calls -------------------------------------------
  const zoneRuntimes: ZoneRuntime[] = []
  const zoneCall: Record<string, { cooling: number; heating: number; occupied: boolean; occupants: number; setCool: number; setHeat: number }> = {}

  for (const zone of idx.zones) {
    const seq = zone.sequences
    const setCool = seq.setpoints?.zoneCoolingF ?? 74
    const setHeat = seq.setpoints?.zoneHeatingF ?? 70
    const occupied = isOccupied(zone, clock)
    const designOcc = zone.nameplate.designOccupants ?? 0
    const occupants = occupied ? Math.round(designOcc * occupancyFraction(clock)) : 0

    const t = world.zoneTemp[zone.id] ?? 72
    const cooling = clamp((t - setCool) / 3, 0, 1)
    const heating = clamp((setHeat - t) / 3, 0, 1)
    zoneCall[zone.id] = { cooling, heating, occupied, occupants, setCool, setHeat }
  }

  // --- 2. Air side per AHU --------------------------------------------------
  const ahuResults: Record<string, AhuCompute> = {}
  for (const ahu of idx.ahus) {
    ahuResults[ahu.id] = computeAhu(world, ahu, clock, weather, sensedWeather, zoneCall)
  }

  // --- 3. Water side: aggregate coil loads and stage the plants ------------
  let chwLoadTons = 0
  for (const ahu of idx.ahus) chwLoadTons += Math.max(0, ahuResults[ahu.id].coilLoadTons)
  for (const fcu of idx.fcus) chwLoadTons += fcuCoolTons(world, fcu, zoneCall)

  const chwSetpoint = chwSupplySetpoint(world, sensedWeather, chwLoadTons)
  const chillerResult = stageChillers(world, clock, chwLoadTons, chwSetpoint)
  world.loops.chwSupplyF = chillerResult.chwSupplyF
  world.loops.chwReturnF = chillerResult.chwSupplyF + 10

  // Heating plant (reheat + AHU heating coils + FCU/zone heating in winter).
  let hwLoadMbh = 0
  for (const vav of idx.vavs) hwLoadMbh += vavReheatMbh(world, vav, ahuResults, zoneCall)
  for (const ahu of idx.ahus) hwLoadMbh += Math.max(0, ahuHeatMbh(ahuResults[ahu.id]))
  const hwSetpoint = hwSupplySetpoint(world, sensedWeather)
  const boilerResult = stageBoilers(world, clock, hwLoadMbh, hwSetpoint)
  world.loops.hwSupplyF = boilerResult.hwSupplyF
  world.loops.hwReturnF = boilerResult.hwSupplyF - 20

  // Condenser side for water-cooled chillers + WSHP loop.
  const towerResult = stageTowers(world, weather, chillerResult.rejectTons)
  world.loops.cwSupplyF = towerResult.cwSupplyF
  world.loops.cwReturnF = towerResult.cwSupplyF + 10

  // Re-derive the SAT each AHU can actually deliver now that CHW supply is known.
  for (const ahu of idx.ahus) {
    const r = ahuResults[ahu.id]
    if (r.running && r.chwValvePct > 0 && idx.ahuOnChw[ahu.id] !== false) {
      const foul = foulFactor(world, ahu.id)
      const achievable = world.loops.chwSupplyF + COIL_APPROACH_F * (1 + foul)
      r.satDeliveredF = Math.max(r.satSetpointF, Math.min(r.mixedAirF, achievable))
    }
  }

  // --- 4. Energy: chillers, boilers, pumps, towers -------------------------
  for (const ch of idx.chillers) {
    const running = chillerResult.running.has(ch.id)
    const load = chillerResult.perUnitTons[ch.id] ?? 0
    nodeStates[ch.id] = chillerState(ch, running, load, world.loops.chwSupplyF, world.loops.cwSupplyF, world, clock)
  }
  for (const b of idx.boilers) {
    const running = boilerResult.running.has(b.id)
    const load = boilerResult.perUnitMbh[b.id] ?? 0
    nodeStates[b.id] = boilerState(b, running, load)
  }
  for (const p of idx.pumps) nodeStates[p.id] = pumpState(world, p, chwLoadTons, hwLoadMbh)
  for (const t of idx.towers) nodeStates[t.id] = towerState(t, towerResult, chillerResult.rejectTons)

  // --- 5. Air-side node states + VAV states --------------------------------
  for (const ahu of idx.ahus) {
    const r = ahuResults[ahu.id]
    nodeStates[ahu.id] = {
      running: r.running,
      outputs: {
        satSetpointF: r.satSetpointF,
        satF: r.satDeliveredF,
        oaPct: r.oaFraction * 100,
        mixedAirF: r.mixedAirF,
        chwValvePct: r.chwValvePct,
        hwValvePct: r.hwValvePct,
        cfm: r.totalCfm,
        staticInWc: staticPressure(world, ahu, r),
      },
      kw: r.running ? r.fanKw : 0,
      therms: 0,
      blockedBy: r.blocked,
    }
    trendValues[`${ahu.id}.satF`] = r.satDeliveredF
    trendValues[`${ahu.id}.oaPct`] = r.oaFraction * 100
    trendValues[`${ahu.id}.cfm`] = r.totalCfm
  }

  // --- 6. Integrate each zone's temperature + CO2 --------------------------
  for (const zone of idx.zones) {
    integrateZone(world, zone, clock, weather, zoneCall, ahuResults, nodeStates)
    const zc = zoneCall[zone.id]
    zoneRuntimes.push({
      nodeId: zone.id,
      tempF: round1(world.zoneTemp[zone.id]),
      co2Ppm: Math.round(world.zoneCo2[zone.id]),
      occupied: zc.occupied,
      occupants: zc.occupants,
      coolingCall: round2(zc.cooling),
      heatingCall: round2(zc.heating),
    })
    trendValues[`${zone.id}.tempF`] = world.zoneTemp[zone.id]
    trendValues[`${zone.id}.co2`] = world.zoneCo2[zone.id]
  }

  // WSHP / FCU node states (terminal units on zones).
  for (const w of idx.wshps) nodeStates[w.id] = wshpState(world, w, zoneCall)
  for (const f of idx.fcus) nodeStates[f.id] = fcuState(world, f, zoneCall)
  for (const s of idx.sensors) nodeStates[s.id] = { running: true, outputs: {}, kw: 0, therms: 0 }

  // --- 7. Totals -----------------------------------------------------------
  let kw = 0
  let thermsPerHr = 0
  for (const id of Object.keys(nodeStates)) {
    kw += nodeStates[id].kw
    thermsPerHr += nodeStates[id].therms * 60 // per-minute therms → per-hour
  }
  const costPerHr =
    kw * cfg.building.electricRatePerKwh + thermsPerHr * cfg.building.gasRatePerTherm

  trendValues['plant.chwSupplyF'] = world.loops.chwSupplyF
  trendValues['plant.hwSupplyF'] = world.loops.hwSupplyF
  trendValues['plant.cwSupplyF'] = world.loops.cwSupplyF
  trendValues['weather.oatF'] = weather.oatF
  trendValues['weather.sensedOatF'] = sensedOat
  trendValues['building.kw'] = kw
  trendValues['building.costPerHr'] = costPerHr

  const snapshot: SimSnapshot = {
    clock,
    weather,
    nodeStates,
    zones: zoneRuntimes,
    loops: { ...world.loops },
    alarms: [] as Alarm[], // filled by reasoning.evaluateAlarms in the worker
    totals: { kw: round1(kw), thermsPerHr: round2(thermsPerHr), costPerHr: round2(costPerHr) },
  }

  return { snapshot, trend: { minute, values: trendValues } }
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

function isOccupied(node: EquipmentNode, clock: SimClock): boolean {
  const s = node.sequences.schedule
  if (!s || !s.enabled) return clock.hour >= 6 && clock.hour < 18 && clock.dayOfWeek >= 1 && clock.dayOfWeek <= 5
  if (s.override === 'force-occupied') return true
  if (s.override === 'force-unoccupied') return false
  const weekend = clock.dayOfWeek === 0 || clock.dayOfWeek === 6
  if (weekend) return s.weekendOccupied && clock.hour >= s.weekendStartHr && clock.hour < s.weekendEndHr
  return clock.hour >= s.weekdayStartHr && clock.hour < s.weekdayEndHr
}

function occupancyFraction(clock: SimClock): number {
  // Ramp in over the morning, dip at lunch, ramp out — a believable diversity.
  const h = clock.hour + clock.minuteOfHour / 60
  if (h < 8) return 0.3
  if (h < 11) return 0.9
  if (h < 13) return 0.7
  if (h < 16) return 0.95
  if (h < 18) return 0.5
  return 0.15
}

// ---------------------------------------------------------------------------
// Air side
// ---------------------------------------------------------------------------

function computeAhu(
  world: SimWorld,
  ahu: EquipmentNode,
  clock: SimClock,
  _weather: Weather,
  sensed: Weather,
  zoneCall: Record<string, { cooling: number; heating: number; occupied: boolean; occupants: number; setCool: number; setHeat: number }>,
): AhuCompute {
  const np = ahu.nameplate
  const designCfm = np.cfm ?? 10000
  const seq = ahu.sequences
  const servedVavs = world.index.ahuVavs[ahu.id] ?? []

  const anyOccupied = servedVavs.some((v) => {
    const z = world.index.vavZone[v]
    return z ? zoneCall[z]?.occupied : false
  })
  const anyCall = servedVavs.some((v) => {
    const z = world.index.vavZone[v]
    return z ? zoneCall[z]?.cooling > 0.02 || zoneCall[z]?.heating > 0.02 : false
  })

  // Schedule / optimal start.
  const scheduledOn = isOccupied(ahu, clock)
  const running = scheduledOn || anyOccupied || anyCall
  if (!running) {
    return {
      running: false,
      satSetpointF: seq.dischargeAirReset?.fixedSetpointF ?? np.satDesignF ?? 55,
      satDeliveredF: world.zoneTemp[world.index.vavZone[servedVavs[0]] ?? ''] ?? 72,
      oaFraction: 0,
      mixedAirF: sensed.oatF,
      totalCfm: 0,
      designCfm,
      chwValvePct: 0,
      hwValvePct: 0,
      coilLoadTons: 0,
      economizerActive: false,
      fanKw: 0,
      blocked: scheduleBlock(ahu, clock),
    }
  }

  // SAT setpoint from reset strategy.
  const satSetpointF = satReset(ahu, sensed)

  // Airflow: sum VAV demand.
  let totalCfm = 0
  let returnTempWeighted = 0
  for (const v of servedVavs) {
    const vav = world.index.byId[v]
    const zoneId = world.index.vavZone[v]
    const zc = zoneId ? zoneCall[zoneId] : undefined
    const cfm = vavAirflow(world, vav, zc)
    totalCfm += cfm
    returnTempWeighted += cfm * (zoneId ? world.zoneTemp[zoneId] ?? 74 : 74)
  }
  const returnTemp = totalCfm > 0 ? returnTempWeighted / totalCfm : 74
  totalCfm = clamp(totalCfm, 0, designCfm)

  // Outside-air fraction: economizer + min OA + DCV, then stuck-damper fault.
  const minOa = (seq.economizer?.minOaPct ?? np.minOaPct ?? 15) / 100
  let oaFraction = minOa
  let economizerActive = false
  const eco = seq.economizer
  if (eco?.enabled) {
    const suitable =
      eco.type === 'enthalpy' || eco.type === 'differential'
        ? sensed.enthalpy < eco.highLimitEnthalpy
        : sensed.oatF < eco.highLimitOatF
    const wantsCooling = returnTemp > satSetpointF + 0.5
    if (suitable && wantsCooling && sensed.oatF < returnTemp) {
      // Modulate OA to reach SAT by free cooling.
      const need = clamp((returnTemp - satSetpointF) / Math.max(1, returnTemp - sensed.oatF), minOa, 1)
      oaFraction = need
      economizerActive = need > minOa + 0.01
    }
  }
  // Demand-controlled ventilation raises OA to hold CO2.
  const dcv = seq.dcv
  if (dcv?.enabled) {
    let maxCo2 = OUTDOOR_CO2
    for (const v of servedVavs) {
      const z = world.index.vavZone[v]
      if (z) maxCo2 = Math.max(maxCo2, world.zoneCo2[z] ?? OUTDOOR_CO2)
    }
    if (maxCo2 > dcv.co2SetpointPpm) oaFraction = Math.max(oaFraction, dcv.maxOaPct / 100)
    else oaFraction = Math.max(dcv.minOaPct / 100, Math.min(oaFraction, dcv.maxOaPct / 100))
  }
  // Stuck / seized OA damper fault overrides the commanded position.
  for (const f of faultsForNode(world.config, ahu.id)) {
    if (f.kind === 'stuck-damper' || f.kind === 'seized-actuator') oaFraction = (f.params.stuckPct ?? 100) / 100
  }
  oaFraction = clamp(oaFraction, 0, 1)

  const mixedAirF = oaFraction * sensed.oatF + (1 - oaFraction) * returnTemp

  // Coil demand: cool mixed air toward SAT setpoint using CHW; achievable SAT
  // is finalized after the plant solves (see step()). Provisional here.
  const foul = foulFactor(world, ahu.id)
  const achievableProvisional = world.loops.chwSupplyF + COIL_APPROACH_F * (1 + foul)
  let satDeliveredF = satSetpointF
  let chwValvePct = 0
  let hwValvePct = 0
  if (mixedAirF > satSetpointF + 0.2 && world.index.ahuOnChw[ahu.id] !== false) {
    satDeliveredF = Math.max(satSetpointF, Math.min(mixedAirF, achievableProvisional))
    chwValvePct = clamp(((mixedAirF - satDeliveredF) / Math.max(1, mixedAirF - achievableProvisional)) * 100, 0, 100)
  } else if (mixedAirF < satSetpointF - 0.2 && world.index.ahuOnHw[ahu.id]) {
    // Heating coil warms mixed air to SAT.
    satDeliveredF = Math.min(satSetpointF, world.loops.hwSupplyF - HEAT_COIL_APPROACH_F)
    hwValvePct = clamp(((satSetpointF - mixedAirF) / Math.max(1, satSetpointF - mixedAirF + 10)) * 100, 0, 100)
  } else {
    satDeliveredF = mixedAirF
  }

  // Leaking cooling-coil valve: adds unwanted cooling even with no call.
  for (const f of faultsForNode(world.config, ahu.id)) {
    if (f.kind === 'leaking-valve') {
      chwValvePct = Math.max(chwValvePct, f.params.leakPct ?? 15)
      satDeliveredF = Math.min(satDeliveredF, mixedAirF - 0.05 * chwValvePct)
    }
  }

  const coilLoadTons = (CP_AIR * totalCfm * Math.max(0, mixedAirF - satDeliveredF)) / 12000
  const flowFrac = designCfm > 0 ? totalCfm / designCfm : 0
  const fanKw = fanPower(world, ahu, flowFrac)

  return {
    running: true,
    satSetpointF,
    satDeliveredF,
    oaFraction,
    mixedAirF,
    totalCfm,
    designCfm,
    chwValvePct,
    hwValvePct,
    coilLoadTons,
    economizerActive,
    fanKw,
  }
}

function satReset(ahu: EquipmentNode, sensed: Weather): number {
  const r = ahu.sequences.dischargeAirReset
  const design = ahu.nameplate.satDesignF ?? 55
  if (!r || !r.enabled) return r?.fixedSetpointF ?? design
  if (r.strategy === 'fixed') return r.fixedSetpointF
  if (r.strategy === 'oat') {
    // Warmer outside → lower SAT (more cooling). Linear between the two points.
    const frac = clamp((sensed.oatF - r.oatLowF) / Math.max(1, r.oatHighF - r.oatLowF), 0, 1)
    return lerp(r.satAtLowF, r.satAtHighF, frac)
  }
  // trim-and-respond: nudge from a mid value toward the low bound under load.
  return r.satAtHighF
}

function vavAirflow(
  world: SimWorld,
  vav: EquipmentNode,
  zc?: { cooling: number; heating: number; occupied: boolean },
): number {
  if (!vav) return 0
  const maxCfm = vav.nameplate.maxCfm ?? 1000
  const minCfm = vav.nameplate.minCfm ?? maxCfm * 0.3
  if (!zc) return minCfm
  let frac = zc.cooling // cooling drives airflow up
  let cfm = lerp(minCfm, maxCfm, frac)
  if (!zc.occupied) cfm = zc.cooling > 0.05 ? cfm : 0
  // Seized VAV actuator sticks the damper at a fixed position.
  for (const f of faultsForNode(world.config, vav.id)) {
    if (f.kind === 'seized-actuator' || f.kind === 'stuck-damper') {
      const pct = (f.params.stuckPct ?? 100) / 100
      cfm = lerp(minCfm, maxCfm, pct)
    }
  }
  return cfm
}

function vavReheatMbh(
  world: SimWorld,
  vav: EquipmentNode,
  _ahuResults: Record<string, AhuCompute>,
  zoneCall: Record<string, { heating: number; cooling: number }>,
): number {
  const zoneId = world.index.vavZone[vav.id]
  const zc = zoneId ? zoneCall[zoneId] : undefined
  if (!zc || zc.heating < 0.02) return 0
  return (vav.nameplate.reheatMbh ?? 0) * zc.heating
}

function ahuHeatMbh(r: AhuCompute): number {
  if (r.hwValvePct <= 0) return 0
  return (CP_AIR * r.totalCfm * Math.max(0, r.satSetpointF - r.mixedAirF)) / 1000
}

function fcuCoolTons(
  world: SimWorld,
  fcu: EquipmentNode,
  zoneCall: Record<string, { cooling: number }>,
): number {
  const zoneId = nearestZone(world, fcu)
  const call = zoneId ? zoneCall[zoneId]?.cooling ?? 0 : 0
  return (fcu.nameplate.coolTons ?? 2) * call
}

// ---------------------------------------------------------------------------
// Water side / plants
// ---------------------------------------------------------------------------

function chwSupplySetpoint(world: SimWorld, sensed: Weather, loadTons: number): number {
  // Use the lead chiller's reset config (banks share a strategy in practice).
  const lead = world.index.chillers[0]
  const r = lead?.sequences.chwReset
  const base = lead?.nameplate.chwSupplyF ?? 44
  if (!r || !r.enabled) return base
  if (r.strategy === 'fixed') return r.fixedSetpointF
  if (r.strategy === 'oat') {
    const frac = clamp((sensed.oatF - r.oatLowF) / Math.max(1, r.oatHighF - r.oatLowF), 0, 1)
    return lerp(r.satAtLowF, r.satAtHighF, frac)
  }
  // load-based: colder setpoint as load climbs.
  const totalTons = world.index.chillers.reduce((s, c) => s + (c.nameplate.tons ?? 0), 0) || 1
  const frac = clamp(loadTons / totalTons, 0, 1)
  return lerp(r.satAtLowF, r.satAtHighF, frac)
}

function hwSupplySetpoint(world: SimWorld, sensed: Weather): number {
  const lead = world.index.boilers[0]
  const r = lead?.sequences.hwReset
  const base = lead?.nameplate.hwSupplyF ?? 140
  if (!r || !r.enabled) return base
  if (r.strategy === 'oat') {
    const frac = clamp((sensed.oatF - r.oatLowF) / Math.max(1, r.oatHighF - r.oatLowF), 0, 1)
    return lerp(r.satAtLowF, r.satAtHighF, frac) // colder OAT → hotter HW
  }
  return r.fixedSetpointF
}

interface ChillerStage {
  running: Set<string>
  perUnitTons: Record<string, number>
  chwSupplyF: number
  rejectTons: number
}

function stageChillers(world: SimWorld, clock: SimClock, loadTons: number, setpointF: number): ChillerStage {
  const chillers = leadLagOrder(world, world.index.chillers, 'chw-bank')
  const running = new Set<string>()
  const perUnitTons: Record<string, number> = {}
  let staged = 0
  let capacity = 0

  for (const ch of chillers) {
    const tons = ch.nameplate.tons ?? 0
    const need = loadTons > staged + 1 || (loadTons > 0.5 && running.size === 0)
    if (need && respectsTimers(world, ch.id, clock, ch.sequences.staging)) {
      running.add(ch.id)
      capacity += tons
      staged += tons
    }
    if (staged >= loadTons && loadTons > 0) break
  }
  // Distribute load evenly across running chillers.
  const runCount = running.size
  if (runCount > 0) {
    const share = loadTons / runCount
    for (const id of running) perUnitTons[id] = Math.min(share, world.index.byId[id].nameplate.tons ?? share)
  }
  setTimers(world, world.index.chillers, running, clock)

  // Supply temp: meets setpoint if capacity covers load, else floats up.
  let chwSupplyF = setpointF
  if (loadTons > capacity + 0.5) {
    chwSupplyF = setpointF + Math.min(12, (loadTons - capacity) / Math.max(1, capacity) * 8)
  } else if (running.size === 0) {
    // No cooling: the idle loop warms toward space temperature (~70°F).
    chwSupplyF = lerp(world.loops.chwSupplyF, 70, 0.05)
  } else {
    chwSupplyF = lerp(world.loops.chwSupplyF, setpointF, 0.5)
  }
  chwSupplyF = clamp(chwSupplyF, 38, 75)
  return { running, perUnitTons, chwSupplyF, rejectTons: loadTons * 1.25 }
}

interface BoilerStage {
  running: Set<string>
  perUnitMbh: Record<string, number>
  hwSupplyF: number
}

function stageBoilers(world: SimWorld, clock: SimClock, loadMbh: number, setpointF: number): BoilerStage {
  const boilers = leadLagOrder(world, world.index.boilers, 'hw-bank')
  const running = new Set<string>()
  const perUnitMbh: Record<string, number> = {}
  let staged = 0
  let capacity = 0
  for (const b of boilers) {
    const mbh = b.nameplate.mbh ?? 0
    const need = loadMbh > staged + 20 || (loadMbh > 10 && running.size === 0)
    if (need && respectsTimers(world, b.id, clock, b.sequences.staging)) {
      running.add(b.id)
      capacity += mbh
      staged += mbh
    }
    if (staged >= loadMbh && loadMbh > 0) break
  }
  const runCount = running.size
  if (runCount > 0) {
    const share = loadMbh / runCount
    for (const id of running) perUnitMbh[id] = share
  }
  setTimers(world, world.index.boilers, running, clock)

  let hwSupplyF = setpointF
  if (loadMbh > capacity + 20) hwSupplyF = setpointF - Math.min(20, (loadMbh - capacity) / Math.max(1, capacity) * 15)
  else if (running.size === 0) hwSupplyF = lerp(world.loops.hwSupplyF, 70, 0.05)
  else hwSupplyF = lerp(world.loops.hwSupplyF, setpointF, 0.5)
  hwSupplyF = clamp(hwSupplyF, 70, 200)
  return { running, perUnitMbh, hwSupplyF }
}

interface TowerStage {
  cwSupplyF: number
  stageFrac: number
}

function stageTowers(world: SimWorld, weather: Weather, rejectTons: number): TowerStage {
  const towers = world.index.towers
  if (towers.length === 0 || rejectTons < 0.5) {
    return { cwSupplyF: clamp(weather.oatF - 5, 60, 95), stageFrac: 0 }
  }
  const lead = towers[0]
  const r = lead.sequences.cwReset
  const setpoint = r?.enabled ? (r.strategy === 'fixed' ? r.fixedSetpointF : clamp(weather.oatF - 8, 65, 85)) : 75
  const approach = lead.nameplate.approachF ?? 5
  // Wet-bulb ~ oat - dep; approach adds on top; more rejection → warmer supply.
  const wetBulb = weather.oatF - (1 - weather.rhPct / 100) * 18
  const capacity = towers.reduce((s, t) => s + (t.nameplate.tons ?? 0), 0) || 1
  const stageFrac = clamp(rejectTons / capacity, 0, 1)
  const cwSupplyF = Math.max(setpoint, wetBulb + approach + stageFrac * 4)
  return { cwSupplyF, stageFrac }
}

// ---------------------------------------------------------------------------
// Per-node energy states
// ---------------------------------------------------------------------------

function chillerState(
  ch: EquipmentNode,
  running: boolean,
  loadTons: number,
  chwSupplyF: number,
  cwSupplyF: number,
  _world: SimWorld,
  _clock: SimClock,
): NodeState {
  if (!running || loadTons <= 0) {
    return { running: false, outputs: { loadTons: 0, plr: 0 }, kw: 0, therms: 0, blockedBy: running ? undefined : ['No cooling call or staged off'] }
  }
  const tons = ch.nameplate.tons ?? 1
  const plr = clamp(loadTons / tons, 0.05, 1)
  const eer = ch.nameplate.eer ?? 10
  const iplv = ch.nameplate.iplv ?? eer * 1.3
  // Better efficiency at part load (blend toward IPLV), degraded by CHW lift.
  const eerEff = lerp(eer, iplv, 1 - plr)
  const liftPenalty = 1 + 0.012 * Math.max(0, cwSupplyF - 75) - 0.01 * Math.max(0, chwSupplyF - 44)
  const kw = (loadTons * 12) / eerEff * liftPenalty
  return { running: true, outputs: { loadTons: round1(loadTons), plr: round2(plr), chwSupplyF: round1(chwSupplyF) }, kw: round1(kw), therms: 0 }
}

function boilerState(b: EquipmentNode, running: boolean, loadMbh: number): NodeState {
  if (!running || loadMbh <= 0) {
    return { running: false, outputs: { loadMbh: 0 }, kw: 0, therms: 0, blockedBy: running ? undefined : ['No heating call or staged off'] }
  }
  const eff = (b.nameplate.effPct ?? 90) / 100
  const inputMbh = loadMbh / eff
  const thermsPerMin = inputMbh / 100 / 60 // MBH = 1000 Btu/hr; therm = 100,000 Btu
  const parasiticKw = b.nameplate.parasiticKw ?? 1
  return { running: true, outputs: { loadMbh: round1(loadMbh), inputMbh: round1(inputMbh) }, kw: parasiticKw, therms: thermsPerMin }
}

function pumpState(world: SimWorld, p: EquipmentNode, chwLoadTons: number, hwLoadMbh: number): NodeState {
  const variant = (p.variant ?? '').toLowerCase()
  const hp = p.nameplate.hp ?? 10
  const eff = (p.nameplate.effPct ?? 78) / 100
  let loadFrac = 0.6
  if (variant.includes('hw') || variant.includes('hot')) loadFrac = clamp(hwLoadMbh / 1500, 0.2, 1)
  else loadFrac = clamp(chwLoadTons / 150, 0.2, 1)
  const hasVfd = attachedVfd(world, p.id)
  // VFD pumps follow ~ cube law; constant-speed pumps run near full.
  const kw = hasVfd ? (hp * 0.746 / eff) * Math.pow(loadFrac, 2.4) : (hp * 0.746) / eff * 0.95
  const running = loadFrac > 0.05
  // Failed VFD: forced full speed.
  let finalKw = kw
  for (const f of faultsForNode(world.config, p.id)) if (f.kind === 'failed-vfd') finalKw = (hp * 0.746) / eff
  return { running, outputs: { loadPct: round1(loadFrac * 100) }, kw: round1(running ? finalKw : 0), therms: 0 }
}

function towerState(t: EquipmentNode, stage: TowerStage, rejectTons: number): NodeState {
  const fanHp = t.nameplate.fanHp ?? 20
  const kw = (fanHp * 0.746) * Math.pow(stage.stageFrac, 2.5)
  return { running: rejectTons > 0.5, outputs: { cwSupplyF: round1(stage.cwSupplyF), stagePct: round1(stage.stageFrac * 100) }, kw: round1(kw), therms: 0 }
}

function wshpState(
  world: SimWorld,
  w: EquipmentNode,
  zoneCall: Record<string, { cooling: number; heating: number }>,
): NodeState {
  const zoneId = nearestZone(world, w)
  const zc = zoneId ? zoneCall[zoneId] : undefined
  const call = Math.max(zc?.cooling ?? 0, zc?.heating ?? 0)
  const compKw = w.nameplate.compKw ?? 2.4
  const running = call > 0.05
  return { running, outputs: { loadPct: round1(call * 100) }, kw: round1(running ? compKw * clamp(call, 0.3, 1) : 0), therms: 0 }
}

function fcuState(
  world: SimWorld,
  f: EquipmentNode,
  zoneCall: Record<string, { cooling: number; heating: number }>,
): NodeState {
  const zoneId = nearestZone(world, f)
  const zc = zoneId ? zoneCall[zoneId] : undefined
  const call = Math.max(zc?.cooling ?? 0, zc?.heating ?? 0)
  const fanKw = f.nameplate.fanKw ?? 0.5
  const running = call > 0.05 || (zc?.cooling ?? 0) > 0
  return { running, outputs: { loadPct: round1(call * 100) }, kw: round1(running ? fanKw : 0), therms: 0 }
}

// ---------------------------------------------------------------------------
// Zone thermal integration (RC network, 1-minute Euler step)
// ---------------------------------------------------------------------------

function integrateZone(
  world: SimWorld,
  zone: EquipmentNode,
  clock: SimClock,
  weather: Weather,
  zoneCall: Record<string, { cooling: number; heating: number; occupied: boolean; occupants: number }>,
  ahuResults: Record<string, AhuCompute>,
  _nodeStates: Record<string, NodeState>,
): void {
  const np = zone.nameplate
  const area = np.areaSqft ?? 2500
  const C = np.capacitanceBtuF ?? area * 3.6
  const UA = np.envelopeUA ?? area * 0.15
  const t = world.zoneTemp[zone.id] ?? 72
  const zc = zoneCall[zone.id]

  // Envelope conduction.
  const qEnvelope = UA * (weather.oatF - t)
  // Solar gain.
  const qSolar = weather.solarGainFactor * area * 6
  // Internal gains.
  const lighting = (np.lightingWsf ?? 0.9) * area * 3.412
  const plug = (np.plugWsf ?? 1.2) * area * 3.412
  const people = zc.occupants * 250
  const qInternal = zc.occupied ? people + lighting + plug : lighting * 0.15 + plug * 0.3

  // HVAC delivery from the VAV(s) serving this zone.
  let qHvac = 0
  for (const [vavId, zid] of Object.entries(world.index.vavZone)) {
    if (zid !== zone.id) continue
    const vav = world.index.byId[vavId]
    const ahuId = world.index.vavAhu[vavId]
    const r = ahuId ? ahuResults[ahuId] : undefined
    if (!r || !r.running) continue
    const cfm = vavAirflow(world, vav, zc)
    const sat = r.satDeliveredF
    // Cooling (SAT below zone temp).
    qHvac += CP_AIR * cfm * (sat - t)
    // Reheat adds heat at the box.
    if (zc.heating > 0.02 && (vav.nameplate.reheatMbh ?? 0) > 0) {
      qHvac += (vav.nameplate.reheatMbh ?? 0) * 1000 * zc.heating
    }
  }
  // Terminal units (WSHP/FCU) directly on the zone.
  for (const term of [...world.index.wshps, ...world.index.fcus]) {
    if (nearestZone(world, term) !== zone.id) continue
    const cap = (term.nameplate.coolTons ?? 2) * 12000
    if (zc.cooling > 0.02) qHvac -= cap * zc.cooling
    if (zc.heating > 0.02) qHvac += cap * 0.9 * zc.heating
  }

  const qTotal = qEnvelope + qSolar + qInternal + qHvac // Btu/hr
  const dT = (qTotal / C) * (1 / 60) // per minute
  world.zoneTemp[zone.id] = clamp(t + dT, 45, 110)

  // Zone temp sensor drift changes what the thermostat *reads* (affects calls
  // next step); modeled by shifting the stored control temperature slightly.
  // (Applied in reasoning/echo, kept out of the physical state here.)

  // CO2 first-order relaxation toward ventilation equilibrium.
  const oaCfm = totalOaCfmForZone(world, zone.id, ahuResults, zc)
  const equilibrium = OUTDOOR_CO2 + (zc.occupants * 11000) / Math.max(50, oaCfm)
  const tau = 20 // minutes
  const co2 = world.zoneCo2[zone.id] ?? OUTDOOR_CO2
  world.zoneCo2[zone.id] = co2 + (equilibrium - co2) / tau
  void clock
}

function totalOaCfmForZone(
  world: SimWorld,
  zoneId: string,
  ahuResults: Record<string, AhuCompute>,
  zc: { cooling: number; heating: number; occupied: boolean },
): number {
  for (const [vavId, zid] of Object.entries(world.index.vavZone)) {
    if (zid !== zoneId) continue
    const ahuId = world.index.vavAhu[vavId]
    const r = ahuId ? ahuResults[ahuId] : undefined
    if (r && r.running) {
      const vav = world.index.byId[vavId]
      const cfm = vavAirflow(world, vav, zc)
      return Math.max(50, cfm * r.oaFraction)
    }
  }
  return 200
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function scheduleBlock(ahu: EquipmentNode, clock: SimClock): string[] {
  const s = ahu.sequences.schedule
  if (s?.override === 'force-unoccupied') return ['Schedule override: forced unoccupied']
  return [`Schedule is unoccupied at ${pad(clock.hour)}:${pad(clock.minuteOfHour)} (${DAYS[clock.dayOfWeek]})`]
}

function staticPressure(_world: SimWorld, ahu: EquipmentNode, r: AhuCompute): number {
  const sp = ahu.sequences.staticPressureReset
  if (!r.running) return 0
  if (sp?.enabled && sp.strategy === 'trim-respond') {
    const frac = r.designCfm > 0 ? r.totalCfm / r.designCfm : 0
    return round2(lerp(sp.minSetpointInWc, sp.maxSetpointInWc, frac))
  }
  return sp?.fixedSetpointInWc ?? 1.5
}

function fanPower(world: SimWorld, ahu: EquipmentNode, flowFrac: number): number {
  const designKw = ahu.nameplate.fanKw ?? 10
  const hasVfd = attachedVfd(world, ahu.id) || !!ahu.sequences.staticPressureReset?.enabled
  let kw = hasVfd ? designKw * Math.pow(clamp(flowFrac, 0.15, 1), 2.7) : designKw * 0.95
  for (const f of faultsForNode(world.config, ahu.id)) if (f.kind === 'failed-vfd') kw = designKw
  return round1(kw)
}

function foulFactor(world: SimWorld, nodeId: string): number {
  let f = 0
  for (const flt of faultsForNode(world.config, nodeId)) if (flt.kind === 'fouled-coil') f += (flt.params.foulPct ?? 30) / 100
  return f
}

function attachedVfd(world: SimWorld, nodeId: string): boolean {
  // A VFD is "attached" if an electrical connection joins a vfd node to this one.
  return world.config.connections.some((c) => {
    const a = world.index.byId[c.source]
    const b = world.index.byId[c.target]
    return (
      (a?.category === 'vfd' && c.target === nodeId) || (b?.category === 'vfd' && c.source === nodeId)
    )
  })
}

function nearestZone(world: SimWorld, node: EquipmentNode): string | undefined {
  // Air connection from this terminal unit to a zone, else the first zone.
  for (const c of world.config.connections) {
    if (c.kind !== 'air') continue
    if (c.source === node.id && world.index.byId[c.target]?.category === 'zone') return c.target
    if (c.target === node.id && world.index.byId[c.source]?.category === 'zone') return c.source
  }
  return world.index.zones[0]?.id
}

function leadLagOrder(world: SimWorld, units: EquipmentNode[], bankId: string): EquipmentNode[] {
  const ordered = [...units].sort((a, b) => (a.sequences.staging?.order ?? 0) - (b.sequences.staging?.order ?? 0))
  const offset = world.rotation[bankId] ?? 0
  if (offset === 0 || ordered.length < 2) return ordered
  return [...ordered.slice(offset % ordered.length), ...ordered.slice(0, offset % ordered.length)]
}

function respectsTimers(world: SimWorld, id: string, clock: SimClock, staging?: EquipmentNode['sequences']['staging']): boolean {
  const timer = world.timers[id]
  if (!timer) return true
  const minOff = staging?.minOffTimeMin ?? 0
  if (!timer.running && clock.minute - timer.lastChangeMin < minOff) return false
  return true
}

function setTimers(world: SimWorld, units: EquipmentNode[], running: Set<string>, clock: SimClock): void {
  for (const u of units) {
    const timer = world.timers[u.id]
    const nowRunning = running.has(u.id)
    if (timer.running !== nowRunning) {
      timer.running = nowRunning
      timer.lastChangeMin = clock.minute
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1)
}
function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}
function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
