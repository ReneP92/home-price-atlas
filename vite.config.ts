import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1600 },
})
