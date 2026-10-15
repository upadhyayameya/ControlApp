import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'standalone' ? [viteSingleFile()] : [])],
  build: { outDir: 'dist', emptyOutDir: true },
}))
