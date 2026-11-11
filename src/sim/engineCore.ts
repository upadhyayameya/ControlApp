// ---------------------------------------------------------------------------
// Engine core — the tick loop and message handling, shared by the Web Worker
// (engine.worker.ts) and the main-thread engine (localEngine.ts). Owns the
// SimWorld, advances it on a fixed 1-minute timestep, and emits snapshots +
// trend rows through the injected `post` callback. Extracting it here means the
// physics and the message protocol are identical whether the sim runs off-
// thread (normal app) or on-thread (self-contained hosted build).
// ---------------------------------------------------------------------------

import type { Alarm, SimSnapshot, SpeedMultiplier, TrendSample, WorkerInbound, WorkerOutbound } from '../types/domain'
import { step } from './model'
import { evaluateAlarms, explainWhyNotRunning } from './reasoning'
import { createWorld, SimWorld } from './world'

const TICK_MS = 100 // batch cadence
const MAX_STEPS_PER_TICK = 240 // hard ceiling on sim-minutes per batch

export interface EngineCore {
  handle: (msg: WorkerInbound) => void
  dispose: () => void
}

export function createEngineCore(post: (msg: WorkerOutbound) => void): EngineCore {
  let world: SimWorld | null = null
  let speed: SpeedMultiplier = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let lastSnapshot: SimSnapshot | null = null
  const alarmRegistry = new Map<string, Alarm>()

  function stepsForSpeed(): number {
    switch (speed) {
      case 0:
        return 0
      case 1:
        return 1
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
    post({ type: 'snapshot', snapshot: last.snapshot, trends })
  }

  function ensureTimer() {
    if (timer) return
    timer = setInterval(runBatch, TICK_MS)
  }

  function emitOnce(last: { snapshot: SimSnapshot; trend: TrendSample }) {
    last.snapshot.alarms = reconcileAlarms(evaluateAlarms(world!, last.snapshot), last.snapshot.clock.minute)
    lastSnapshot = last.snapshot
    post({ type: 'snapshot', snapshot: last.snapshot, trends: [last.trend] })
  }

  function handle(msg: WorkerInbound) {
    switch (msg.type) {
      case 'init':
      case 'load-config': {
        world = createWorld(msg.config)
        alarmRegistry.clear()
        ensureTimer()
        emitOnce(step(world))
        break
      }
      case 'set-speed':
        speed = msg.speed
        break
      case 'jump': {
        if (!world) break
        let last: ReturnType<typeof step> | null = null
        for (let i = 0; i < msg.minutes; i++) last = step(world)
        if (last) emitOnce(last)
        break
      }
      case 'set-time': {
        if (!world) break
        const target = Math.max(0, msg.minute)
        world.minute = Math.max(0, target - 720)
        let last: ReturnType<typeof step> | null = null
        for (let i = 0; i < 720; i++) last = step(world)
        if (last) emitOnce(last)
        break
      }
      case 'update-faults':
        if (world) world.config = { ...world.config, faults: msg.faults }
        break
      case 'update-sequences':
      case 'update-setpoint':
        if (world) {
          const node = world.index.byId[msg.nodeId]
          if (node) node.sequences = msg.sequences
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

  return {
    handle,
    dispose: () => {
      if (timer) clearInterval(timer)
      timer = null
      world = null
    },
  }
}
