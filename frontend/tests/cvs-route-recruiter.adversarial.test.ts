import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// QA adversarial pass for .plan/015 (hide /cvs for Recruiter). Mirrors router.test.ts's module
// isolation: router/index.ts memoizes fetchMe() at module scope and lib/auth.ts holds a
// module-level `user` singleton, so every test re-imports a fresh module graph.
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

const candidate = { ...recruiter, id: 'user-2', role: 'candidate' }
const admin = { ...recruiter, id: 'user-3', role: 'admin' }

async function routerFor(user: unknown | null) {
  const response = user
    ? jsonResponse(user)
    : jsonResponse({}, { ok: false, status: 401 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  const { default: router } = await import('../src/router')
  return router
}

describe('/cvs recruiter guard (adversarial)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The auth check must stay ahead of the new role check: an anonymous visitor gets the login
  // page, never the recruiter's /jobs redirect (which would leak a destination and skip login).
  it('sends an unauthenticated visitor from /cvs to /login, not to /jobs', async () => {
    const router = await routerFor(null)
    await router.push('/cvs')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('sends an unauthenticated visitor from /jobs to /login as well', async () => {
    const router = await routerFor(null)
    await router.push('/jobs')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  // Redirect stability: repeated attempts must each redirect cleanly rather than loop, throw a
  // NavigationDuplicated-style rejection, or strand the recruiter on a blank route.
  it('redirects a recruiter every time they retry /cvs, with no loop or stuck state', async () => {
    const router = await routerFor(recruiter)

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(router.push('/cvs')).resolves.not.toThrow()
      expect(router.currentRoute.value.path).toBe('/jobs')
    }

    // And an unrelated route in between still works, so the guard is not latching.
    await router.push('/settings')
    expect(router.currentRoute.value.path).toBe('/settings')
    await router.push('/cvs')
    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  it('redirects a recruiter reaching /cvs by route name, not just by path', async () => {
    const router = await routerFor(recruiter)
    await router.push({ name: 'cvs-list' })

    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  it('redirects a recruiter reaching /cvs with a query string', async () => {
    const router = await routerFor(recruiter)
    await router.push('/cvs?from=bookmark')

    expect(router.currentRoute.value.path).toBe('/jobs')
    expect(router.currentRoute.value.name).not.toBe('cvs-list')
  })

  it('redirects a recruiter reaching /cvs with a hash fragment', async () => {
    const router = await routerFor(recruiter)
    await router.push('/cvs#top')

    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  // Fixed (QA finding QA-1): the guard now compares to.name === 'cvs-list' instead of
  // to.path === '/cvs', so both of these URL spellings — which vue-router's defaults
  // (strict: false, sensitive: false) still resolve to the cvs-list route — redirect too.
  it('redirects a recruiter on the trailing-slash spelling /cvs/', async () => {
    const router = await routerFor(recruiter)
    await router.push('/cvs/')

    expect(router.currentRoute.value.path).toBe('/jobs')
    expect(router.currentRoute.value.name).not.toBe('cvs-list')
  })

  it('redirects a recruiter on the uppercase spelling /CVS', async () => {
    const router = await routerFor(recruiter)
    await router.push('/CVS')

    expect(router.currentRoute.value.path).toBe('/jobs')
    expect(router.currentRoute.value.name).not.toBe('cvs-list')
  })

  // Cross-branch: neither role's redirect may shadow the other's, in either evaluation order.
  // Updated for .plan/017: the candidate branch now guards /jobs/new, not '/' — '/' is the
  // ungated home page for every role.
  it('keeps the candidate /jobs/new redirect and the recruiter /cvs redirect independent', async () => {
    const recruiterRouter = await routerFor(recruiter)
    await recruiterRouter.push('/jobs/new')
    expect(recruiterRouter.currentRoute.value.path).toBe('/jobs/new')
    await recruiterRouter.push('/cvs')
    expect(recruiterRouter.currentRoute.value.path).toBe('/jobs')

    vi.resetModules()
    vi.unstubAllGlobals()

    const candidateRouter = await routerFor(candidate)
    await candidateRouter.push('/cvs')
    expect(candidateRouter.currentRoute.value.path).toBe('/cvs')
    await candidateRouter.push('/jobs/new')
    expect(candidateRouter.currentRoute.value.path).toBe('/jobs')
  })

  it('leaves an admin unaffected on both guarded paths', async () => {
    const router = await routerFor(admin)
    await router.push('/jobs/new')
    expect(router.currentRoute.value.path).toBe('/jobs/new')
    await router.push('/cvs')
    expect(router.currentRoute.value.path).toBe('/cvs')
  })

  // The catch-all redirects unknown paths to '/', which must not collide with either guard —
  // and since .plan/017 that lands on the home page for every role, candidate included.
  it('sends a recruiter typing a near-miss CV url through the catch-all to /', async () => {
    const router = await routerFor(recruiter)
    await router.push('/cvs-list')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('sends a candidate typing a near-miss CV url through the catch-all to / as well', async () => {
    const router = await routerFor(candidate)
    await router.push('/cvs-list')

    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.name).toBe('home')
  })
})
