import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { AuthUser } from '../src/lib/auth'

// .plan/036 R2-2: a browser-loaded <img src> can't send `Authorization: Bearer`, so on iOS Safari
// the avatar 401'd. lib/auth now fetches the image through apiFetch and exposes it as an object
// URL (profileImageSrc). lib/auth is a module-level singleton, so each test imports a fresh copy.

const withImage: AuthUser = {
  id: 'user-1',
  name: 'Rita Recruiter',
  email: 'rita@example.com',
  role: 'recruiter',
  org_id: 'demo-org',
  has_profile_image: true
}

function imageResponse() {
  return { ok: true, status: 200, blob: async () => new Blob(['png-bytes'], { type: 'image/png' }) } as Response
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

async function freshAuth() {
  vi.resetModules()
  const { useAuth } = await import('../src/lib/auth')
  return useAuth()
}

function profileImageCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/me/profile-image'))
}

describe('lib/auth — profileImageSrc (.plan/036 R2-2)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let objectUrlCount: number

  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    objectUrlCount = 0
    URL.createObjectURL = vi.fn(() => {
      objectUrlCount += 1
      return `blob:avatar-${objectUrlCount}`
    })
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    localStorage.clear()
  })

  it('is null when there is no user or the user has no profile image, and fetches nothing', async () => {
    const { user, profileImageSrc } = await freshAuth()
    expect(profileImageSrc.value).toBeNull()

    user.value = { ...withImage, has_profile_image: false }
    await flushPromises()

    expect(profileImageSrc.value).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the image with the bearer header and exposes it as a blob URL', async () => {
    localStorage.setItem('access_token', 'access-abc')
    fetchMock.mockResolvedValue(imageResponse())
    const { user, profileImageUrl, profileImageSrc } = await freshAuth()

    user.value = withImage
    await flushPromises()

    expect(profileImageSrc.value).toBe('blob:avatar-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(profileImageUrl.value)
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-abc')
    // profileImageUrl is unchanged — it is still the endpoint URL, not the blob.
    expect(profileImageUrl.value).toMatch(/^http:\/\/localhost:3001\/api\/auth\/me\/profile-image\?v=\d+$/)
  })

  it('re-fetches after updateProfile bumps the version and revokes the previous blob URL', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/profile-image') ? imageResponse() : jsonResponse(withImage)
    )
    const { user, profileImageSrc, updateProfile } = await freshAuth()

    user.value = withImage
    await flushPromises()
    expect(profileImageSrc.value).toBe('blob:avatar-1')

    await updateProfile({ profile_image: new File(['new'], 'avatar.png', { type: 'image/png' }) })
    await flushPromises()

    expect(profileImageSrc.value).toBe('blob:avatar-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1')
    const imageUrls = profileImageCalls(fetchMock).map(([url]) => String(url))
    expect(imageUrls).toHaveLength(2)
    expect(imageUrls[1]).not.toBe(imageUrls[0])
  })

  it('clears and revokes when the image is removed', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/profile-image') ? imageResponse() : jsonResponse({ ...withImage, has_profile_image: false })
    )
    const { user, profileImageSrc, updateProfile } = await freshAuth()
    user.value = withImage
    await flushPromises()
    expect(profileImageSrc.value).toBe('blob:avatar-1')

    await updateProfile({ remove_profile_image: true })
    await flushPromises()

    expect(profileImageSrc.value).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1')
  })

  it('clears and revokes on logout', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/profile-image') ? imageResponse() : jsonResponse({})
    )
    const { user, profileImageSrc, logout } = await freshAuth()
    user.value = withImage
    await flushPromises()
    expect(profileImageSrc.value).toBe('blob:avatar-1')

    await logout()
    await flushPromises()

    expect(profileImageSrc.value).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1')
  })

  it('swallows a failed image fetch and stays null so the default icon shows', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response)
    const { user, profileImageSrc } = await freshAuth()

    user.value = withImage
    await flushPromises()

    expect(profileImageSrc.value).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('swallows a network rejection too', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { user, profileImageSrc } = await freshAuth()

    user.value = withImage
    await flushPromises()

    expect(profileImageSrc.value).toBeNull()
  })

  it('ignores a stale response that resolves after a newer version was requested', async () => {
    const resolvers: ((value: Response) => void)[] = []
    fetchMock.mockImplementation((url: string) =>
      url.includes('/profile-image')
        ? new Promise<Response>((resolve) => resolvers.push(resolve))
        : Promise.resolve(jsonResponse(withImage))
    )
    const { user, profileImageSrc, updateProfile } = await freshAuth()

    user.value = withImage
    await flushPromises()
    await updateProfile({ name: 'Rita R.' })
    await flushPromises()
    expect(resolvers).toHaveLength(2)

    // The newer request lands first, then the older one.
    resolvers[1](imageResponse())
    await flushPromises()
    resolvers[0](imageResponse())
    await flushPromises()

    expect(profileImageSrc.value).toBe('blob:avatar-1')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })
})
