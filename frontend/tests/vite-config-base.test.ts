// @vitest-environment node
// vite.config.ts reads process.env at module scope and calls fileURLToPath(import.meta.url),
// which needs a real file: URL — so this spec runs in the node environment rather than jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// .plan/025: `base` is what makes the same source build for both the domain root and a GitHub
// Pages project page. Getting it wrong produces asset URLs that only 404 after deploy.
describe('vite config base', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to the domain root when VITE_BASE_PATH is unset', async () => {
    vi.stubEnv('VITE_BASE_PATH', undefined)

    const { default: config } = await import('../vite.config')

    expect(config.base).toBe('/')
  })

  it('uses VITE_BASE_PATH when CI supplies a project-page path', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/ai-dev-agents/')

    const { default: config } = await import('../vite.config')

    expect(config.base).toBe('/ai-dev-agents/')
  })

  it('treats an empty VITE_BASE_PATH as explicitly set, not as a missing value', async () => {
    // ?? (not ||) is deliberate: an empty repo variable in CI should surface as a broken build
    // rather than silently masquerading as the local default.
    vi.stubEnv('VITE_BASE_PATH', '')

    const { default: config } = await import('../vite.config')

    expect(config.base).toBe('')
  })
})
