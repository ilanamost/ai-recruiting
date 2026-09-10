import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// QA adversarial pass for .plan/017 (home page at '/', job form moved to '/jobs/new').
// Same module isolation as router.test.ts: router/index.ts memoizes fetchMe() at module scope
// and lib/auth.ts holds a module-level `user` singleton, so every case re-imports fresh.
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
  const response = user ? jsonResponse(user) : jsonResponse({}, { ok: false, status: 401 })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  const { default: router } = await import('../src/router')
  return router
}

describe('/jobs/new candidate guard (adversarial)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Proves the premise behind the frontend agent's deviation from the ticket's literal
  // `to.path === '/jobs/new'` snippet, rather than taking the QA-1 citation on trust: these
  // spellings all resolve to the job-new route while carrying a `path` that is NOT '/jobs/new',
  // so a path-string compare would have let a Candidate straight into the job form.
  it.each(['/jobs/new/', '/JOBS/NEW', '/Jobs/New'])(
    'resolves %s to the job-new route with a path a string compare would miss',
    async (url) => {
      const router = await routerFor(candidate)
      const resolved = router.resolve(url)

      expect(resolved.name).toBe('job-new')
      expect(resolved.path).not.toBe('/jobs/new')
    }
  )

  it.each(['/jobs/new/', '/JOBS/NEW', '/Jobs/New', '/jobs/new?from=bookmark', '/jobs/new#top'])(
    'redirects a candidate away from the %s spelling',
    async (url) => {
      const router = await routerFor(candidate)
      await router.push(url)

      expect(router.currentRoute.value.path).toBe('/jobs')
      expect(router.currentRoute.value.name).not.toBe('job-new')
    }
  )

  it('redirects a candidate pushing the route by name', async () => {
    const router = await routerFor(candidate)
    await router.push({ name: 'job-new' })

    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  it('redirects a candidate on every retry, with no loop or stuck state', async () => {
    const router = await routerFor(candidate)

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(router.push('/jobs/new')).resolves.not.toThrow()
      expect(router.currentRoute.value.path).toBe('/jobs')
    }

    await router.push('/settings')
    expect(router.currentRoute.value.path).toBe('/settings')
    await router.push('/jobs/new')
    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  // The mirror image: the guard must not over-block. Admin/Recruiter still reach the form on
  // the same alternate spellings a Candidate is bounced from.
  it.each([
    ['admin', admin],
    ['recruiter', recruiter]
  ])('still lets %s reach the job form on the trailing-slash spelling', async (_role, account) => {
    const router = await routerFor(account)
    await router.push('/jobs/new/')

    expect(router.currentRoute.value.name).toBe('job-new')
  })

  // Auth must stay ahead of the role check: an anonymous visitor gets login, not /jobs.
  it('sends an unauthenticated visitor from /jobs/new to /login', async () => {
    const router = await routerFor(null)
    await router.push('/jobs/new')

    expect(router.currentRoute.value.path).toBe('/login')
  })
})

describe('home route has no role gate (adversarial)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['admin', admin],
    ['recruiter', recruiter],
    ['candidate', candidate]
  ])('lands %s on home from every entry spelling, with no redirect', async (_role, account) => {
    const router = await routerFor(account)

    for (const url of ['/', '/?ref=login', '/#top']) {
      await router.push(url)
      expect(router.currentRoute.value.name).toBe('home')
      expect(router.currentRoute.value.path).toBe('/')
    }

    await router.push({ name: 'home' })
    expect(router.currentRoute.value.name).toBe('home')
  })

  // Returning to home from a guarded route must not inherit that route's redirect.
  it.each([
    ['admin', admin],
    ['recruiter', recruiter],
    ['candidate', candidate]
  ])('lets %s navigate back to home from another route', async (_role, account) => {
    const router = await routerFor(account)
    await router.push('/jobs')
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
  })

  // Out of scope for the plan's content, but the guard order it relies on: home is only ever
  // reached by an authenticated user.
  it('still sends an unauthenticated visitor from / to /login', async () => {
    const router = await routerFor(null)
    await router.push('/')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.name).not.toBe('home')
  })
})

describe('catch-all route after the / meaning change (adversarial)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Before .plan/017 the catch-all dumped a Candidate on '/', which the old guard then bounced
  // to /jobs. Now '/' is the home page and every role must simply land on it.
  it.each([
    ['admin', admin],
    ['recruiter', recruiter],
    ['candidate', candidate]
  ])('sends %s from an unknown deep path to the home page', async (_role, account) => {
    const router = await routerFor(account)

    for (const url of ['/does/not/exist', '/home', '/jobs/new/extra']) {
      await router.push(url)
      expect(router.currentRoute.value.path).toBe('/')
      expect(router.currentRoute.value.name).toBe('home')
    }
  })
})

describe('route table has no stale job route (adversarial)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("no longer exposes the old 'job' route name, and '/' is the home route", async () => {
    const router = await routerFor(admin)
    const names = router.getRoutes().map((route) => route.name)

    expect(names).not.toContain('job')
    expect(names).toContain('home')
    expect(names).toContain('job-new')
    expect(router.resolve('/').name).toBe('home')
  })
})
