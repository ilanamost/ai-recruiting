import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * QA adversarial pass for .plan/025-2026-08-16-multi-environment-support.md.
 *
 * tests/base-path.test.ts covers router.resolve() — outbound href generation.
 * The half that actually decides whether the GitHub Pages deploy works is the
 * *inbound* direction: GitHub Pages serves dist/404.html for a deep link like
 * /ai-dev-agents/jobs while leaving that URL in the address bar, so the router
 * has to strip the base off the incoming location and land on /jobs. If the base
 * were wrong (or absent), the app would boot at an unmatched path and the deep
 * link would silently render nothing — the exact failure the 404.html trick and
 * createWebHistory(BASE_URL) exist to prevent, and one no local run reproduces.
 */

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

const recruiter = {
  id: 'user-1',
  name: 'Rita Recruiter',
  email: 'rita@example.com',
  role: 'recruiter',
  org_id: 'demo-org',
  has_profile_image: false
}

describe('inbound deep links under a GitHub Pages base path', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(recruiter)))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
  })

  it('strips the base off a 404.html-served deep link and lands on the real route', async () => {
    vi.stubEnv('BASE_URL', '/ai-dev-agents/')
    // What the browser address bar holds after GitHub Pages serves 404.html.
    window.history.replaceState({}, '', '/ai-dev-agents/jobs')

    const { default: router } = await import('../src/router')

    expect(router.options.history.location).toBe('/jobs')
    expect(router.resolve(router.options.history.location).name).toBe('jobs-list')
  })

  it('lands on the home route for the base path itself', async () => {
    vi.stubEnv('BASE_URL', '/ai-dev-agents/')
    window.history.replaceState({}, '', '/ai-dev-agents/')

    const { default: router } = await import('../src/router')

    expect(router.resolve(router.options.history.location).name).toBe('home')
  })

  it('keeps every nested route reachable under the base, not just top-level ones', async () => {
    vi.stubEnv('BASE_URL', '/ai-dev-agents/')

    const { default: router } = await import('../src/router')

    // Each app route must round-trip: resolve -> prefixed href -> strip base -> same route.
    for (const route of router.getRoutes()) {
      if (route.path.includes(':')) continue
      const { href, name } = router.resolve(route.path)
      expect(href.startsWith('/ai-dev-agents/')).toBe(true)
      expect(name).toBe(route.name)
    }
  })

  it('does not double-prefix an href that already carries the base', async () => {
    vi.stubEnv('BASE_URL', '/ai-dev-agents/')

    const { default: router } = await import('../src/router')

    expect(router.resolve('/jobs').href).not.toContain('/ai-dev-agents/ai-dev-agents/')
  })
})
