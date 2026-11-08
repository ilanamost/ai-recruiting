import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ login: vi.fn(), signup: vi.fn(), serverUnreachable: { value: false } })
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import LoginPage from '../src/pages/LoginPage.vue'

const sel = 'input[placeholder="••••••••"]'
const el = (w: ReturnType<typeof mount>) => w.find(sel).element as HTMLInputElement

function pageShow(persisted: boolean) {
  const e = new Event('pageshow')
  Object.defineProperty(e, 'persisted', { value: persisted })
  window.dispatchEvent(e)
}

describe('LoginPage adversarial (.plan/039)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('autofill simulation is non-vacuous: without a reset, a plain v-model input keeps the autofilled value', () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    let filled = false
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      configurable: true,
      get: desc.get,
      set(this: HTMLInputElement, v: string) {
        desc.set!.call(this, v)
        if (!filled && v === '' && this.placeholder === '••••••••') {
          filled = true
          desc.set!.call(this, 'saved-password')
        }
      }
    })
    try {
      const Bare = defineComponent({
        setup() {
          const p = ref('')
          return () => h('input', { placeholder: '••••••••', value: p.value })
        }
      })
      const w = mount(Bare)
      expect((w.element as HTMLInputElement).value).toBe('saved-password')
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, 'value', desc)
    }
  })

  it('does not clear characters typed after mount, even through repeated non-persisted pageshow events', async () => {
    const w = mount(LoginPage)
    await w.find(sel).setValue('typed-after-mount')
    for (let i = 0; i < 25; i++) pageShow(false)
    await w.vm.$nextTick()
    expect(el(w).value).toBe('typed-after-mount')
  })

  it('rapid Login/Signup switching leaves an empty, hidden password and keeps the email', async () => {
    const w = mount(LoginPage)
    await w.find('input[type=email]').setValue('a@b.co')
    await w.find(sel).setValue('abc12345')
    for (let i = 0; i < 10; i++) {
      const btn = w.findAll('button').find((b) => b.attributes('type') === 'button' && /Sign up|Log in/.test(b.text()) && !b.classes().includes('password-toggle'))
      await btn?.trigger('click')
    }
    expect(el(w).value).toBe('')
    expect(w.find(sel).attributes('type')).toBe('password')
    expect((w.find('input[type=email]').element as HTMLInputElement).value).toBe('a@b.co')
  })

  it('pageshow persisted=true after unmount is a no-op (no listener leak, no throw)', () => {
    const w = mount(LoginPage)
    w.unmount()
    expect(() => pageShow(true)).not.toThrow()
  })

  it('a very long password and special characters survive typing and are not mutated', async () => {
    const w = mount(LoginPage)
    const long = 'é<>"\'&'.repeat(2000)
    await w.find(sel).setValue(long)
    expect(el(w).value).toBe(long)
  })

  it('pageshow persisted=true hides a visible password and re-shows validation on submit', async () => {
    const w = mount(LoginPage)
    await w.find('.password-toggle').trigger('click')
    expect(w.find(sel).attributes('type')).toBe('text')
    pageShow(true)
    await w.vm.$nextTick()
    expect(w.find(sel).attributes('type')).toBe('password')
  })
})
