import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The SPA calls /api/v1 relatively: nginx routes it in production, and this
  // proxy is what keeps an absolute host out of the sources in development.
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:21610', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    restoreMocks: true,
  },
})
