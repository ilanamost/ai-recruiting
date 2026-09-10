import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // CI passes the GitHub Pages project-page path (e.g. '/ai-dev-agents/') via VITE_BASE_PATH.
  // Local dev/preview/build get '/' — read from process.env, not import.meta.env, because this
  // config is evaluated by Node before Vite's env loading exists.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts']
  }
})
