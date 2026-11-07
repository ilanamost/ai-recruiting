import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, parseErrorResponse } from '../src/lib/http'
import { getAccessToken, getRefreshToken, setTokens } from '../src/lib/token'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response
}

describe('lib/http — apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('always sends credentials: include', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await apiFetch('http://localhost:3001/api/job')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job', { credentials: 'include' })
  })

  it('preserves caller options alongside credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await apiFetch('http://localhost:3001/api/job', { method: 'POST', headers: { 'Content-Type': 'application/json' } })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    })
  })

  it('passes through a non-401 response untouched, with no refresh attempt', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'job-1' }, { status: 200 }))

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
  })

  it('on a 401, attempts one refresh and retries the original request once', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 })) // original request
      .mockResolvedValueOnce(jsonResponse({}, { ok: true, status: 200 })) // refresh
      .mockResolvedValueOnce(jsonResponse({ id: 'job-1' }, { ok: true, status: 200 })) // retried request

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]).toEqual([
      'http://localhost:3001/api/auth/refresh',
      { method: 'POST', credentials: 'include' }
    ])
    expect(fetchMock.mock.calls[2]).toEqual(['http://localhost:3001/api/job/job-1', { credentials: 'include' }])
    expect(response.status).toBe(200)
  })

  it('returns the original 401 response when the refresh itself fails, without retrying again', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 })) // original request
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 })) // refresh fails

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(401)
  })

  it('coalesces concurrent 401s into a single refresh call', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(jsonResponse({}, { ok: true, status: 200 }))
      }
      // Each distinct resource request 401s once, then succeeds on retry.
      const key = url
      const calls = fetchMock.mock.calls.filter((call) => call[0] === key)
      return Promise.resolve(
        calls.length <= 1 ? jsonResponse({}, { ok: false, status: 401 }) : jsonResponse({ ok: true })
      )
    })

    await Promise.all([apiFetch('http://localhost:3001/api/job/a'), apiFetch('http://localhost:3001/api/job/b')])

    const refreshCalls = fetchMock.mock.calls.filter((call) => call[0].endsWith('/api/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })
})

describe('lib/http — bearer-token fallback (.plan/036)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('sends Authorization: Bearer <access> alongside credentials when a token is stored', async () => {
    setTokens({ access_token: 'acc-1', refresh_token: 'ref-1' })
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await apiFetch('http://localhost:3001/api/job', { method: 'POST', headers: { 'Content-Type': 'application/json' } })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer acc-1' },
      credentials: 'include'
    })
  })

  it('refreshes with the refresh token in the JSON body, stores the rotated pair, and retries with the new access token', async () => {
    setTokens({ access_token: 'acc-old', refresh_token: 'ref-old' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 })) // original request
      .mockResolvedValueOnce(jsonResponse({ access_token: 'acc-new', refresh_token: 'ref-new' })) // refresh
      .mockResolvedValueOnce(jsonResponse({ id: 'job-1' })) // retried request

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(fetchMock.mock.calls[1]).toEqual([
      'http://localhost:3001/api/auth/refresh',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'ref-old' })
      }
    ])
    expect(fetchMock.mock.calls[2]).toEqual([
      'http://localhost:3001/api/job/job-1',
      { credentials: 'include', headers: { Authorization: 'Bearer acc-new' } }
    ])
    expect(getAccessToken()).toBe('acc-new')
    expect(getRefreshToken()).toBe('ref-new')
    expect(response.status).toBe(200)
  })

  it('clears the stored tokens when the refresh is rejected', async () => {
    setTokens({ access_token: 'acc-old', refresh_token: 'ref-old' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 })) // original request
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 })) // refresh rejected

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('keeps the tokens when the refresh fails on the network (not an auth failure)', async () => {
    setTokens({ access_token: 'acc-old', refresh_token: 'ref-old' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockRejectedValueOnce(new Error('network down'))

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(response.status).toBe(401)
    expect(getRefreshToken()).toBe('ref-old')
  })

  it('accepts a cookie-only refresh (200 with no JSON body) without touching storage', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('empty body')
        }
      } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ id: 'job-1' }))

    const response = await apiFetch('http://localhost:3001/api/job/job-1')

    expect(response.status).toBe(200)
    expect(getAccessToken()).toBeNull()
  })
})

describe('lib/http — ApiError / parseErrorResponse', () => {
  it('throws an ApiError built from the response body', async () => {
    const response = jsonResponse(
      { error: { code: 'not_found', message: 'Job not found', details: { field: 'id' } }, requestId: 'req-1' },
      { ok: false, status: 404 }
    )

    await expect(parseErrorResponse(response)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'not_found',
      message: 'Job not found',
      details: { field: 'id' }
    })
  })

  it('falls back to a generic message when the body is unparseable', async () => {
    const response = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('bad json')
      }
    } as unknown as Response

    await expect(parseErrorResponse(response)).rejects.toThrow('Something went wrong')
  })

  it('is an instance of Error and ApiError', async () => {
    const response = jsonResponse({ error: { code: 'x', message: 'y' } }, { ok: false, status: 400 })
    try {
      await parseErrorResponse(response)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(ApiError)
    }
  })
})
