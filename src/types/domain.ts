// ---------------------------------------------------------------------------
// HBS BAS Simulation Trainer — core domain model
//
// The whole app is driven by a single `SystemConfig` (the equipment the
// engineer placed and wired) plus a `SimState` (the live values the engine
// produces every simulated minute). Keeping these two separate is what lets us
// serialize a system to JSON, hand it to a Web Worker, and diff a baseline run
// against a modified run.
// ---------------------------------------------------------------------------

export type EquipmentCategory =
  | 'chiller'
  | 'boiler'
  | 'ahu'
  | 'rtu'
  | 'fcu'
  | 'wshp'
  | 'hx'
  | 'pump'
  | 'coolingTower'
  | 'vav'
  | 'zone'
  | 'sensor'
  | 'vfd'
  | 'other'

/** The three physically distinct connection media, rendered as distinct colors. */
export type PortKind = 'air' | 'water' | 'electrical'

/**
 * Water ports carry a sub-medium so we can reject nonsense like tying a boiler
 * to a chilled-water loop. `supply`/`return`/`oa`/`ea`/`sa`/`ra` refine air.
 */
export type PortMedium =
  | 'chw' // chilled water
  | 'hw' // hot water
  | 'cw' // condenser water
  | 'sa' // supply air
  | 'ra' // return air
  | 'oa' // outside air
  | 'ea' // exhaust air
  | 'elec' // electrical

export type PortDirection = 'in' | 'out'

export interface Port {
  id: string
  label: string
  kind: PortKind
  medium: PortMedium
  direction: PortDirection
}

/**
 * Nameplate data is intentionally a loose numeric bag so every category can
 * carry whatever fields make sense (tons, MBH, CFM, GPM, kW, EER, HP …) while
 * the inspector renders them generically. `NameplateField` describes one entry
 * for the UI.
 */
export type Nameplate = Record<string, number>

export interface NameplateField {
  key: string
  label: string
  unit: string
  /** Sensible starting value when the field is missing. */
  default: number
  step?: number
}

/** A curated, real-world catalog entry that pre-fills plausible defaults. */
export interface CatalogModel {
  id: string
  manufacturer: string
  model: string
  category: EquipmentCategory
  /** e.g. "air-cooled", "condensing", "plate-and-frame". */
  variant?: string
  nameplate: Nameplate
  notes?: string
}

// --- Control sequences -----------------------------------------------------

export type ResetStrategy = 'fixed' | 'oat' | 'load' | 'trim-respond'
export type EconomizerType = 'none' | 'dry-bulb' | 'enthalpy' | 'differential' | 'fixed-min'

export interface DischargeAirReset {
  enabled: boolean
  strategy: Extract<ResetStrategy, 'fixed' | 'oat' | 'trim-respond'>
  fixedSetpointF: number
  /** OAT-based: sat = highSat at oatLow, lowSat at oatHigh (inverse map). */
  oatLowF: number
  oatHighF: number
  satAtLowF: number
  satAtHighF: number
}

export interface EconomizerReset {
  enabled: boolean
  type: EconomizerType
  minOaPct: number
  highLimitOatF: number // lockout above this dry-bulb
  highLimitEnthalpy: number // Btu/lb for enthalpy/differential modes
}

export interface StaticPressureReset {
  enabled: boolean
  strategy: Extract<ResetStrategy, 'fixed' | 'trim-respond'>
  fixedSetpointInWc: number
  minSetpointInWc: number
  maxSetpointInWc: number
}

export interface WaterReset {
  enabled: boolean
  strategy: ResetStrategy
  fixedSetpointF: number
  oatLowF: number
  oatHighF: number
  satAtLowF: number
  satAtHighF: number
}

export interface OccupancySchedule {
  enabled: boolean
  weekdayStartHr: number
  weekdayEndHr: number
  weekendStartHr: number
  weekendEndHr: number
  weekendOccupied: boolean
  /** Manual override forces occupied regardless of schedule. */
  override: 'none' | 'force-occupied' | 'force-unoccupied'
}

export interface OptimalStartStop {
  enabled: boolean
  /** Adaptive warm-up / cool-down rate learned from prior mornings (°F/hr). */
  learnedWarmupRate: number
  learnedCooldownRate: number
  maxLeadTimeMin: number
}

export interface DemandControlVentilation {
  enabled: boolean
  co2SetpointPpm: number
  minOaPct: number
  maxOaPct: number
}

export interface StagingRotation {
  enabled: boolean
  /** Position in a lead/lag bank; 0 = lead. */
  order: number
  /** Bank id shared by units that stage together. */
  bankId: string
  stageUpLoadPct: number
  stageDownLoadPct: number
  minRuntimeMin: number
  minOffTimeMin: number
  rotationHours: number
}

export interface Setpoints {
  zoneCoolingF: number
  zoneHeatingF: number
  deadbandF: number
}

/** Every field optional so a node only carries the sequences it uses. */
export interface ControlSequences {
  dischargeAirReset?: DischargeAirReset
  economizer?: EconomizerReset
  staticPressureReset?: StaticPressureReset
  chwReset?: WaterReset
  hwReset?: WaterReset
  cwReset?: WaterReset
  schedule?: OccupancySchedule
  optimalStart?: OptimalStartStop
  dcv?: DemandControlVentilation
  staging?: StagingRotation
  setpoints?: Setpoints
}

// --- Faults (instructor-injected) ------------------------------------------

export type FaultKind =
  | 'stuck-damper'
  | 'drifted-sensor'
  | 'leaking-valve'
  | 'failed-vfd'
  | 'fouled-coil'
  | 'schedule-override'
  | 'seized-actuator'

export interface Fault {
  id: string
  kind: FaultKind
  targetNodeId: string
  enabled: boolean
  /** Free-form params: e.g. { stuckPct: 100 }, { driftF: -20 }. */
  params: Record<string, number>
  /** Instructor-facing description of the intended teaching point. */
  note?: string
}

// --- Placed equipment & connections ----------------------------------------

export interface EquipmentNode {
  id: string
  category: EquipmentCategory
  name: string
  manufacturer: string
  model: string
  variant?: string
  catalogId?: string
  nameplate: Nameplate
  ports: Port[]
  sequences: ControlSequences
  position: { x: number; y: number }
  /** Sensor-only: which point it reads and its host node. */
  sensor?: { measures: SensorMeasure; hostNodeId?: string }
  /** For zones: floor area used in cost-per-sqft and RC sizing. */
  areaSqft?: number
}

export type SensorMeasure = 'temp' | 'pressure' | 'flow' | 'co2' | 'occupancy'

export interface Connection {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
  kind: PortKind
  medium: PortMedium
}

export interface SystemConfig {
  id: string
  name: string
  nodes: EquipmentNode[]
  connections: Connection[]
  /** Building-wide settings. */
  building: BuildingConfig
  faults: Fault[]
  version: number
}

export interface BuildingConfig {
  city: string
  /** Simple sine-wave outdoor-air model (used when TMY3 not loaded). */
  weather: {
    mode: 'sine' | 'tmy3'
    meanOatF: number
    dailyAmplitudeF: number
    seasonalAmplitudeF: number
    meanRhPct: number
    tmy3City?: string
  }
  electricRatePerKwh: number
  gasRatePerTherm: number
  totalAreaSqft: number
}

// --- Live simulation state --------------------------------------------------

/** Runtime values for one node, produced fresh each simulated minute. */
export interface NodeState {
  running: boolean
  /** 0..1 loading / valve / damper positions and the like. */
  outputs: Record<string, number>
  kw: number
  therms: number // per-minute therm draw for gas equipment
  /** Human-readable reason the node is NOT running, when applicable. */
  blockedBy?: string[]
}

export interface Alarm {
  id: string
  nodeId: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  /** The multi-sentence "why", the core training payload. */
  reasoning: string
  /** Structured evidence chain the reasoning was built from. */
  evidence: string[]
  suggestedCheck: string
  raisedAtMin: number
  active: boolean
}

export interface SimClock {
  /** Simulated minutes elapsed since the epoch start (day 0, 00:00). */
  minute: number
  dayOfWeek: number // 0=Sun
  hour: number
  minuteOfHour: number
  dayIndex: number
  dateLabel: string
}

export interface Weather {
  oatF: number
  rhPct: number
  enthalpy: number // Btu/lb moist air
  solarGainFactor: number // 0..1 crude solar driver
}

export interface ZoneRuntime {
  nodeId: string
  tempF: number
  co2Ppm: number
  occupied: boolean
  occupants: number
  coolingCall: number // 0..1
  heatingCall: number // 0..1
}

export interface SimSnapshot {
  clock: SimClock
  weather: Weather
  nodeStates: Record<string, NodeState>
  zones: ZoneRuntime[]
  /** Plant water temps and other shared loop values. */
  loops: {
    chwSupplyF: number
    chwReturnF: number
    hwSupplyF: number
    hwReturnF: number
    cwSupplyF: number
    cwReturnF: number
  }
  alarms: Alarm[]
  totals: {
    kw: number
    thermsPerHr: number
    costPerHr: number
  }
}

/** One row logged to the trend historian each sim step. */
export interface TrendSample {
  minute: number
  values: Record<string, number>
}

export type SpeedMultiplier = 0 | 1 | 10 | 100 | 1000

// --- Worker message protocol ------------------------------------------------

export type WorkerInbound =
  | { type: 'init'; config: SystemConfig }
  | { type: 'load-config'; config: SystemConfig }
  | { type: 'set-speed'; speed: SpeedMultiplier }
  | { type: 'jump'; minutes: number }
  | { type: 'set-time'; minute: number }
  | { type: 'update-faults'; faults: Fault[] }
  | { type: 'update-sequences'; nodeId: string; sequences: ControlSequences }
  | { type: 'update-setpoint'; nodeId: string; sequences: ControlSequences }
  | { type: 'why-not-running'; nodeId: string; requestId: string }
  | { type: 'reset' }

export type WorkerOutbound =
  | { type: 'snapshot'; snapshot: SimSnapshot; trends: TrendSample[] }
  | { type: 'why-not-running-result'; requestId: string; nodeId: string; explanation: WhyNotRunning }

export interface WhyNotRunning {
  nodeId: string
  running: boolean
  headline: string
  /** Ordered interlock checks, each pass/fail with a plain-English reason. */
  chain: { label: string; ok: boolean; detail: string }[]
}
