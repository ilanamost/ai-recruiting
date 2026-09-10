// Shared fetch wrapper for cookie-based auth (httpOnly access_token/refresh_token cookies —
// see .plan/008-2026-08-03-authentication-authorization.md). Every request goes out with
// credentials: 'include'; a 401 triggers exactly one silent refresh-and-retry before the
// error propagates to the caller (the router guard handles the eventual redirect-to-login).

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

// Coalesces concurrent 401s into a single /api/auth/refresh call instead of firing one
// refresh request per in-flight request.
let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const withCredentials: RequestInit = { ...options, credentials: 'include' }
  const response = await fetch(url, withCredentials)
  if (response.status !== 401) {
    return response
  }

  const refreshed = await refreshAccessToken()
  if (!refreshed) {
    return response
  }

  return fetch(url, withCredentials)
}
