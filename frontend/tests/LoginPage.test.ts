import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '../src/lib/http'

const mockLogin = vi.fn()
const mockSignup = vi.fn()
const mockPush = vi.fn()

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ login: mockLogin, signup: mockSignup })
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush })
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import LoginPage from '../src/pages/LoginPage.vue'

async function switchToSignup(wrapper: ReturnType<typeof mount>) {
  const switchButton = wrapper.findAll('button').find((btn) => btn.text().includes('Sign up'))
  await switchButton?.trigger('click')
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockSignup.mockReset()
    mockPush.mockReset()
  })

  it('logs in with email and password and redirects to /', async () => {
    mockLogin.mockResolvedValue({ id: 'u1', role: 'recruiter' })
    const wrapper = mount(LoginPage)

    await wrapper.find('input[type=email]').setValue('rita@example.com')
    await wrapper.find('input[type=password]').setValue('secret123')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockLogin).toHaveBeenCalledWith('rita@example.com', 'secret123')
    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('shows per-field validation errors and does not call login when fields are missing', async () => {
    const wrapper = mount(LoginPage)

    await wrapper.find('form').trigger('submit')

    expect(mockLogin).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Email is required')
    expect(wrapper.text()).toContain('Password is required')
  })

  it('marks invalid fields with the input-invalid class only after a submit attempt', async () => {
    const wrapper = mount(LoginPage)

    expect(wrapper.find('input[type=email]').classes()).not.toContain('input-invalid')

    await wrapper.find('form').trigger('submit')

    expect(wrapper.find('input[type=email]').classes()).toContain('input-invalid')
  })

  it('shows the API error message on failed login', async () => {
    mockLogin.mockRejectedValue(new ApiError('unauthorized', 'Invalid email or password'))
    const wrapper = mount(LoginPage)

    await wrapper.find('input[type=email]').setValue('rita@example.com')
    await wrapper.find('input[type=password]').setValue('wrong')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Invalid email or password')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('toggles the password field between hidden and visible text', async () => {
    const wrapper = mount(LoginPage)

    const passwordInput = wrapper.find('input[type=password]')
    expect(passwordInput.exists()).toBe(true)

    const toggle = wrapper.find('.password-toggle')
    await toggle.trigger('click')

    expect(wrapper.find('input[type=text][placeholder="••••••••"]').exists()).toBe(true)
  })

  it('toggles to the signup form and shows a name field plus a role select', async () => {
    const wrapper = mount(LoginPage)

    expect(wrapper.find('select').exists()).toBe(false)

    await switchToSignup(wrapper)

    expect(wrapper.find('input[type=text]').exists()).toBe(true)
    expect(wrapper.find('select').exists()).toBe(true)
  })

  it('signup only offers Recruiter and Candidate as role choices, never Admin', async () => {
    const wrapper = mount(LoginPage)
    await switchToSignup(wrapper)

    const options = wrapper.find('select').findAll('option')
    const values = options.map((option) => option.attributes('value'))
    expect(values).toEqual(['', 'recruiter', 'candidate'])
    expect(wrapper.text()).not.toContain('Admin')
  })

  it('signs up with name/email/password/role and redirects to /', async () => {
    mockSignup.mockResolvedValue({ id: 'u2', role: 'candidate' })
    const wrapper = mount(LoginPage)
    await switchToSignup(wrapper)

    await wrapper.find('input[type=text]').setValue('Cara Candidate')
    await wrapper.find('input[type=email]').setValue('cara@example.com')
    await wrapper.find('input[type=password]').setValue('secret123')
    await wrapper.find('select').setValue('candidate')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockSignup).toHaveBeenCalledWith('Cara Candidate', 'cara@example.com', 'secret123', 'candidate')
    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('requires a role to be selected on signup', async () => {
    const wrapper = mount(LoginPage)
    await switchToSignup(wrapper)

    await wrapper.find('input[type=text]').setValue('Cara Candidate')
    await wrapper.find('input[type=email]').setValue('cara@example.com')
    await wrapper.find('input[type=password]').setValue('secret123')
    await wrapper.find('form').trigger('submit')

    expect(mockSignup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Please select a role')
  })

  it('shows a validation error on signup when name is missing', async () => {
    const wrapper = mount(LoginPage)
    await switchToSignup(wrapper)

    await wrapper.find('input[type=email]').setValue('cara@example.com')
    await wrapper.find('input[type=password]').setValue('secret123')
    await wrapper.find('select').setValue('candidate')
    await wrapper.find('form').trigger('submit')

    expect(mockSignup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Name is required')
  })

  it('requires the signup password to be at least 8 characters', async () => {
    const wrapper = mount(LoginPage)
    await switchToSignup(wrapper)

    await wrapper.find('input[type=text]').setValue('Cara Candidate')
    await wrapper.find('input[type=email]').setValue('cara@example.com')
    await wrapper.find('input[type=password]').setValue('short')
    await wrapper.find('select').setValue('candidate')
    await wrapper.find('form').trigger('submit')

    expect(mockSignup).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Password must be at least 8 characters')
  })
})
