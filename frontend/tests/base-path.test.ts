import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// .plan/025: the app has to work both at the domain root (local dev, `npm run dev`) and under a
// GitHub Pages project-page prefix (`/ai-dev-agents/`). The wiring is a single chain —
// VITE_BASE_PATH -> vite.config.ts `base` -> import.meta.env.BASE_URL -> createWebHistory(base) —
// and a break anywhere in it ships an app whose assets or routes 404 only once deployed, which no
// local run would catch. These tests pin both ends of that chain.

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response
}

const recruiter = {
  id: 'user-1',
  name: 'Rita Recruiter',
  email: 'rita@example.com',
  role: 'recruiter',
  org_id: 'demo-org',
  has_profile_image: false
}

// The vite.config.ts half of this chain is covered in vite-config-base.test.ts, which needs the
// node environment to import that config at all.
describe('router history base', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(recruiter)))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('follows BASE_URL so routes resolve under a GitHub Pages project-page prefix', async () => {
    vi.stubEnv('BASE_URL', '/ai-dev-agents/')

    const { default: router } = await import('../src/router')

    expect(router.options.history.base).toBe('/ai-dev-agents')
    // The route path itself stays prefix-free — only the emitted href carries the base.
    expect(router.resolve('/jobs').href).toBe('/ai-dev-agents/jobs')
  })

  it('keeps clean history-mode URLs, not hash URLs, under a base path', async () => {
    vi.stubEnv('BASE_URL', '/ai-dev-agents/')

    const { default: router } = await import('../src/router')

    // Guards the .plan/025 decision: GitHub Pages SPA routing is solved by a 404.html copy in CI,
    // so a regression to hash mode (`/#/jobs`) would be a silent URL-format break.
    expect(router.resolve('/jobs').href).not.toContain('#')
  })

  it('resolves routes at the domain root when no base path is set', async () => {
    const { default: router } = await import('../src/router')

    expect(router.resolve('/jobs').href).toBe('/jobs')
    await router.push('/jobs')
    expect(router.currentRoute.value.path).toBe('/jobs')
  })
})
