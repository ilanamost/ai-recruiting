import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/lib/http'
import { type AuthUser, useAuth } from '../src/lib/auth'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response
}

const recruiter: AuthUser = {
  id: 'user-1',
  name: 'Rita Recruiter',
  email: 'rita@example.com',
  role: 'recruiter',
  org_id: 'demo-org',
  has_profile_image: false
}

describe('lib/auth — useAuth', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // Reset the module-level singleton state between tests.
    const { user } = useAuth()
    user.value = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('login sends credentials and sets the user on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recruiter))
    const { login, user } = useAuth()

    const result = await login('rita@example.com', 'secret123')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rita@example.com', password: 'secret123' })
    })
    expect(result).toEqual(recruiter)
    expect(user.value).toEqual(recruiter)
  })

  it('login throws an ApiError and leaves the user unset on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'unauthorized', message: 'Invalid email or password' }, requestId: 'req-1' },
        { ok: false, status: 401 }
      )
    )
    const { login, user } = useAuth()

    await expect(login('rita@example.com', 'wrong')).rejects.toThrow(ApiError)
    expect(user.value).toBeNull()
  })

  it('signup sends name/email/password/role and sets the user on success', async () => {
    const candidate = { ...recruiter, id: 'user-2', role: 'candidate' }
    fetchMock.mockResolvedValue(jsonResponse(candidate))
    const { signup, user } = useAuth()

    const result = await signup('Cara Candidate', 'cara@example.com', 'secret123', 'candidate')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/auth/signup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cara Candidate', email: 'cara@example.com', password: 'secret123', role: 'candidate' })
    })
    expect(result).toEqual(candidate)
    expect(user.value).toEqual(candidate)
  })

  it('fetchMe sets the user on a 200 and clears it on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(recruiter))
    const { fetchMe, user } = useAuth()

    await fetchMe()
    expect(user.value).toEqual(recruiter)

    // Both the GET /api/auth/me call and apiFetch's subsequent refresh attempt 401 here, so
    // apiFetch gives up and returns the original 401 — fetchMe then clears the user.
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }))
    await fetchMe()
    expect(user.value).toBeNull()
  })

  it('logout clears the user even if the request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(recruiter))
    const { login, logout, user } = useAuth()
    await login('rita@example.com', 'secret123')
    expect(user.value).not.toBeNull()

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await logout()

    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:3001/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    })
    expect(user.value).toBeNull()
  })

  it('updateProfile sends a multipart form and updates the user on success', async () => {
    const updated = { ...recruiter, name: 'Rita R. Recruiter' }
    fetchMock.mockResolvedValue(jsonResponse(updated))
    const { updateProfile, user } = useAuth()

    await updateProfile({ name: 'Rita R. Recruiter', email: 'rita@example.com' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/auth/me')
    expect(init.method).toBe('PATCH')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('name')).toBe('Rita R. Recruiter')
    expect(init.credentials).toBe('include')
    expect(user.value).toEqual(updated)
  })

  it('updateProfile only includes new_password/current_password when a new password is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recruiter))
    const { updateProfile } = useAuth()

    await updateProfile({ name: 'Rita Recruiter', email: 'rita@example.com' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body.has('new_password')).toBe(false)
    expect(init.body.has('current_password')).toBe(false)
  })

  it('updateProfile includes the new/current password and profile image when provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse(recruiter))
    const { updateProfile } = useAuth()
    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })

    await updateProfile({
      name: 'Rita Recruiter',
      email: 'rita@example.com',
      new_password: 'newpass123',
      current_password: 'oldpass123',
      profile_image: file
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body.get('new_password')).toBe('newpass123')
    expect(init.body.get('current_password')).toBe('oldpass123')
    expect(init.body.get('profile_image')).toBe(file)
  })

  it('profileImageUrl reflects has_profile_image on the current user', async () => {
    const { profileImageUrl, user } = useAuth()

    user.value = { ...recruiter, has_profile_image: false }
    expect(profileImageUrl.value).toBeNull()

    // The version query parameter is module-level session state, so its exact value depends on how
    // many updateProfile calls have run — the shape is what matters here.
    user.value = { ...recruiter, has_profile_image: true }
    expect(profileImageUrl.value).toMatch(
      /^http:\/\/localhost:3001\/api\/auth\/me\/profile-image\?v=\d+$/
    )
  })

  it('profileImageUrl changes after each successful updateProfile even when has_profile_image stays true', async () => {
    // The regression: replacing an already-set image leaves has_profile_image true both times, so
    // without a version counter the URL string was identical and nothing re-rendered or re-fetched.
    const withImage = { ...recruiter, has_profile_image: true }
    fetchMock.mockResolvedValue(jsonResponse(withImage))
    const { updateProfile, profileImageUrl } = useAuth()
    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })

    await updateProfile({ profile_image: file })
    const firstUrl = profileImageUrl.value

    await updateProfile({ profile_image: file })
    const secondUrl = profileImageUrl.value

    expect(firstUrl).not.toBeNull()
    expect(secondUrl).not.toBeNull()
    expect(secondUrl).not.toBe(firstUrl)
  })
})
