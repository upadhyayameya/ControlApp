import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs as a separate process in development. Proxying /api through the
// dev server keeps the browser on one origin, so the session cookie behaves in
// development exactly as it will behind a single domain in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['API_ORIGIN'] ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
