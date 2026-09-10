import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// router/index.ts memoizes its one-time fetchMe() call at module scope, and lib/auth.ts's
// user/isLoading are module-level singletons — so each test needs a fully fresh module graph
// (vi.resetModules + a dynamic re-import) to exercise a different auth outcome in isolation.
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

describe('router guard', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lets an unauthenticated visitor reach /login without redirecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 })))

    const { default: router } = await import('../src/router')
    await router.push('/login')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  // .plan/017: '/' is the home page and is deliberately not role-gated — every authenticated
  // role lands there, including a Candidate, who used to be bounced to /jobs.
  it.each([
    ['recruiter', recruiter],
    ['candidate', candidate],
    ['admin', admin]
  ])('lets an authenticated %s land on the home route with no redirect', async (_role, account) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(account)))

    const { default: router } = await import('../src/router')
    await router.push('/')

    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it.each([
    ['recruiter', recruiter],
    ['admin', admin]
  ])('lets an authenticated %s reach the create-job route at /jobs/new', async (_role, account) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(account)))

    const { default: router } = await import('../src/router')
    await router.push('/jobs/new')

    expect(router.currentRoute.value.path).toBe('/jobs/new')
    expect(router.currentRoute.value.name).toBe('job-new')
  })

  it('redirects an authenticated candidate away from /jobs/new to /jobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(candidate)))

    const { default: router } = await import('../src/router')
    await router.push('/jobs/new')

    expect(router.currentRoute.value.path).toBe('/jobs')
    expect(router.currentRoute.value.name).not.toBe('job-new')
  })

  // LoginPage does router.push('/') after both login and signup, unchanged by .plan/017 — what
  // changed is where that lands: the home page itself, not a redirect onward.
  it.each([
    ['recruiter', recruiter],
    ['candidate', candidate],
    ['admin', admin]
  ])('lands a %s on the home page after the post-login push to /', async (_role, account) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(account)))

    const { default: router } = await import('../src/router')
    await router.push('/login')
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('lets an authenticated candidate reach /jobs directly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(candidate)))

    const { default: router } = await import('../src/router')
    await router.push('/jobs')

    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  // .plan/015: /cvs is no longer a destination for a recruiter — they read CVs through a job's
  // "Manage CVs" popup instead. Admin and candidate are deliberately unaffected.
  it('redirects an authenticated recruiter away from /cvs to /jobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(recruiter)))

    const { default: router } = await import('../src/router')
    await router.push('/cvs')

    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  it('lets an authenticated admin reach /cvs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(admin)))

    const { default: router } = await import('../src/router')
    await router.push('/cvs')

    expect(router.currentRoute.value.path).toBe('/cvs')
  })

  it('lets an authenticated candidate reach /cvs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(candidate)))

    const { default: router } = await import('../src/router')
    await router.push('/cvs')

    expect(router.currentRoute.value.path).toBe('/cvs')
  })

  // The recruiter /cvs branch and the candidate /jobs/new branch must not swallow each other.
  it('keeps the candidate /jobs/new redirect independent of the /cvs guard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(candidate)))

    const { default: router } = await import('../src/router')
    await router.push('/jobs/new')
    expect(router.currentRoute.value.path).toBe('/jobs')

    await router.push('/cvs')
    expect(router.currentRoute.value.path).toBe('/cvs')
  })

  it('keeps a recruiter on /jobs when they retry /cvs, without looping', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(recruiter)))

    const { default: router } = await import('../src/router')
    await router.push('/jobs')
    await router.push('/cvs')

    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  it('only fetches the current user once across multiple navigations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(recruiter))
    vi.stubGlobal('fetch', fetchMock)

    const { default: router } = await import('../src/router')
    await router.push('/jobs')
    await router.push('/cvs')
    await router.push('/settings')

    const meCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/auth/me'))
    expect(meCalls).toHaveLength(1)
  })
})
