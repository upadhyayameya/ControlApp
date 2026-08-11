// ---------------------------------------------------------------------------
// Main-thread engine. Presents the same interface as a Web Worker (postMessage
// + onmessage) but runs the shared engine core in-process. Used by the fully
// self-contained hosted build, where a hosted page's security policy may not
// permit spawning a Worker. The physics are identical to the worker path.
// ---------------------------------------------------------------------------

import type { WorkerInbound, WorkerOutbound } from '../types/domain'
import { createEngineCore, EngineCore } from './engineCore'

export class LocalEngine {
  onmessage: ((e: MessageEvent<WorkerOutbound>) => void) | null = null
  private core: EngineCore

  constructor() {
    this.core = createEngineCore((msg) => {
      // Deliver asynchronously so callers see worker-like ordering (the store
      // posts, then its onmessage fires on a later microtask).
      queueMicrotask(() => this.onmessage?.({ data: msg } as MessageEvent<WorkerOutbound>))
    })
  }

  postMessage(msg: WorkerInbound) {
    this.core.handle(msg)
  }

  terminate() {
    this.core.dispose()
  }
}
