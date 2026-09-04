import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// The API runs as a separate process in development. Proxying /api through the
// dev server keeps the browser on one origin, so the session cookie behaves in
// development exactly as it will behind a single domain in production.
// `--mode demo` (with VITE_DEMO=1) emits one self-contained index.html running
// against captured API responses — no server, no ESPM account, no terminal.
// Same idea as the BAS trainer's `build:standalone`.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['API_ORIGIN'] ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
}))
