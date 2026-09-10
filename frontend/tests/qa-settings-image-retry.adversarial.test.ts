// QA adversarial coverage for .plan/024-2026-08-11-profile-image-live-update.md, step 2.
// The fix clears previewUrl/profileImageFile after a *successful* submit. The risk it introduces
// is clearing them too eagerly: if the clear ever ran on a failed submit, the user would lose
// their selected file and the retry would silently save everything except the image.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '../src/lib/http'

const mockUser = ref<Record<string, unknown>>({
  id: 'u1',
  name: 'Rita Recruiter',
  email: 'rita@example.com',
  role: 'recruiter',
  org_id: 'demo-org',
  has_profile_image: false
})
const mockProfileImageUrl = ref<string | null>(null)
const mockUpdateProfile = vi.fn()
const mockFetchMe = vi.fn()

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    profileImageUrl: mockProfileImageUrl,
    updateProfile: mockUpdateProfile,
    fetchMe: mockFetchMe
  })
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import SettingsPage from '../src/pages/SettingsPage.vue'

function attachFile(wrapper: ReturnType<typeof mount>, selector: string, file: File) {
  const input = wrapper.find(selector)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  return input.trigger('change')
}

describe('SettingsPage — image selection survives a failed submit', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Rita Recruiter',
      email: 'rita@example.com',
      role: 'recruiter',
      org_id: 'demo-org',
      has_profile_image: false
    }
    mockProfileImageUrl.value = null
    mockUpdateProfile.mockReset()
    mockFetchMe.mockReset()
  })

  it('keeps the preview and the file for a retry when the submit fails, then saves the image on retry', async () => {
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:preview-url')
    URL.revokeObjectURL = vi.fn()

    const wrapper = mount(SettingsPage)
    await flushPromises()

    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })
    await attachFile(wrapper, 'input[type=file]', file)
    expect(wrapper.find('.avatar img').attributes('src')).toBe('blob:preview-url')

    // First attempt: the network is down.
    mockUpdateProfile.mockRejectedValueOnce(new ApiError('internal_error', 'Network request failed'))
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Network request failed')
    // The selection must survive: the blob is not revoked and the preview still renders.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(wrapper.find('.avatar img').attributes('src')).toBe('blob:preview-url')

    // Second attempt: succeeds, and must still carry the originally chosen file.
    mockUpdateProfile.mockResolvedValueOnce({ ...mockUser.value, has_profile_image: true })
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledTimes(2)
    expect(mockUpdateProfile).toHaveBeenLastCalledWith(expect.objectContaining({ profile_image: file }))

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevoke
  })

  it('after a failed submit the remove button still discards locally rather than calling the server', async () => {
    // The mirror of the success-path regression: while the file is still an *unsaved* selection,
    // remove must stay local — the server was never told about it in the first place.
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:preview-url')
    URL.revokeObjectURL = vi.fn()

    const wrapper = mount(SettingsPage)
    await flushPromises()

    await attachFile(wrapper, 'input[type=file]', new File(['b'], 'a.png', { type: 'image/png' }))

    mockUpdateProfile.mockRejectedValueOnce(new ApiError('internal_error', 'Network request failed'))
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    await wrapper.find('.avatar-picker-remove').trigger('click')
    await flushPromises()

    // Only the failed save — no remove_profile_image round-trip for an image the server never got.
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.avatar img').exists()).toBe(false)

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevoke
  })
})
