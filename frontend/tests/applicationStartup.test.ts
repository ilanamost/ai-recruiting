import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// .plan/035: no pre-mount loader any more. The app mounts straight away; the initial navigation
// is a tracked page-level load (AppLoader's centered spinner) and the shell stays hidden until it
// settles.
describe('startApplication', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="app"></div>'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('tracks the initial auth navigation as a page load and reveals the shell afterward', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { useLoading } = await import('../src/lib/loading')
    const { isPageLoading, isLoading, isAppReady } = useLoading()
    const { startApplication } = await import('../src/lib/startup')
    const startup = startApplication()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(isPageLoading.value).toBe(true)
    expect(isLoading.value).toBe(true)
    expect(isAppReady.value).toBe(false)
    expect(document.querySelector('#app main')).toBeNull()

    resolveResponse(jsonResponse(recruiter))
    await startup

    expect(isPageLoading.value).toBe(false)
    expect(isAppReady.value).toBe(true)
    await vi.waitFor(() => expect(document.querySelector('#app main')).not.toBeNull())
  })

  it('logs a navigation failure, releases the page load, and still reveals the shell', async () => {
    const navigationError = new Error('network unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(navigationError))

    const { useLoading } = await import('../src/lib/loading')
    const { isPageLoading, isLoading, isAppReady } = useLoading()
    const { startApplication } = await import('../src/lib/startup')
    await startApplication()

    expect(consoleError).toHaveBeenCalledWith('Initial route navigation failed', navigationError)
    expect(isPageLoading.value).toBe(false)
    expect(isLoading.value).toBe(false)
    expect(isAppReady.value).toBe(true)
    await vi.waitFor(() => expect(document.querySelector('#app nav')).not.toBeNull())
    consoleError.mockRestore()
  })
})
