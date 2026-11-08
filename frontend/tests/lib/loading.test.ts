import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/loading.ts and lib/http.ts hold module-level state (the counters, the coalesced refresh),
// so every test imports a fresh module graph.
async function loadModules() {
  vi.resetModules()
  const loading = await import('../../src/lib/loading')
  const http = await import('../../src/lib/http')
  return { ...loading, ...http }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('lib/loading — request tracking through apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts a pending apiFetch and releases it once the response resolves', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount, isLoading } = useLoading()
    const response = deferred<Response>()
    fetchMock.mockReturnValue(response.promise)

    const call = apiFetch('http://localhost:3001/api/job')
    expect(pendingCount.value).toBe(1)
    expect(isLoading.value).toBe(true)

    response.resolve(jsonResponse({ ok: true }))
    await call

    expect(pendingCount.value).toBe(0)
    expect(isLoading.value).toBe(false)
  })

  it('releases the count when the request rejects', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount, isLoading } = useLoading()
    const response = deferred<Response>()
    fetchMock.mockReturnValue(response.promise)

    const call = apiFetch('http://localhost:3001/api/job')
    expect(pendingCount.value).toBe(1)

    response.reject(new TypeError('Failed to fetch'))
    await expect(call).rejects.toThrow("Can't reach the server")

    expect(pendingCount.value).toBe(0)
    expect(isLoading.value).toBe(false)
  })

  it('keeps isLoading true until every concurrent call has settled', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { pendingCount, isLoading } = useLoading()
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const callA = apiFetch('http://localhost:3001/api/job')
    const callB = apiFetch('http://localhost:3001/api/resume')
    expect(pendingCount.value).toBe(2)

    first.resolve(jsonResponse({}))
    await callA
    expect(pendingCount.value).toBe(1)
    expect(isLoading.value).toBe(true)

    second.reject(new Error('boom'))
    await expect(callB).rejects.toThrow('boom')
    expect(pendingCount.value).toBe(0)
    expect(isLoading.value).toBe(false)
  })

  it('keeps isLoading true through a 401 → refresh → retry sequence', async () => {
    const { apiFetch, useLoading } = await loadModules()
    const { isLoading } = useLoading()
    const observed: boolean[] = []
    fetchMock.mockImplementation((url: string) => {
      observed.push(isLoading.value)
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(jsonResponse({}, { ok: true, status: 200 }))
      }
      const calls = fetchMock.mock.calls.filter((call) => call[0] === url)
      return Promise.resolve(calls.length <= 1 ? jsonResponse({}, { ok: false, status: 401 }) : jsonResponse({ id: 'job-1' }))
    })

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(observed).toEqual([true, true, true])
    expect(response.status).toBe(200)
    expect(isLoading.value).toBe(false)
  })
})

describe('lib/loading — trackPageLoad', () => {
  it('counts a page-level load separately from requests and releases it on failure', async () => {
    const { trackPageLoad, useLoading } = await loadModules()
    const { pagePendingCount, isPageLoading, pendingCount } = useLoading()
    const work = deferred<void>()

    const load = trackPageLoad(() => work.promise)
    expect(pagePendingCount.value).toBe(1)
    expect(isPageLoading.value).toBe(true)
    expect(pendingCount.value).toBe(0)

    work.reject(new Error('Failed to load jobs'))
    await expect(load).rejects.toThrow('Failed to load jobs')
    expect(isPageLoading.value).toBe(false)
  })

  it('releases the count when the work throws synchronously', async () => {
    const { trackPageLoad, useLoading } = await loadModules()
    const { pagePendingCount } = useLoading()

    await expect(trackPageLoad(() => {
      throw new Error('sync failure')
    })).rejects.toThrow('sync failure')
    expect(pagePendingCount.value).toBe(0)
  })

  it('markAppReady flips isAppReady, which starts false', async () => {
    const { markAppReady, useLoading } = await loadModules()
    const { isAppReady } = useLoading()

    expect(isAppReady.value).toBe(false)
    markAppReady()
    expect(isAppReady.value).toBe(true)
  })
})

describe('lib/loading — anti-flicker visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes the show delay and minimum visible time as named constants', async () => {
    const { LOADER_SHOW_DELAY_MS, LOADER_MIN_VISIBLE_MS } = await loadModules()

    expect(LOADER_SHOW_DELAY_MS).toBe(150)
    expect(LOADER_MIN_VISIBLE_MS).toBe(300)
  })

  it('never shows the loader for a call that settles before the show delay', async () => {
    const { trackRequest, useLoading, LOADER_SHOW_DELAY_MS } = await loadModules()
    const { isLoaderVisible } = useLoading()
    const work = deferred<void>()

    const call = trackRequest(() => work.promise)
    vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS - 1)
    work.resolve()
    await call
    vi.advanceTimersByTime(1000)

    expect(isLoaderVisible.value).toBe(false)
  })

  it('shows the loader after the delay and keeps it up for the minimum visible time', async () => {
    const { trackRequest, useLoading, LOADER_SHOW_DELAY_MS, LOADER_MIN_VISIBLE_MS } = await loadModules()
    const { isLoaderVisible } = useLoading()
    const work = deferred<void>()

    const call = trackRequest(() => work.promise)
    expect(isLoaderVisible.value).toBe(false)
    vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS)
    expect(isLoaderVisible.value).toBe(true)

    // Settles just 50ms after showing: still held on screen until the minimum elapses.
    vi.advanceTimersByTime(50)
    work.resolve()
    await call
    expect(isLoaderVisible.value).toBe(true)

    vi.advanceTimersByTime(LOADER_MIN_VISIBLE_MS - 50 - 1)
    expect(isLoaderVisible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isLoaderVisible.value).toBe(false)
  })

  it('hides immediately when the call outlasts the minimum visible time', async () => {
    const { trackRequest, useLoading, LOADER_SHOW_DELAY_MS, LOADER_MIN_VISIBLE_MS } = await loadModules()
    const { isLoaderVisible } = useLoading()
    const work = deferred<void>()

    const call = trackRequest(() => work.promise)
    vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS + LOADER_MIN_VISIBLE_MS + 100)
    expect(isLoaderVisible.value).toBe(true)

    work.resolve()
    await call
    expect(isLoaderVisible.value).toBe(false)
  })

  it('stays visible without a gap when a new call starts during the minimum visible window', async () => {
    const { trackRequest, useLoading, LOADER_SHOW_DELAY_MS, LOADER_MIN_VISIBLE_MS } = await loadModules()
    const { isLoaderVisible } = useLoading()
    const first = deferred<void>()
    const second = deferred<void>()

    const callA = trackRequest(() => first.promise)
    vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS)
    first.resolve()
    await callA

    const callB = trackRequest(() => second.promise)
    vi.advanceTimersByTime(LOADER_MIN_VISIBLE_MS * 2)
    expect(isLoaderVisible.value).toBe(true)

    second.resolve()
    await callB
    expect(isLoaderVisible.value).toBe(false)
  })

  it('drives the page spinner independently of the top bar', async () => {
    const { trackPageLoad, useLoading, LOADER_SHOW_DELAY_MS } = await loadModules()
    const { isLoaderVisible, isPageLoaderVisible } = useLoading()
    const work = deferred<void>()

    const load = trackPageLoad(() => work.promise)
    vi.advanceTimersByTime(LOADER_SHOW_DELAY_MS)
    expect(isPageLoaderVisible.value).toBe(true)
    expect(isLoaderVisible.value).toBe(false)

    work.resolve()
    await load
    vi.advanceTimersByTime(1000)
    expect(isPageLoaderVisible.value).toBe(false)
  })
})
