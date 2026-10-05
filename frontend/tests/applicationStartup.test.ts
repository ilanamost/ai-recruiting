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

describe('startApplication', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="app-loader"></div><div id="app"></div>'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('keeps startup loading visible through initial auth navigation and mounts the app afterward', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { startApplication } = await import('../src/lib/startup')
    const startup = startApplication()

    expect(document.querySelector('#app-loader [role="status"]')).not.toBeNull()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    resolveResponse(jsonResponse(recruiter))
    await startup

    expect(document.querySelector('#app-loader [role="status"]')).toBeNull()
    expect(document.querySelector('#app main')).not.toBeNull()
  })

  it('logs navigation failure, still mounts the app, and removes the startup loader', async () => {
    const navigationError = new Error('network unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(navigationError))

    const { startApplication } = await import('../src/lib/startup')
    await startApplication()

    expect(consoleError).toHaveBeenCalledWith('Initial route navigation failed', navigationError)
    expect(document.querySelector('#app-loader [role="status"]')).toBeNull()
    expect(document.querySelector('#app')).not.toBeNull()
  })
})
