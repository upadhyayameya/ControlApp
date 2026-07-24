// ---------------------------------------------------------------------------
// Application store (Zustand). Owns the editable SystemConfig, the live
// simulation snapshot streamed from the Web Worker, the trend historian, and
// every command the UI issues. The worker is the single source of physics
// truth; the store mirrors config into it on every edit.
// ---------------------------------------------------------------------------

import { create } from 'zustand'
import EngineWorker from '../sim/engine.worker.ts?worker'
import type {
  ControlSequences,
  EquipmentCategory,
  EquipmentNode,
  Fault,
  FaultKind,
  SimSnapshot,
  SpeedMultiplier,
  TrendSample,
  WhyNotRunning,
  WorkerOutbound,
} from '../types/domain'
import { createNode, CreateNodeOptions, connect as makeConn } from '../data/factory'
import { buildSeedSystem } from '../data/seed'
import { DRILLS } from '../data/drills'
import { validateConnection } from '../data/validate'
import type { SystemConfig } from '../types/domain'

const TREND_CAP = 20160 // ~14 days at 1-minute resolution
const PROJECT_INDEX = 'hbs-bas-projects'
const PROJECT_PREFIX = 'hbs-bas-project:'

function listSavedProjects(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROJECT_INDEX)
    const names = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(names) ? names.filter((n) => typeof n === 'string').sort() : []
  } catch {
    return []
  }
}

export interface BaselineCapture {
  label: string
  trends: TrendSample[]
  atMinute: number
}

interface StoreState {
  config: SystemConfig
  snapshot: SimSnapshot | null
  trends: TrendSample[]
  speed: SpeedMultiplier
  selectedNodeId: string | null
  why: WhyNotRunning | null
  whyLoading: boolean
  baseline: BaselineCapture | null
  connectError: string | null
  theme: 'dark' | 'light'
  activePanel: 'alarms' | 'trends' | 'energy' | 'instructor'

  // lifecycle
  initEngine: () => void
  reloadWorker: () => void

  // editing
  addNode: (category: EquipmentCategory, opts?: CreateNodeOptions) => void
  deleteNode: (id: string) => void
  moveNode: (id: string, position: { x: number; y: number }) => void
  updateNode: (id: string, patch: Partial<EquipmentNode>) => void
  updateNameplate: (id: string, key: string, value: number) => void
  updateSequences: (id: string, sequences: ControlSequences) => void
  applyCatalog: (id: string, catalogId: string) => void
  tryConnect: (source: string, sourcePort: string, target: string, targetPort: string) => void
  deleteConnection: (id: string) => void
  clearConnectError: () => void

  // simulation
  setSpeed: (s: SpeedMultiplier) => void
  jump: (minutes: number) => void
  seekTime: (minute: number) => void
  resetSim: () => void

  // training drills
  activeDrillId: string | null
  loadDrill: (id: string) => void

  // faults
  addFault: (kind: FaultKind, targetNodeId: string, params?: Record<string, number>, note?: string) => void
  toggleFault: (id: string, enabled: boolean) => void
  updateFaultParams: (id: string, params: Record<string, number>) => void
  deleteFault: (id: string) => void

  // reasoning
  select: (id: string | null) => void
  askWhy: (id: string) => void

  // baseline
  captureBaseline: (label: string) => void
  clearBaseline: () => void

  // persistence
  newSystem: () => void
  loadConfig: (config: SystemConfig) => void
  exportJSON: () => string
  setProjectName: (name: string) => void
  savedProjects: string[]
  saveProject: () => void
  loadProject: (name: string) => void
  deleteProject: (name: string) => void

  // ui
  setPanel: (p: StoreState['activePanel']) => void
  toggleTheme: () => void
}

let worker: Worker | null = null
const whyResolvers = new Map<string, (w: WhyNotRunning) => void>()

function spawnWorker(get: () => StoreState, set: (p: Partial<StoreState>) => void) {
  const w = new EngineWorker()
  w.onmessage = (e: MessageEvent<WorkerOutbound>) => {
    const msg = e.data
    if (msg.type === 'snapshot') {
      const prev = get().trends
      const merged = prev.concat(msg.trends)
      const trimmed = merged.length > TREND_CAP ? merged.slice(merged.length - TREND_CAP) : merged
      set({ snapshot: msg.snapshot, trends: trimmed })
    } else if (msg.type === 'why-not-running-result') {
      set({ why: msg.explanation, whyLoading: false })
      whyResolvers.get(msg.requestId)?.(msg.explanation)
      whyResolvers.delete(msg.requestId)
    }
  }
  return w
}

function pushConfig(config: SystemConfig) {
  worker?.postMessage({ type: 'load-config', config })
}

export const useStore = create<StoreState>((set, get) => ({
  config: buildSeedSystem(),
  snapshot: null,
  trends: [],
  speed: 0,
  selectedNodeId: null,
  why: null,
  whyLoading: false,
  baseline: null,
  connectError: null,
  theme: 'dark',
  activePanel: 'alarms',

  initEngine: () => {
    if (worker) return
    worker = spawnWorker(get, (p) => set(p))
    worker.postMessage({ type: 'init', config: get().config })
    worker.postMessage({ type: 'set-speed', speed: get().speed })
  },

  reloadWorker: () => {
    set({ trends: [], baseline: null })
    pushConfig(get().config)
    worker?.postMessage({ type: 'set-speed', speed: get().speed })
  },

  addNode: (category, opts) => {
    const node = createNode(category, opts)
    const config = { ...get().config, nodes: [...get().config.nodes, node] }
    set({ config, selectedNodeId: node.id })
    get().reloadWorker()
  },

  deleteNode: (id) => {
    const config = get().config
    const nodes = config.nodes.filter((n) => n.id !== id)
    const connections = config.connections.filter((c) => c.source !== id && c.target !== id)
    const faults = config.faults.filter((f) => f.targetNodeId !== id)
    set({
      config: { ...config, nodes, connections, faults },
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    })
    get().reloadWorker()
  },

  moveNode: (id, position) => {
    // Position-only edits don't need a worker reload (physics is unaffected).
    const nodes = get().config.nodes.map((n) => (n.id === id ? { ...n, position } : n))
    set({ config: { ...get().config, nodes } })
  },

  updateNode: (id, patch) => {
    const nodes = get().config.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
    set({ config: { ...get().config, nodes } })
    get().reloadWorker()
  },

  updateNameplate: (id, key, value) => {
    const nodes = get().config.nodes.map((n) =>
      n.id === id ? { ...n, nameplate: { ...n.nameplate, [key]: value } } : n,
    )
    set({ config: { ...get().config, nodes } })
    get().reloadWorker()
  },

  updateSequences: (id, sequences) => {
    const nodes = get().config.nodes.map((n) => (n.id === id ? { ...n, sequences } : n))
    set({ config: { ...get().config, nodes } })
    worker?.postMessage({ type: 'update-sequences', nodeId: id, sequences })
  },

  applyCatalog: (id, catalogId) => {
    const node = get().config.nodes.find((n) => n.id === id)
    if (!node) return
    const fresh = createNode(node.category, { catalogId, name: node.name })
    get().updateNode(id, {
      manufacturer: fresh.manufacturer,
      model: fresh.model,
      variant: fresh.variant,
      catalogId,
      nameplate: fresh.nameplate,
    })
  },

  tryConnect: (source, sourcePort, target, targetPort) => {
    const config = get().config
    const s = config.nodes.find((n) => n.id === source)
    const t = config.nodes.find((n) => n.id === target)
    if (!s || !t) return
    const sp = s.ports.find((p) => p.id === sourcePort)
    const tp = t.ports.find((p) => p.id === targetPort)
    if (!sp || !tp) return
    // Normalize so the wire always runs output → input.
    let src = s
    let srcP = sp
    let dst = t
    let dstP = tp
    if (sp.direction === 'in' && tp.direction === 'out') {
      src = t
      srcP = tp
      dst = s
      dstP = sp
    }
    const result = validateConnection(config, src, srcP, dst, dstP)
    if (!result.ok) {
      set({ connectError: result.reason ?? 'Invalid connection.' })
      return
    }
    const conn = makeConn(src, srcP.id, dst, dstP.id)
    if (!conn) return
    set({ config: { ...config, connections: [...config.connections, conn] }, connectError: null })
    get().reloadWorker()
  },

  deleteConnection: (id) => {
    const config = get().config
    set({ config: { ...config, connections: config.connections.filter((c) => c.id !== id) } })
    get().reloadWorker()
  },

  clearConnectError: () => set({ connectError: null }),

  setSpeed: (s) => {
    set({ speed: s })
    worker?.postMessage({ type: 'set-speed', speed: s })
  },

  jump: (minutes) => {
    worker?.postMessage({ type: 'jump', minutes })
  },

  seekTime: (minute) => {
    set({ trends: [], baseline: null })
    worker?.postMessage({ type: 'set-time', minute })
  },

  activeDrillId: null,

  loadDrill: (id) => {
    const drill = DRILLS.find((d) => d.id === id)
    if (!drill) return
    const config = buildSeedSystem()
    drill.apply(config)
    set({ config, selectedNodeId: null, why: null, trends: [], baseline: null, activeDrillId: id, activePanel: 'alarms' })
    pushConfig(config)
    worker?.postMessage({ type: 'set-time', minute: drill.startMinute })
  },

  resetSim: () => {
    set({ trends: [], baseline: null })
    worker?.postMessage({ type: 'reset' })
    pushConfig(get().config)
  },

  addFault: (kind, targetNodeId, params = {}, note) => {
    const fault: Fault = {
      id: `flt-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      targetNodeId,
      enabled: true,
      params: { ...defaultFaultParams(kind), ...params },
      note,
    }
    const faults = [...get().config.faults, fault]
    set({ config: { ...get().config, faults } })
    worker?.postMessage({ type: 'update-faults', faults })
  },

  toggleFault: (id, enabled) => {
    const faults = get().config.faults.map((f) => (f.id === id ? { ...f, enabled } : f))
    set({ config: { ...get().config, faults } })
    worker?.postMessage({ type: 'update-faults', faults })
  },

  updateFaultParams: (id, params) => {
    const faults = get().config.faults.map((f) => (f.id === id ? { ...f, params: { ...f.params, ...params } } : f))
    set({ config: { ...get().config, faults } })
    worker?.postMessage({ type: 'update-faults', faults })
  },

  deleteFault: (id) => {
    const faults = get().config.faults.filter((f) => f.id !== id)
    set({ config: { ...get().config, faults } })
    worker?.postMessage({ type: 'update-faults', faults })
  },

  select: (id) => set({ selectedNodeId: id, why: null }),

  askWhy: (id) => {
    const requestId = `why-${Math.random().toString(36).slice(2, 8)}`
    set({ whyLoading: true, why: null })
    worker?.postMessage({ type: 'why-not-running', nodeId: id, requestId })
  },

  captureBaseline: (label) => {
    set({ baseline: { label, trends: [...get().trends], atMinute: get().snapshot?.clock.minute ?? 0 } })
  },
  clearBaseline: () => set({ baseline: null }),

  newSystem: () => {
    const config = buildSeedSystem()
    set({ config, selectedNodeId: null, why: null, activeDrillId: null })
    get().reloadWorker()
  },

  loadConfig: (config) => {
    set({ config, selectedNodeId: null, why: null, trends: [], baseline: null, activeDrillId: null })
    pushConfig(config)
  },

  exportJSON: () => JSON.stringify(get().config, null, 2),

  setProjectName: (name) => {
    set({ config: { ...get().config, name } })
  },

  savedProjects: listSavedProjects(),

  saveProject: () => {
    const config = get().config
    const name = (config.name || 'Untitled').trim() || 'Untitled'
    // Persist the current name onto the config so a reload restores it.
    const toSave = { ...config, name }
    try {
      localStorage.setItem(PROJECT_PREFIX + name, JSON.stringify(toSave))
      const names = Array.from(new Set([...listSavedProjects(), name])).sort()
      localStorage.setItem(PROJECT_INDEX, JSON.stringify(names))
      set({ config: toSave, savedProjects: names })
    } catch {
      /* storage full or unavailable */
    }
  },

  loadProject: (name) => {
    try {
      const raw = localStorage.getItem(PROJECT_PREFIX + name)
      if (!raw) return
      const config = JSON.parse(raw) as SystemConfig
      get().loadConfig(config)
    } catch {
      /* corrupt entry */
    }
  },

  deleteProject: (name) => {
    try {
      localStorage.removeItem(PROJECT_PREFIX + name)
      const names = listSavedProjects().filter((n) => n !== name)
      localStorage.setItem(PROJECT_INDEX, JSON.stringify(names))
      set({ savedProjects: names })
    } catch {
      /* ignore */
    }
  },

  setPanel: (p) => set({ activePanel: p }),
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark'
    set({ theme })
    document.documentElement.classList.toggle('dark', theme === 'dark')
  },
}))

function defaultFaultParams(kind: FaultKind): Record<string, number> {
  switch (kind) {
    case 'stuck-damper':
      return { stuckPct: 100 }
    case 'drifted-sensor':
      return { driftF: -20 }
    case 'leaking-valve':
      return { leakPct: 20 }
    case 'fouled-coil':
      return { foulPct: 40 }
    case 'seized-actuator':
      return { stuckPct: 30 }
    case 'failed-vfd':
      return {}
    case 'schedule-override':
      return {}
  }
}
