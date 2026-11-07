// Shared fetch wrapper. Auth is two flows side by side (.plan/036):
// - httpOnly access_token/refresh_token cookies (.plan/008) — every request goes out with
//   credentials: 'include', which is all desktop browsers need;
// - a bearer-token fallback for browsers that drop cross-site cookies (iOS Safari): when
//   lib/token.ts holds an access token, it is sent as `Authorization: Bearer <access>`.
// A 401 triggers exactly one silent refresh-and-retry before the error propagates to the
// caller (the router guard handles the eventual redirect-to-login). Every call is counted by
// lib/loading.ts (.plan/035) for the whole original → refresh → retry sequence, so the global
// loader stays up until the caller actually has its final response.

import { trackRequest } from './loading'
import { clearTokens, getRefreshToken, takeTokens, withAuthHeader } from './token'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  code: string
  details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

export async function parseErrorResponse(response: Response): Promise<never> {
  const body = await response.json().catch(() => null)
  const code = body?.error?.code ?? 'unknown_error'
  const message = body?.error?.message ?? 'Something went wrong'
  throw new ApiError(code, message, body?.error?.details)
}

// The refresh token travels in the JSON body when we hold one (the cookie may never reach the
// API on Safari); with no stored token the request is the plain cookie-only refresh.
function refreshRequestInit(): RequestInit {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    return { method: 'POST', credentials: 'include' }
  }
  return {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  }
}

async function storeRotatedTokens(response: Response): Promise<void> {
  // A cookie-only backend answers 200 with an empty body — nothing to store then.
  const body = await response.json().catch(() => null)
  if (body && typeof body === 'object') {
    takeTokens(body)
  }
}

// Coalesces concurrent 401s into a single /api/auth/refresh call instead of firing one
// refresh request per in-flight request (refresh tokens rotate, so a second parallel refresh
// with the same token would be treated as reuse and revoke every session).
let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/api/auth/refresh`, refreshRequestInit())
      .then(async (response) => {
        if (!response.ok) {
          // The session is gone server-side — stale tokens would only cause more 401s.
          clearTokens()
          return false
        }
        await storeRotatedTokens(response)
        return true
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

// Rebuilt per attempt so the retry after a refresh carries the rotated access token.
function authorizedInit(options: RequestInit): RequestInit {
  const headers = withAuthHeader(options.headers)
  const init: RequestInit = { ...options, credentials: 'include' }
  if (headers !== undefined) {
    init.headers = headers
  }
  return init
}

export function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return trackRequest(async () => {
    const response = await fetch(url, authorizedInit(options))
    if (response.status !== 401) {
      return response
    }

    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      return response
    }

    return fetch(url, authorizedInit(options))
  })
}
