import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  // Mapbox's official CSP build keeps its worker out of the main SDK chunk.
  resolve: {
    alias: [
      {
        find: /^mapbox-gl$/,
        replacement: fileURLToPath(
          new URL('./node_modules/mapbox-gl/dist/mapbox-gl-csp.js', import.meta.url),
        ),
      },
    ],
  },
  test: { include: ['src/**/*.test.ts'] },
  // Mapbox's lazily loaded CSP SDK is about 1.8 MB minified, with a separate worker.
  build: { chunkSizeWarningLimit: 2000 },
})
