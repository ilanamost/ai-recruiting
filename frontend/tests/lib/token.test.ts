import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
  takeTokens,
  withAuthHeader
} from '../../src/lib/token'

describe('lib/token — bearer token store (.plan/036)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores, reads and clears the token pair', () => {
    setTokens({ access_token: 'acc-1', refresh_token: 'ref-1' })
    expect(getAccessToken()).toBe('acc-1')
    expect(getRefreshToken()).toBe('ref-1')

    clearTokens()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('returns null and never throws when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => setTokens({ access_token: 'a', refresh_token: 'r' })).not.toThrow()
    expect(getAccessToken()).toBeNull()
    expect(() => clearTokens()).not.toThrow()
  })

  it('takeTokens stores the pair and strips it from the returned body', () => {
    const body = { id: 'user-1', name: 'Rita', access_token: 'acc-2', refresh_token: 'ref-2' }

    const rest = takeTokens(body)

    expect(rest).toEqual({ id: 'user-1', name: 'Rita' })
    expect(getAccessToken()).toBe('acc-2')
    expect(getRefreshToken()).toBe('ref-2')
  })

  it('takeTokens leaves storage alone for a body without tokens (cookie-only backend)', () => {
    setTokens({ access_token: 'old-acc', refresh_token: 'old-ref' })

    const rest = takeTokens({ id: 'user-1' })

    expect(rest).toEqual({ id: 'user-1' })
    expect(getAccessToken()).toBe('old-acc')
  })

  it('takeTokens ignores a half or empty pair', () => {
    takeTokens({ access_token: 'only-access' })
    expect(getAccessToken()).toBeNull()

    takeTokens({ access_token: '', refresh_token: '' })
    expect(getAccessToken()).toBeNull()
  })

  it('withAuthHeader is a no-op without a stored access token', () => {
    expect(withAuthHeader()).toBeUndefined()
    const headers = { 'Content-Type': 'application/json' }
    expect(withAuthHeader(headers)).toBe(headers)
  })

  it('withAuthHeader adds the bearer header to a record and keeps existing headers', () => {
    setTokens({ access_token: 'acc-3', refresh_token: 'ref-3' })

    expect(withAuthHeader({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer acc-3'
    })
  })

  it('withAuthHeader merges into a Headers instance', () => {
    setTokens({ access_token: 'acc-4', refresh_token: 'ref-4' })

    const merged = withAuthHeader(new Headers({ Accept: 'application/json' })) as Headers

    expect(merged.get('Authorization')).toBe('Bearer acc-4')
    expect(merged.get('Accept')).toBe('application/json')
  })
})
