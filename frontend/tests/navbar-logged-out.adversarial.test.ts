// QA adversarial pass for .plan/040 (logged-out navbar).
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import * as sass from 'sass'

const mockUser = ref<Record<string, unknown> | null>(null)
const mockLogout = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    profileImageUrl: ref(null),
    profileImageSrc: ref(null),
    logout: mockLogout
  })
}))

import NavBar from '../src/components/NavBar.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/jobs', '/jobs/new', '/cvs', '/settings', '/login'].map((path) => ({
      path,
      name: path === '/' ? 'home' : path.slice(1),
      component: { template: '<div />' }
    }))
  })
}

async function mountAt(path: string) {
  const router = makeRouter()
  await router.push(path)
  return mount(NavBar, { global: { plugins: [router] }, attachTo: document.body })
}

const base = { id: 'u1', name: 'X', email: 'x@e.com', org_id: 'o', has_profile_image: false }

describe('logged-out navbar — adversarial', () => {
  beforeEach(() => {
    mockUser.value = null
    document.body.innerHTML = ''
  })

  it.each([
    ['admin', ['New job', 'Jobs', 'CVs']],
    ['recruiter', ['New job', 'Jobs']],
    ['candidate', ['Jobs', 'CVs']]
  ])('signed-in %s keeps brand link, links, hamburger and gear', async (role, links) => {
    mockUser.value = { ...base, role }
    const wrapper = await mountAt('/')
    expect(wrapper.find('.navbar-brand').element.tagName).toBe('A')
    expect(wrapper.find('.navbar-brand').classes()).not.toContain('is-static')
    expect(wrapper.findAll('.navbar-link').map((l) => l.text())).toEqual(links)
    expect(wrapper.find('.navbar-hamburger').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('a user object with no role is still treated as signed in (documented behaviour)', async () => {
    mockUser.value = { ...base }
    const wrapper = await mountAt('/')
    expect(wrapper.find('.navbar-brand').element.tagName).toBe('A')
    expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(true)
    // role undefined passes both !== checks, so all three links render
    expect(wrapper.findAll('.navbar-link')).toHaveLength(3)
    wrapper.unmount()
  })

  it('falsy-but-present user shapes: empty object is signed in, undefined is signed out', async () => {
    mockUser.value = undefined as unknown as null
    const out = await mountAt('/login')
    expect(out.find('.navbar-links').exists()).toBe(false)
    out.unmount()
    mockUser.value = {}
    const inn = await mountAt('/')
    expect(inn.find('.navbar-links').exists()).toBe(true)
    inn.unmount()
  })

  it('signed out: no focusable element in the navbar besides the theme toggle', async () => {
    const wrapper = await mountAt('/login')
    const focusable = wrapper.element.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    expect(focusable).toHaveLength(1)
    expect((focusable[0] as HTMLElement).classList.contains('theme-toggle')).toBe(true)
    // Tab target order: brand cannot take focus
    const brand = wrapper.find('.navbar-brand').element as HTMLElement
    brand.focus()
    expect(document.activeElement).not.toBe(brand)
    wrapper.unmount()
  })

  it('brand exposes name as plain text with no misleading role and no click handler side effects', async () => {
    const router = makeRouter()
    await router.push('/login')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })
    const brand = wrapper.find('.navbar-brand')
    expect(brand.attributes('role')).toBeUndefined()
    expect(brand.attributes('aria-disabled')).toBeUndefined()
    await brand.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/login')
    wrapper.unmount()
  })

  it('logout while mobile menu AND settings menu are open leaves no teleported overlays in body', async () => {
    mockUser.value = { ...base, role: 'admin' }
    const wrapper = await mountAt('/')
    await wrapper.find('.navbar-hamburger').trigger('click')
    await wrapper.find('button[aria-label="Settings"]').trigger('click')
    expect(document.body.querySelector('.navbar-mobile-overlay')).not.toBeNull()
    expect(document.body.querySelector('.navbar-settings-overlay')).not.toBeNull()
    mockUser.value = null
    await flushPromises()
    expect(document.body.querySelector('.navbar-mobile-overlay')).toBeNull()
    expect(document.body.querySelector('.navbar-settings-overlay')).toBeNull()
    wrapper.unmount()
  })

  it('rapid login/logout flapping ends in the state of the last write, with no leaked overlays', async () => {
    const wrapper = await mountAt('/')
    for (let i = 0; i < 25; i++) {
      mockUser.value = { ...base, role: 'candidate' }
      await flushPromises()
      await wrapper.find('.navbar-hamburger').trigger('click')
      mockUser.value = null
      await flushPromises()
    }
    expect(wrapper.find('.navbar-links').exists()).toBe(false)
    expect(document.body.querySelectorAll('.navbar-mobile-overlay')).toHaveLength(0)
    mockUser.value = { ...base, role: 'candidate' }
    await flushPromises()
    expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
    wrapper.unmount()
  })

  it('compiled CSS: .is-static overrides hover/active colour with enough specificity and later order', () => {
    const css = sass.compile(resolve(process.cwd(), 'src/styles/cmps/navbar.scss')).css
    const hoverIdx = css.indexOf('.navbar-brand:hover')
    const staticHoverIdx = css.indexOf('.navbar-brand.is-static:hover')
    expect(hoverIdx).toBeGreaterThan(-1)
    expect(staticHoverIdx).toBeGreaterThan(hoverIdx)
    // (0,3,0) vs (0,2,0): static wins; also it has no is-active class in the template
    expect(css).toMatch(/\.navbar-brand\.is-static\s*\{[^}]*cursor:\s*default/)
    expect(css).toMatch(/\.navbar-brand\.is-static:hover\s*\{[^}]*color:\s*var\(--fg\)/)
    // static div never gets the .is-active class
    expect(css).not.toMatch(/\.navbar-brand\.is-static\.is-active/)
  })

  it('compiled CSS: phone breakpoint hides wordmark but .navbar-actions stays right-aligned', () => {
    const css = sass.compile(resolve(process.cwd(), 'src/styles/cmps/navbar.scss')).css
    expect(css).toMatch(/\.navbar-actions\s*\{[^}]*margin-left:\s*auto/)
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.navbar-brand-text\s*\{\s*display:\s*none/)
  })
})
