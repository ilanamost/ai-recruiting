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
import { toast } from 'vue-sonner'

function attachFile(wrapper: ReturnType<typeof mount>, selector: string, file: File) {
  const input = wrapper.find(selector)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  return input.trigger('change')
}

describe('SettingsPage', () => {
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
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('prefills name and email from the current user', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('Rita Recruiter')
    expect((wrapper.find('input[type=email]').element as HTMLInputElement).value).toBe('rita@example.com')
  })

  it('submits an updated name/email and shows a success toast', async () => {
    mockUpdateProfile.mockResolvedValue({ ...mockUser.value, name: 'Rita R.' })
    const wrapper = mount(SettingsPage)
    await flushPromises()

    await wrapper.find('input[type=text]').setValue('Rita R.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith({ name: 'Rita R.', email: 'rita@example.com' })
    expect(toast.success).toHaveBeenCalledWith('Settings updated')
  })

  it('omits new_password/current_password when no new password is entered', async () => {
    mockUpdateProfile.mockResolvedValue(mockUser.value)
    const wrapper = mount(SettingsPage)
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith({ name: 'Rita Recruiter', email: 'rita@example.com' })
  })

  it('requires a current password before submitting a new password', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const passwordInputs = wrapper.findAll('input[type=password]')
    await passwordInputs[1].setValue('newpass123')
    await wrapper.find('form').trigger('submit')

    expect(mockUpdateProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Current password is required to set a new password')
  })

  it('submits a password change with both current and new password', async () => {
    mockUpdateProfile.mockResolvedValue(mockUser.value)
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const passwordInputs = wrapper.findAll('input[type=password]')
    await passwordInputs[0].setValue('oldpass123')
    await passwordInputs[1].setValue('newpass123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith({
      name: 'Rita Recruiter',
      email: 'rita@example.com',
      new_password: 'newpass123',
      current_password: 'oldpass123'
    })
  })

  it('shows a live local preview of a selected profile image before upload, and submits it', async () => {
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:preview-url')
    URL.revokeObjectURL = vi.fn()

    mockUpdateProfile.mockResolvedValue(mockUser.value)
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })
    await attachFile(wrapper, 'input[type=file]', file)

    const img = wrapper.find('.avatar img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:preview-url')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith(expect.objectContaining({ profile_image: file }))

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevoke
  })

  it('shows a fallback icon with no img when there is no preview or existing profile image', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    expect(wrapper.find('.avatar img').exists()).toBe(false)
  })

  it('shows the API error message when the update fails', async () => {
    mockUpdateProfile.mockRejectedValue(new ApiError('validation_error', 'Email already registered'))
    const wrapper = mount(SettingsPage)
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Email already registered')
  })

  it('shows an editable role select for a recruiter, offering Recruiter and Candidate only', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    const values = select.findAll('option').map((option) => option.attributes('value'))
    expect(values).toEqual(['recruiter', 'candidate'])
    expect((select.element as HTMLSelectElement).value).toBe('recruiter')
  })

  it('shows a static "Admin (set via database)" label instead of a select for an admin', async () => {
    mockUser.value = { ...mockUser.value, role: 'admin' }
    const wrapper = mount(SettingsPage)
    await flushPromises()

    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Admin')
    expect(wrapper.text()).toContain('set via database')
  })

  it('submits a role change only when it differs from the current role', async () => {
    mockUpdateProfile.mockResolvedValue(mockUser.value)
    const wrapper = mount(SettingsPage)
    await flushPromises()

    await wrapper.find('select').setValue('candidate')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'candidate' })
    )
  })

  it('does not include role in the payload when it is left unchanged', async () => {
    mockUpdateProfile.mockResolvedValue(mockUser.value)
    const wrapper = mount(SettingsPage)
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({ role: expect.anything() })
    )
  })

  it('toggles a password field between hidden and visible text', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const toggles = wrapper.findAll('.password-toggle')
    expect(toggles).toHaveLength(2)

    await toggles[1].trigger('click')

    const passwordInputs = wrapper.findAll('input[type=password]')
    expect(passwordInputs).toHaveLength(1)
  })

  it('shows a name-required validation error after an empty submit', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    await wrapper.find('input[type=text]').setValue('')
    await wrapper.find('form').trigger('submit')

    expect(mockUpdateProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Name is required')
  })

  it('has no visible native file input control (click-the-circle upload instead)', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const fileInput = wrapper.find('input[type=file]')
    expect(fileInput.exists()).toBe(true)
    expect(fileInput.classes()).toContain('hidden')
  })

  it('does not show a remove-image button when there is no image', async () => {
    const wrapper = mount(SettingsPage)
    await flushPromises()

    expect(wrapper.find('.avatar-picker-remove').exists()).toBe(false)
  })

  it('shows a remove-image button and clears an existing profile image on click', async () => {
    mockProfileImageUrl.value = 'http://localhost:3001/api/auth/me/profile-image'
    mockUpdateProfile.mockResolvedValue({ ...mockUser.value, has_profile_image: false })
    const wrapper = mount(SettingsPage)
    await flushPromises()

    const removeButton = wrapper.find('.avatar-picker-remove')
    expect(removeButton.exists()).toBe(true)

    await removeButton.trigger('click')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenCalledWith({ remove_profile_image: true })
    expect(toast.success).toHaveBeenCalledWith('Profile image removed')
  })

  it('removes the image on the server when clicking remove right after a successful upload', async () => {
    // Regression: a successful submit used to leave profileImageFile set, so removeImage() took the
    // "discard the unsaved local selection" branch and silently never told the server.
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:preview-url')
    URL.revokeObjectURL = vi.fn()

    mockUpdateProfile.mockImplementation(async () => {
      // Mirrors lib/auth: a successful save flips has_profile_image and republishes a versioned URL.
      mockProfileImageUrl.value = 'http://localhost:3001/api/auth/me/profile-image?v=1'
      return { ...mockUser.value, has_profile_image: true }
    })

    const wrapper = mount(SettingsPage)
    await flushPromises()

    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })
    await attachFile(wrapper, 'input[type=file]', file)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    // The local blob preview is released and the avatar falls back to the cache-busted server URL.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-url')
    expect(wrapper.find('.avatar img').attributes('src')).toBe(
      'http://localhost:3001/api/auth/me/profile-image?v=1'
    )

    await wrapper.find('.avatar-picker-remove').trigger('click')
    await flushPromises()

    expect(mockUpdateProfile).toHaveBeenLastCalledWith({ remove_profile_image: true })
    expect(toast.success).toHaveBeenCalledWith('Profile image removed')

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevoke
  })
})
