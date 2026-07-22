import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The simulation runs in a Web Worker (see src/sim/engine.worker.ts) so the UI
// stays responsive at high speed multipliers. Vite handles worker bundling via
// the `?worker` import suffix; no extra config required.
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
})
