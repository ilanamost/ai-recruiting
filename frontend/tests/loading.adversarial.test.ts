import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// QA adversarial pass for .plan/035 (global API loader). Tries to pin the loader on, drive the
// counter negative, or leave it up after failure paths the implementation tests don't cover.

async function loadModules() {
  vi.resetModules()
  const loading = await import('../src/lib/loading')
  const http = await import('../src/lib/http')
  const auth = await import('../src/lib/auth')
  return { ...loading, ...http, useAuth: auth.useAuth }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response
}

describe('global loader — adversarial', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns to zero after 60 rapid concurrent calls with mixed success, 401 and network failure', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount, isLoading } = useLoading()
    let n = 0
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(jsonResponse({}, { ok: false, status: 401 }))
      }
      n += 1
      if (n % 3 === 0) return Promise.reject(new TypeError('Failed to fetch'))
      if (n % 3 === 1) return Promise.resolve(jsonResponse({}, { ok: false, status: 401 }))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    const calls = Array.from({ length: 60 }, (_, i) => apiFetch(`http://localhost:3001/api/job/${i}`))
    expect(pendingCount.value).toBe(60)

    await Promise.allSettled(calls)

    expect(pendingCount.value).toBe(0)
    expect(isLoading.value).toBe(false)
  })

  it('coalesces concurrent 401s into one refresh and releases every call when the refresh fails', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount } = useLoading()
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/api/auth/refresh')
        ? jsonResponse({}, { ok: false, status: 401 })
        : jsonResponse({}, { ok: false, status: 401 }))
    )

    const responses = await Promise.all([
      apiFetch('http://localhost:3001/api/job'),
      apiFetch('http://localhost:3001/api/resume'),
      apiFetch('http://localhost:3001/api/match')
    ])

    const refreshCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
    expect(responses.every((response) => response.status === 401)).toBe(true)
    expect(pendingCount.value).toBe(0)
  })

  it('releases the count when the refresh request itself throws', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount } = useLoading()
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/api/auth/refresh')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse({}, { ok: false, status: 401 }))
    )

    const response = await apiFetch('http://localhost:3001/api/job')

    expect(response.status).toBe(401)
    expect(pendingCount.value).toBe(0)
  })

  it('tracks a failed login (wrong password) and releases the count after the rejection', async () => {
    const { useAuth, useLoading } = await loadModules()
    const { pendingCount } = useLoading()
    let observedDuringFetch = -1
    fetchMock.mockImplementation(() => {
      observedDuringFetch = pendingCount.value
      return Promise.resolve(jsonResponse({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } }, { ok: false, status: 401 }))
    })

    await expect(useAuth().login('a@b.c', 'wrong')).rejects.toThrow('Invalid email or password')

    expect(observedDuringFetch).toBe(1)
    expect(pendingCount.value).toBe(0)
  })

  it('does not throw and releases the count when logout hits a network failure', async () => {
    const { useAuth, useLoading } = await loadModules()
    const { pendingCount } = useLoading()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(useAuth().logout()).resolves.toBeUndefined()
    expect(pendingCount.value).toBe(0)
  })

  it('never shows the top bar for rapid start/stop flapping shorter than the show delay', async () => {
    vi.useFakeTimers()
    const { trackRequest, useLoading, LOADER_SHOW_DELAY_MS } = await loadModules()
    const { isLoaderVisible } = useLoading()

    for (let i = 0; i < 20; i += 1) {
      await trackRequest(async () => {
        vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS - 10)
      })
      vi.advanceTimersByTime(5)
      expect(isLoaderVisible.value).toBe(false)
    }
  })

  it('a hung page load keeps the spinner visible indefinitely and hides it once it finally settles', async () => {
    vi.useFakeTimers()
    const { trackPageLoad, useLoading, LOADER_SHOW_DELAY_MS } = await loadModules()
    const { isPageLoaderVisible } = useLoading()
    let finish!: () => void
    const load = trackPageLoad(() => new Promise<void>((resolve) => {
      finish = resolve
    }))

    vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS + 60_000)
    expect(isPageLoaderVisible.value).toBe(true)

    finish()
    await load
    vi.advanceTimersByTime(1000)
    expect(isPageLoaderVisible.value).toBe(false)
  })

  // Documents a known gap (reported as a finding, not a failure): apiFetch resolves with the
  // Response once headers arrive, so the request counter drops to 0 before the caller reads the
  // body. Page-level loads wrap the whole store call and are not affected; only the top bar is.
  it('GAP: request counter is already 0 while the caller is still reading the response body', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount } = useLoading()
    let releaseBody!: (value: unknown) => void
    const slowBody = new Promise((resolve) => {
      releaseBody = resolve
    })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => slowBody } as unknown as Response)

    const response = await apiFetch('http://localhost:3001/api/job')
    const bodyRead = response.json()

    expect(pendingCount.value).toBe(0)
    releaseBody({ items: [] })
    await bodyRead
  })
})
