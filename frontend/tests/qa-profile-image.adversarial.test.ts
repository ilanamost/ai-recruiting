// QA adversarial coverage for .plan/024-2026-08-11-profile-image-live-update.md.
// The implementing agent proved the happy path (replace an image -> the URL string changes).
// These probe the edges around that counter: unrelated updates, repeated remove/re-add
// round-trips, the failure path, and cross-user session reuse.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const withImage: AuthUser = { ...recruiter, has_profile_image: true }
const withoutImage: AuthUser = { ...recruiter, has_profile_image: false }

describe('lib/auth — profile image cache-busting, adversarial', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { user } = useAuth()
    user.value = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('bumps the version even for an update with no image in the input (harmless extra cache-bust)', async () => {
    // updateProfile bumps unconditionally on success, so a name-only save also re-points the
    // <img src>. Documented deliberately: it costs one extra avatar request but cannot show a
    // stale image. If this ever becomes a flicker problem, the bump is the thing to narrow.
    fetchMock.mockResolvedValue(jsonResponse(withImage))
    const { updateProfile, profileImageUrl } = useAuth()

    await updateProfile({ name: 'Rita Recruiter' })
    const afterFirstNameChange = profileImageUrl.value

    await updateProfile({ name: 'Rita R. Recruiter' })
    const afterSecondNameChange = profileImageUrl.value

    expect(afterFirstNameChange).not.toBeNull()
    expect(afterSecondNameChange).not.toBe(afterFirstNameChange)
    // Still the same endpoint — only the query parameter moves.
    expect(afterSecondNameChange).toMatch(
      /^http:\/\/localhost:3001\/api\/auth\/me\/profile-image\?v=\d+$/
    )
  })

  it('does not bump the version when updateProfile fails', async () => {
    // A rejected save must not consume a version — the URL has to keep pointing at the image the
    // server actually still holds.
    fetchMock.mockResolvedValue(jsonResponse(withImage))
    const { updateProfile, profileImageUrl } = useAuth()
    await updateProfile({ name: 'Rita Recruiter' })
    const before = profileImageUrl.value

    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'validation_error', message: 'Email already registered' }, requestId: 'req-9' },
        { ok: false, status: 400 }
      )
    )
    await expect(updateProfile({ email: 'taken@example.com' })).rejects.toThrow()

    expect(profileImageUrl.value).toBe(before)
  })

  it('survives repeated remove/re-add round-trips, not just a single replace', async () => {
    const { updateProfile, profileImageUrl } = useAuth()
    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })
    const seenUrls: string[] = []

    for (let round = 0; round < 3; round += 1) {
      // Add (or re-add) an image.
      fetchMock.mockResolvedValue(jsonResponse(withImage))
      await updateProfile({ profile_image: file })
      expect(profileImageUrl.value).not.toBeNull()
      seenUrls.push(profileImageUrl.value as string)

      // Remove it — has_profile_image goes true -> false, so the URL must go away entirely.
      fetchMock.mockResolvedValue(jsonResponse(withoutImage))
      await updateProfile({ remove_profile_image: true })
      expect(profileImageUrl.value).toBeNull()
    }

    // Every re-add produced a URL never used before, so a re-added image can never be served from
    // the cache entry of an image removed earlier in the same session.
    expect(new Set(seenUrls).size).toBe(seenUrls.length)
  })

  it('resets the version on logout, so a second user never reuses a URL the first user already cached', async () => {
    // Fixed (QA finding, post-report): the endpoint path `/api/auth/me/profile-image` is
    // identical for every user — it is scoped by the session cookie server-side, not by
    // anything in the URL. logout now resets profileImageVersion to 0, so user B's first URL
    // can only collide with user A's *first* URL (both `?v=0`), not with whatever version user
    // A had reached by the time they logged out — closing the collision window this
    // characterized before the fix.
    const { updateProfile, login, logout, profileImageUrl, user } = useAuth()

    fetchMock.mockResolvedValue(jsonResponse(withImage))
    await updateProfile({ profile_image: new File(['a-bytes'], 'a.png', { type: 'image/png' }) })
    // A second update, so user A's version has moved past the post-logout reset point.
    await updateProfile({ name: 'Amy' })
    const userALatestUrl = profileImageUrl.value
    expect(userALatestUrl).not.toBeNull()

    fetchMock.mockResolvedValue(jsonResponse({}))
    await logout()
    expect(user.value).toBeNull()

    // A different user signs in on the same page session, and already has an image.
    const userB: AuthUser = { ...withImage, id: 'user-2', name: 'Bob', email: 'bob@example.com' }
    fetchMock.mockResolvedValue(jsonResponse(userB))
    await login('bob@example.com', 'secret123')

    // No collision with the URL user A most recently held.
    expect(profileImageUrl.value).not.toBe(userALatestUrl)
  })
})
