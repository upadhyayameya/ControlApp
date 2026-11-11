// ---------------------------------------------------------------------------
// Simulation Web Worker — a thin wrapper around the shared engine core so the
// sim runs off the main thread, keeping the workstation UI responsive at high
// speed multipliers. All logic lives in engineCore.ts.
// ---------------------------------------------------------------------------

import type { WorkerInbound } from '../types/domain'
import { createEngineCore } from './engineCore'

const core = createEngineCore((msg) => (self as unknown as Worker).postMessage(msg))
self.onmessage = (e: MessageEvent<WorkerInbound>) => core.handle(e.data)
