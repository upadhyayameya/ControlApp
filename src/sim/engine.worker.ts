// ---------------------------------------------------------------------------
// Simulation Web Worker. Owns the SimWorld, ticks it on a fixed 1-minute
// timestep, and streams snapshots + trend rows to the UI. Running here keeps
// the main thread free so the workstation UI stays responsive even at 1000x.
//
// Speed multipliers map to how many sim-minutes to advance per animation frame
// batch; we cap wall-clock work per tick so a 1000x run can't lock the worker.
// ---------------------------------------------------------------------------

import type {
  Alarm,
  SimSnapshot,
  SpeedMultiplier,
  TrendSample,
  WorkerInbound,
  WorkerOutbound,
} from '../types/domain'
import { step } from './model'
import { evaluateAlarms, explainWhyNotRunning } from './reasoning'
import { createWorld, SimWorld } from './world'

let world: SimWorld | null = null
let speed: SpeedMultiplier = 0
let timer: ReturnType<typeof setInterval> | null = null
let lastSnapshot: SimSnapshot | null = null

/** Alarm registry so `raisedAtMin` is stable while an alarm stays active. */
const alarmRegistry = new Map<string, Alarm>()

const TICK_MS = 100 // batch cadence
const MAX_STEPS_PER_TICK = 240 // hard ceiling on sim-minutes per batch

function post(msg: WorkerOutbound) {
  ;(self as unknown as Worker).postMessage(msg)
}

function stepsForSpeed(): number {
  switch (speed) {
    case 0:
      return 0
    case 1:
      return 1 // ~1 sim-min per 100ms → fast but visible "real-ish" time
    case 10:
      return 4
    case 100:
      return 40
    case 1000:
      return MAX_STEPS_PER_TICK
    default:
      return 0
  }
}

function runBatch() {
  if (!world) return
  const n = stepsForSpeed()
  if (n <= 0) return
  let last: { snapshot: SimSnapshot; trend: TrendSample } | null = null
  const trends: TrendSample[] = []
  for (let i = 0; i < n; i++) {
    last = step(world)
    trends.push(last.trend)
  }
  if (!last) return
  last.snapshot.alarms = reconcileAlarms(evaluateAlarms(world, last.snapshot), last.snapshot.clock.minute)
  lastSnapshot = last.snapshot
  // One message per batch carries the final snapshot plus every 1-minute trend
  // row, so the historian keeps full resolution even at 1000x without flooding
  // the main thread with duplicate snapshots.
  post({ type: 'snapshot', snapshot: last.snapshot, trends })
}

function reconcileAlarms(fresh: Alarm[], minute: number): Alarm[] {
  const seen = new Set<string>()
  const out: Alarm[] = []
  for (const a of fresh) {
    seen.add(a.id)
    const prior = alarmRegistry.get(a.id)
    const merged: Alarm = prior ? { ...a, raisedAtMin: prior.raisedAtMin } : { ...a, raisedAtMin: minute }
    alarmRegistry.set(a.id, merged)
    out.push(merged)
  }
  for (const id of [...alarmRegistry.keys()]) if (!seen.has(id)) alarmRegistry.delete(id)
  return out
}

function ensureTimer() {
  if (timer) return
  timer = setInterval(runBatch, TICK_MS)
}

self.onmessage = (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
    case 'load-config': {
      world = createWorld(msg.config)
      alarmRegistry.clear()
      ensureTimer()
      // Emit an initial snapshot immediately so the UI paints before play.
      const first = step(world)
      first.snapshot.alarms = reconcileAlarms(evaluateAlarms(world, first.snapshot), first.snapshot.clock.minute)
      lastSnapshot = first.snapshot
      post({ type: 'snapshot', snapshot: first.snapshot, trends: [first.trend] })
      break
    }
    case 'set-speed':
      speed = msg.speed
      break
    case 'jump': {
      if (!world) break
      let last: ReturnType<typeof step> | null = null
      for (let i = 0; i < msg.minutes; i++) last = step(world)
      if (last) {
        last.snapshot.alarms = reconcileAlarms(evaluateAlarms(world, last.snapshot), last.snapshot.clock.minute)
        lastSnapshot = last.snapshot
        post({ type: 'snapshot', snapshot: last.snapshot, trends: [last.trend] })
      }
      break
    }
    case 'update-faults':
      if (world) world.config = { ...world.config, faults: msg.faults }
      break
    case 'update-sequences':
    case 'update-setpoint':
      if (world) {
        const node = world.index.byId[msg.nodeId]
        if (node) {
          node.sequences = msg.sequences
        }
      }
      break
    case 'why-not-running': {
      if (!world) break
      const snap = lastSnapshot ?? step(world).snapshot
      const explanation = explainWhyNotRunning(world, snap, msg.nodeId)
      post({ type: 'why-not-running-result', requestId: msg.requestId, nodeId: msg.nodeId, explanation })
      break
    }
    case 'reset':
      if (world) {
        world = createWorld(world.config)
        alarmRegistry.clear()
      }
      break
  }
}
