import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '../src/lib/http'

const mockLogin = vi.fn()
const mockSignup = vi.fn()
const mockPush = vi.fn()

const mockLogout = vi.fn()
const mockUser = ref<Record<string, unknown> | null>(null)
const mockProfileImageSrc = ref<string | null>(null)

const mockServerUnreachable = { value: false }

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    login: mockLogin,
    signup: mockSignup,
    logout: mockLogout,
    user: mockUser,
    profileImageSrc: mockProfileImageSrc,
    serverUnreachable: mockServerUnreachable
  })
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ name: 'login', path: '/login' })
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import LoginPage from '../src/pages/LoginPage.vue'
import NavBar from '../src/components/NavBar.vue'

async function switchToSignup(wrapper: ReturnType<typeof mount>) {
  const switchButton = wrapper.findAll('button').find((btn) => btn.text().includes('Sign up'))
  await switchButton?.trigger('click')
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockSignup.mockReset()
    mockPush.mockReset()
    mockLogout.mockReset()
    mockUser.value = null
    mockServerUnreachable.value = false
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows a server-unreachable notice instead of crashing when the API is down', () => {
    mockServerUnreachable.value = true
    const wrapper = mount(LoginPage)

    expect(wrapper.find('[role=alert]').text()).toContain("Can't reach the server")
    expect(wrapper.find('form').exists()).toBe(true)
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

  describe('empty password field (.plan/039)', () => {
    const passwordSelector = 'input[placeholder="••••••••"]'

    function passwordEl(wrapper: ReturnType<typeof mount>) {
      return wrapper.find(passwordSelector).element as HTMLInputElement
    }

    function firePageShow(persisted: boolean) {
      const event = new Event('pageshow')
      Object.defineProperty(event, 'persisted', { value: persisted })
      window.dispatchEvent(event)
    }

    // Simulates browser autofill: the first time the password input's DOM value is set to ''
    // (Vue's v-model initialisation), the "browser" fills in a saved password right after.
    function simulateAutofillOnce() {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
      let filled = false
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        configurable: true,
        get: descriptor.get,
        set(this: HTMLInputElement, value: string) {
          descriptor.set!.call(this, value)
          if (!filled && value === '' && this.placeholder === '••••••••') {
            filled = true
            descriptor.set!.call(this, 'saved-password')
          }
        }
      })
      return () => {
        Object.defineProperty(HTMLInputElement.prototype, 'value', descriptor)
      }
    }

    it('sets autocomplete="new-password" on the password input in login and signup modes', async () => {
      const wrapper = mount(LoginPage)
      expect(wrapper.find(passwordSelector).attributes('autocomplete')).toBe('new-password')

      await switchToSignup(wrapper)
      expect(wrapper.find(passwordSelector).attributes('autocomplete')).toBe('new-password')
    })

    it('has an empty password on mount in both modes', async () => {
      const wrapper = mount(LoginPage)
      expect(passwordEl(wrapper).value).toBe('')

      await switchToSignup(wrapper)
      expect(passwordEl(wrapper).value).toBe('')
    })

    it('clears a password the browser autofilled into the DOM at mount', () => {
      const restore = simulateAutofillOnce()
      try {
        const wrapper = mount(LoginPage)
        expect(passwordEl(wrapper).value).toBe('')
      } finally {
        restore()
      }
    })

    it('clears a typed password and hides it again when switching between login and signup', async () => {
      const wrapper = mount(LoginPage)
      await wrapper.find(passwordSelector).setValue('secret123')
      await wrapper.find('.password-toggle').trigger('click')
      expect(wrapper.find(passwordSelector).attributes('type')).toBe('text')

      await switchToSignup(wrapper)
      expect(passwordEl(wrapper).value).toBe('')
      expect(wrapper.find(passwordSelector).attributes('type')).toBe('password')

      await wrapper.find(passwordSelector).setValue('another123')
      const backButton = wrapper.findAll('button').find((btn) => btn.text() === 'Log in' && btn.attributes('type') === 'button')
      await backButton?.trigger('click')
      expect(passwordEl(wrapper).value).toBe('')
    })

    it('clears the password on pageshow with persisted=true but leaves it on persisted=false', async () => {
      const wrapper = mount(LoginPage)
      await wrapper.find(passwordSelector).setValue('typed-by-user')

      firePageShow(false)
      await wrapper.vm.$nextTick()
      expect(passwordEl(wrapper).value).toBe('typed-by-user')

      passwordEl(wrapper).value = 'autofilled-from-bfcache'
      firePageShow(true)
      await wrapper.vm.$nextTick()
      expect(passwordEl(wrapper).value).toBe('')

      // state is cleared too: submitting now reports the missing password
      await wrapper.find('input[type=email]').setValue('rita@example.com')
      await wrapper.find('form').trigger('submit')
      expect(mockLogin).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Password is required')
    })

    it('removes the pageshow listener on unmount', () => {
      const add = vi.spyOn(window, 'addEventListener')
      const remove = vi.spyOn(window, 'removeEventListener')
      const wrapper = mount(LoginPage)
      const handler = add.mock.calls.find(([type]) => type === 'pageshow')?.[1]
      expect(handler).toBeTypeOf('function')

      wrapper.unmount()
      expect(remove).toHaveBeenCalledWith('pageshow', handler)
      add.mockRestore()
      remove.mockRestore()
    })

    it('shows an empty password field on the login page after logging out', async () => {
      mockUser.value = { id: 'u1', name: 'Rita', email: 'rita@example.com', role: 'recruiter', org_id: 'o', has_profile_image: false }
      mockLogout.mockResolvedValue(undefined)
      const navBar = mount(NavBar, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })

      await navBar.find('button[aria-label="Settings"]').trigger('click')
      await navBar.findAll('button').find((btn) => btn.text().includes('Logout'))?.trigger('click')
      await flushPromises()

      expect(mockLogout).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/login')

      const restore = simulateAutofillOnce()
      try {
        const loginPage = mount(LoginPage)
        expect(passwordEl(loginPage).value).toBe('')
        expect(loginPage.find(passwordSelector).attributes('autocomplete')).toBe('new-password')
      } finally {
        restore()
      }
    })

    it('does not carry the previous password into the field across login, logout and login again', async () => {
      mockLogin.mockResolvedValue({ id: 'u1', role: 'recruiter' })
      const first = mount(LoginPage)
      await first.find('input[type=email]').setValue('rita@example.com')
      await first.find(passwordSelector).setValue('secret123')
      await first.find('form').trigger('submit')
      await flushPromises()
      expect(mockLogin).toHaveBeenCalledWith('rita@example.com', 'secret123')
      first.unmount()

      const second = mount(LoginPage)
      expect(passwordEl(second).value).toBe('')
      await second.find('form').trigger('submit')
      expect(mockLogin).toHaveBeenCalledTimes(1)
      expect(second.text()).toContain('Password is required')
    })

    it('keeps the entered email after a failed login', async () => {
      mockLogin.mockRejectedValue(new ApiError('unauthorized', 'Invalid email or password'))
      const wrapper = mount(LoginPage)

      await wrapper.find('input[type=email]').setValue('rita@example.com')
      await wrapper.find(passwordSelector).setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect((wrapper.find('input[type=email]').element as HTMLInputElement).value).toBe('rita@example.com')
      expect(wrapper.text()).toContain('Invalid email or password')
    })
  })
})
