import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The simulation runs in a Web Worker (see src/sim/engine.worker.ts) so the UI
// stays responsive at high speed multipliers.
//
// `--mode standalone` (with VITE_LOCAL_ENGINE=1) emits a single self-contained
// index.html — everything inlined — for hosting the app as one clickable page.
// In that mode the sim runs on the main thread (see src/sim/localEngine.ts),
// since a hosted page's security policy may forbid spawning a Worker.
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone'
  return {
    plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
    worker: {
      format: 'es',
    },
  }
})
