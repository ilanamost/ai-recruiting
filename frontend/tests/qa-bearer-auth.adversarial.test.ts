// QA adversarial pass for .plan/036 (bearer-token fallback for iOS Safari).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../src/lib/http'
import { useAuth } from '../src/lib/auth'
import { clearTokens, getAccessToken, getRefreshToken, setTokens, withAuthHeader } from '../src/lib/token'

function res(body: unknown, status = 200, jsonThrows = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new SyntaxError('Unexpected end of JSON input')
      return body
    }
  } as Response
}

function authHeaderOf(init: RequestInit | undefined): string | null {
  if (!init?.headers) return null
  return new Headers(init.headers).get('Authorization')
}

describe('QA adversarial — bearer fallback (.plan/036)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('rapid parallel 401s share ONE body refresh, and every retry carries the rotated token', async () => {
    setTokens({ access_token: 'old-a', refresh_token: 'old-r' })
    let refreshCalls = 0
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1
        await new Promise((r) => setTimeout(r, 10))
        return res({ access_token: 'new-a', refresh_token: 'new-r' })
      }
      return authHeaderOf(init) === 'Bearer new-a' ? res({ ok: true }) : res({}, 401)
    })

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => apiFetch(`http://localhost:3001/api/job/${i}`))
    )

    expect(refreshCalls).toBe(1)
    const refreshInit = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/refresh'))?.[1] as RequestInit
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refresh_token: 'old-r' })
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(getAccessToken()).toBe('new-a')
    expect(getRefreshToken()).toBe('new-r')
  })

  it('a failed refresh clears stored tokens and does not retry', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r' })
    fetchMock.mockResolvedValueOnce(res({}, 401)).mockResolvedValueOnce(res({}, 401))

    const response = await apiFetch('http://localhost:3001/api/job')

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('refresh 200 with an empty (cookie-only) body keeps the stored pair and still retries', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r' })
    fetchMock
      .mockResolvedValueOnce(res({}, 401))
      .mockResolvedValueOnce(res(null, 200, true))
      .mockResolvedValueOnce(res({ ok: true }))

    const response = await apiFetch('http://localhost:3001/api/job')

    expect(response.status).toBe(200)
    expect(getAccessToken()).toBe('a')
  })

  it('a malformed login body (non-string tokens) stores nothing and never leaks token fields into user', async () => {
    fetchMock.mockResolvedValueOnce(
      res({ id: 'u1', name: 'n', email: 'e@x', role: 'recruiter', org_id: 'o', has_profile_image: false, access_token: 123, refresh_token: null })
    )
    const { login, user } = useAuth()

    const signedIn = await login('e@x', 'pw')

    expect(getAccessToken()).toBeNull()
    expect(signedIn).not.toHaveProperty('access_token')
    expect(user.value).not.toHaveProperty('refresh_token')
  })

  it('logout with no stored tokens is the unchanged cookie-only request (no header, no body)', async () => {
    fetchMock.mockResolvedValueOnce(res(null, 200))
    const { logout } = useAuth()

    await logout()

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init).toEqual({ method: 'POST', credentials: 'include' })
  })

  it('logout clears tokens even when the network request rejects', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { logout } = useAuth()

    await expect(logout()).resolves.toBeUndefined()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('logout does not throw when localStorage itself throws (Safari private mode)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    fetchMock.mockResolvedValueOnce(res(null, 200))
    const { logout, user } = useAuth()

    await expect(logout()).resolves.toBeUndefined()
    expect(user.value).toBeNull()
  })

  it('FormData uploads get the bearer header but no forced Content-Type (multipart boundary intact)', async () => {
    setTokens({ access_token: 'a', refresh_token: 'r' })
    fetchMock.mockResolvedValueOnce(res({ ok: true }))
    const body = new FormData()
    body.append('name', 'x')

    await apiFetch('http://localhost:3001/api/auth/me', { method: 'PATCH', body })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(authHeaderOf(init)).toBe('Bearer a')
    expect(new Headers(init.headers).get('Content-Type')).toBeNull()
    expect(init.body).toBe(body)
  })

  it('a very long access token is sent verbatim', () => {
    const long = 'x'.repeat(16_000)
    setTokens({ access_token: long, refresh_token: 'r' })
    const headers = withAuthHeader() as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${long}`)
    clearTokens()
  })
})
