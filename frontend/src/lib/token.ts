// Bearer-token store (.plan/036). iOS Safari's tracking prevention drops the cross-site httpOnly
// session cookies (GitHub Pages → Render), so the API also returns the token pair in the JSON
// body and the client sends it back as `Authorization: Bearer <access>`. Kept in localStorage
// (plan Q2) so a reload keeps the session. Every storage access is wrapped: private mode or
// blocked site data can make localStorage throw, and the cookie flow must keep working then.
//
// Its own module (not lib/auth.ts) because lib/http.ts needs it and lib/auth.ts already
// imports lib/http.ts — putting it in auth.ts would create an import cycle.

export const ACCESS_TOKEN_KEY = 'access_token'
export const REFRESH_TOKEN_KEY = 'refresh_token'

export interface TokenPair {
  access_token: string
  refresh_token: string
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable — the cookie session (where the browser allows it) still applies.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing stored that we could reach, so nothing to clear.
  }
}

export function getAccessToken(): string | null {
  return read(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return read(REFRESH_TOKEN_KEY)
}

export function setTokens(tokens: TokenPair): void {
  write(ACCESS_TOKEN_KEY, tokens.access_token)
  write(REFRESH_TOKEN_KEY, tokens.refresh_token)
}

export function clearTokens(): void {
  remove(ACCESS_TOKEN_KEY)
  remove(REFRESH_TOKEN_KEY)
}

function isTokenPair(value: unknown): value is TokenPair {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.access_token === 'string' && record.access_token !== ''
    && typeof record.refresh_token === 'string' && record.refresh_token !== ''
}

/**
 * Stores the token pair if the response body carries one, and returns the body without the
 * token fields so they never end up in reactive app state (e.g. the signed-in `user` ref).
 * A body without tokens (older backend, or a cookie-only response) is returned unchanged.
 */
export function takeTokens<T extends object>(body: T): Omit<T, keyof TokenPair> {
  if (isTokenPair(body)) {
    setTokens(body)
  }
  const { access_token: _access, refresh_token: _refresh, ...rest } = body as T & Partial<TokenPair>
  return rest
}

/** Adds `Authorization: Bearer <access>` when an access token is stored; otherwise a no-op. */
export function withAuthHeader(headers?: HeadersInit): HeadersInit | undefined {
  const token = getAccessToken()
  if (!token) {
    return headers
  }
  if (headers instanceof Headers || Array.isArray(headers)) {
    const merged = new Headers(headers)
    merged.set('Authorization', `Bearer ${token}`)
    return merged
  }
  return { ...headers, Authorization: `Bearer ${token}` }
}
