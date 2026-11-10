import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const mockUser = ref<Record<string, unknown> | null>(null)
const mockProfileImageUrl = ref<string | null>(null)
// .plan/036 R2-2: the <img> renders lib/auth's blob URL, not the raw endpoint URL.
const mockProfileImageSrc = ref<string | null>(null)
const mockLogout = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    profileImageUrl: mockProfileImageUrl,
    profileImageSrc: mockProfileImageSrc,
    logout: mockLogout
  })
}))

import NavBar from '../src/components/NavBar.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/jobs', name: 'jobs-list', component: { template: '<div />' } },
      { path: '/jobs/new', name: 'job-new', component: { template: '<div />' } },
      { path: '/cvs', name: 'cvs-list', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } }
    ]
  })
}

describe('NavBar', () => {
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
    mockProfileImageSrc.value = null
    mockLogout.mockClear()
  })

  // .plan/015: a Recruiter reaches CVs only through a job's "Manage CVs" popup, so the
  // standalone /cvs destination is no longer offered in the nav for this role.
  it('hides CVs but keeps New job and Jobs for a recruiter', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const links = wrapper.findAll('.navbar-link')
    expect(links.map((link) => link.text())).toEqual(['New job', 'Jobs'])
  })

  it('renders no link pointing at /cvs for a recruiter', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const hrefs = wrapper.findAll('a').map((link) => link.attributes('href'))
    expect(hrefs).not.toContain('/cvs')
  })

  it('shows every link, CVs included, for an admin', async () => {
    mockUser.value = { ...mockUser.value, role: 'admin' }
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const links = wrapper.findAll('.navbar-link')
    expect(links.map((link) => link.text())).toEqual(['New job', 'Jobs', 'CVs'])
  })

  it('hides New job but keeps Jobs and CVs for a candidate (corrected 2026-08-04 #2)', async () => {
    mockUser.value = { ...mockUser.value, role: 'candidate' }
    const router = makeRouter()
    await router.push('/jobs')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const links = wrapper.findAll('.navbar-link')
    expect(links.map((link) => link.text())).toEqual(['Jobs', 'CVs'])
  })

  // .plan/017 reverses .plan/014 item 3: "/" is the home page now, a real destination for every
  // role, so the brand mark is a link again and its pointer cursor is no longer misleading.
  it('renders the brand mark as a link to /', async () => {
    const router = makeRouter()
    await router.push('/jobs')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const brand = wrapper.find('.navbar-brand')
    expect(brand.exists()).toBe(true)
    expect(brand.text()).toContain('AI Recruiting')
    expect(brand.element.tagName).toBe('A')
    expect(brand.attributes('href')).toBe('/')
    // The Sparkles icon survives the element swap.
    expect(brand.find('svg').exists()).toBe(true)
  })

  it('navigates to the home route when the brand mark is clicked', async () => {
    const router = makeRouter()
    await router.push('/jobs')
    await router.isReady()
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('.navbar-brand').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('marks the brand mark active on the home route and inactive elsewhere', async () => {
    const homeRouter = makeRouter()
    await homeRouter.push('/')
    const onHome = mount(NavBar, { global: { plugins: [homeRouter] } })
    expect(onHome.find('.navbar-brand').classes()).toContain('is-active')

    const jobsRouter = makeRouter()
    await jobsRouter.push('/jobs')
    const onJobs = mount(NavBar, { global: { plugins: [jobsRouter] } })
    expect(onJobs.find('.navbar-brand').classes()).not.toContain('is-active')
  })

  // Uses an admin so all three links are present — a recruiter no longer renders the CVs one.
  it('keeps the real nav links as anchors with their hrefs', async () => {
    mockUser.value = { ...mockUser.value, role: 'admin' }
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const links = wrapper.findAll('.navbar-link')
    expect(links.map((link) => link.element.tagName)).toEqual(['A', 'A', 'A'])
    expect(links.map((link) => link.attributes('href'))).toEqual(['/jobs/new', '/jobs', '/cvs'])
  })

  // .plan/017 moved the job-creation form off '/' so the home page could take it.
  it('points the New job link at /jobs/new and marks it active there', async () => {
    const router = makeRouter()
    await router.push('/jobs/new')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const newJob = wrapper.findAll('.navbar-link').find((link) => link.text().includes('New job'))
    expect(newJob?.attributes('href')).toBe('/jobs/new')
    expect(newJob?.classes()).toContain('is-active')
  })

  it('marks the Jobs link active when on the jobs list route', async () => {
    const router = makeRouter()
    await router.push('/jobs')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const jobsLink = wrapper.findAll('a').find((link) => link.text().includes('Jobs'))
    expect(jobsLink?.classes()).toContain('is-active')
  })

  it('renders a fallback user icon when no profile image is set', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    expect(wrapper.find('.avatar img').exists()).toBe(false)
  })

  it('renders the uploaded profile image from its blob URL when set', async () => {
    mockProfileImageUrl.value = 'http://localhost:3001/api/auth/me/profile-image?v=0'
    mockProfileImageSrc.value = 'blob:avatar-1'
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const img = wrapper.find('.avatar img')
    expect(img.exists()).toBe(true)
    // Never the endpoint itself: a browser-loaded <img src> can't send the bearer header (iOS).
    expect(img.attributes('src')).toBe('blob:avatar-1')
  })

  it('keeps the fallback icon while the image is still loading or failed to load', async () => {
    // profileImageUrl set (an image is stored) but no blob yet — must not render a broken <img>.
    mockProfileImageUrl.value = 'http://localhost:3001/api/auth/me/profile-image?v=0'
    mockProfileImageSrc.value = null
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    expect(wrapper.find('.avatar img').exists()).toBe(false)

    mockProfileImageSrc.value = 'blob:avatar-2'
    await flushPromises()
    expect(wrapper.find('.avatar img').attributes('src')).toBe('blob:avatar-2')
  })

  it('opens and closes the settings menu, showing User settings and Logout with icons', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    expect(wrapper.find('.navbar-menu').exists()).toBe(false)

    await wrapper.find('button[aria-label="Settings"]').trigger('click')
    expect(wrapper.find('.navbar-menu').exists()).toBe(true)
    const items = wrapper.findAll('.navbar-menu-item')
    expect(items.map((item) => item.text())).toEqual(['User settings', 'Logout'])
    expect(wrapper.find('.navbar-menu-item svg').exists()).toBe(true)

    await wrapper.find('button[aria-label="Settings"]').trigger('click')
    expect(wrapper.find('.navbar-menu').exists()).toBe(false)
  })

  it('navigates to /settings when User settings is clicked', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('button[aria-label="Settings"]').trigger('click')
    const settingsItem = wrapper.findAll('button').find((btn) => btn.text().includes('User settings'))
    await settingsItem?.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/settings')
  })

  // .plan/019: mobile nav. jsdom evaluates no CSS and no @media query, so these assert the DOM
  // structure and the JS-driven open/close state only — the breakpoint itself is verified by
  // grepping the built CSS, not here.
  it('renders a closed hamburger toggle by default', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const hamburger = wrapper.find('.navbar-hamburger')
    expect(hamburger.exists()).toBe(true)
    expect(hamburger.attributes('aria-expanded')).toBe('false')
    expect(hamburger.attributes('aria-label')).toBe('Open menu')
    expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
  })

  it('opens the mobile menu on hamburger click, swapping the Menu icon for X', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const hamburger = wrapper.find('.navbar-hamburger')
    const closedIcon = hamburger.find('svg').attributes('class')

    await hamburger.trigger('click')

    expect(hamburger.attributes('aria-expanded')).toBe('true')
    expect(hamburger.attributes('aria-label')).toBe('Close menu')
    expect(wrapper.find('.navbar-links').classes()).toContain('is-open')
    // The icon element itself is swapped, not merely restyled.
    expect(wrapper.find('.navbar-hamburger svg').attributes('class')).not.toBe(closedIcon)
  })

  it('closes the mobile menu when the hamburger is clicked again', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('.navbar-hamburger').trigger('click')
    await wrapper.find('.navbar-hamburger').trigger('click')

    expect(wrapper.find('.navbar-hamburger').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
  })

  it('closes the mobile menu when a nav link inside it is selected', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('.navbar-hamburger').trigger('click')
    expect(wrapper.find('.navbar-links').classes()).toContain('is-open')

    const jobsLink = wrapper.findAll('.navbar-link').find((link) => link.text().includes('Jobs'))
    await jobsLink?.trigger('click')
    await flushPromises()

    expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
    expect(router.currentRoute.value.path).toBe('/jobs')
  })

  it('closes the mobile menu when the click-outside overlay is clicked', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    // Teleported to <body> (.plan/019 post-QA fix), not a descendant of the mounted component's
    // own tree, so it's queried via document.body rather than wrapper.find().
    expect(document.body.querySelector('.navbar-mobile-overlay')).toBeNull()

    await wrapper.find('.navbar-hamburger').trigger('click')
    const overlayEl = document.body.querySelector('.navbar-mobile-overlay')
    expect(overlayEl).not.toBeNull()

    await new DOMWrapper(overlayEl!).trigger('click')

    expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
    expect(document.body.querySelector('.navbar-mobile-overlay')).toBeNull()
  })

  it('wraps the brand wordmark in its own element beside the icon', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const brand = wrapper.find('.navbar-brand')
    const brandText = brand.find('.navbar-brand-text')
    expect(brandText.exists()).toBe(true)
    expect(brandText.text()).toBe('AI Recruiting')
    // The icon stays an unwrapped sibling, so the two are independently targetable by CSS.
    expect(brandText.find('svg').exists()).toBe(false)
    expect(brand.find('svg').exists()).toBe(true)
  })

  it('leaves the mobile menu closed when the settings menu is opened', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('button[aria-label="Settings"]').trigger('click')

    expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
    expect(wrapper.find('.navbar-hamburger').attributes('aria-expanded')).toBe('false')
  })

  it('logs out and redirects to /login when Logout is clicked', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('button[aria-label="Settings"]').trigger('click')
    const logoutItem = wrapper.findAll('button').find((btn) => btn.text().includes('Logout'))
    await logoutItem?.trigger('click')
    await flushPromises()

    expect(mockLogout).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/login')
  })

  // .plan/040: signed-out navbar — brand (static), theme toggle and avatar placeholder only.
  describe('signed out (.plan/040)', () => {
    const adminUser = {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }

    beforeEach(() => {
      mockUser.value = null
    })

    async function mountSignedOut() {
      const router = makeRouter()
      await router.push('/login')
      return mount(NavBar, { global: { plugins: [router] } })
    }

    function readScss() {
      // vitest runs from frontend/ (jsdom's import.meta.url is not a file: URL).
      return readFileSync(resolve(process.cwd(), 'src/styles/cmps/navbar.scss'), 'utf-8')
    }

    it('renders no link and no button other than the theme toggle', async () => {
      const wrapper = await mountSignedOut()

      expect(wrapper.findAll('a[href]')).toHaveLength(0)
      const buttons = wrapper.findAll('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].classes()).toContain('theme-toggle')
      expect(buttons[0].attributes('aria-label')).toMatch(/Switch to (light|dark) theme/)
    })

    it('shows the brand icon and name as a static, non-focusable element', async () => {
      const wrapper = await mountSignedOut()

      const brand = wrapper.find('.navbar-brand')
      expect(brand.exists()).toBe(true)
      expect(brand.text()).toBe('AI Recruiting')
      expect(brand.find('svg').exists()).toBe(true)
      expect(brand.element.tagName).not.toBe('A')
      expect(brand.element.closest('a')).toBeNull()
      expect(brand.attributes('href')).toBeUndefined()
      expect(brand.attributes('tabindex')).toBeUndefined()
      expect(brand.classes()).toContain('is-static')
    })

    it('renders no nav links, hamburger, gear or settings menu items', async () => {
      const wrapper = await mountSignedOut()

      for (const label of ['New job', 'Jobs', 'CVs', 'User settings', 'Logout']) {
        expect(wrapper.text()).not.toContain(label)
      }
      expect(wrapper.find('.navbar-links').exists()).toBe(false)
      expect(wrapper.find('.navbar-hamburger').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(false)
      expect(wrapper.find('.navbar-menu').exists()).toBe(false)
      expect(document.body.querySelector('.navbar-mobile-overlay')).toBeNull()
      expect(document.body.querySelector('.navbar-settings-overlay')).toBeNull()
    })

    it('keeps the avatar placeholder and a working theme toggle', async () => {
      const wrapper = await mountSignedOut()

      const avatar = wrapper.find('.avatar')
      expect(avatar.exists()).toBe(true)
      expect(avatar.find('img').exists()).toBe(false)
      expect(avatar.find('svg').exists()).toBe(true)

      const before = wrapper.find('.theme-toggle').attributes('aria-label')
      await wrapper.find('.theme-toggle').trigger('click')
      expect(wrapper.find('.theme-toggle').attributes('aria-label')).not.toBe(before)
    })

    it('shows links, brand link and gear once a user is set, without a remount', async () => {
      const wrapper = await mountSignedOut()
      expect(wrapper.find('.navbar-links').exists()).toBe(false)

      mockUser.value = adminUser
      await flushPromises()

      expect(wrapper.find('.navbar-brand').element.tagName).toBe('A')
      expect(wrapper.find('.navbar-brand').attributes('href')).toBe('/')
      expect(wrapper.findAll('.navbar-link').map((link) => link.text())).toEqual(['New job', 'Jobs', 'CVs'])
      expect(wrapper.find('.navbar-hamburger').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(true)
    })

    it('hides everything again on logout and does not reopen menus after the next login', async () => {
      mockUser.value = adminUser
      const router = makeRouter()
      await router.push('/')
      const wrapper = mount(NavBar, { global: { plugins: [router] } })
      await wrapper.find('.navbar-hamburger').trigger('click')
      await wrapper.find('button[aria-label="Settings"]').trigger('click')

      mockUser.value = null
      await flushPromises()

      expect(wrapper.find('.navbar-links').exists()).toBe(false)
      expect(wrapper.find('.navbar-hamburger').exists()).toBe(false)
      expect(wrapper.find('button[aria-label="Settings"]').exists()).toBe(false)
      expect(wrapper.find('.navbar-menu').exists()).toBe(false)
      expect(wrapper.find('.navbar-brand').element.tagName).not.toBe('A')
      expect(document.body.querySelector('.navbar-mobile-overlay')).toBeNull()
      expect(document.body.querySelector('.navbar-settings-overlay')).toBeNull()

      mockUser.value = adminUser
      await flushPromises()
      expect(wrapper.find('.navbar-menu').exists()).toBe(false)
      expect(wrapper.find('.navbar-links').classes()).not.toContain('is-open')
    })

    it('ends in the signed-out navbar after a real logout and navigation to /login', async () => {
      mockUser.value = adminUser
      mockLogout.mockImplementationOnce(async () => {
        mockUser.value = null
      })
      const router = makeRouter()
      await router.push('/')
      const wrapper = mount(NavBar, { global: { plugins: [router] } })

      await wrapper.find('button[aria-label="Settings"]').trigger('click')
      const logoutItem = wrapper.findAll('button').find((btn) => btn.text().includes('Logout'))
      await logoutItem?.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/login')
      expect(wrapper.findAll('a[href]')).toHaveLength(0)
      expect(wrapper.findAll('button')).toHaveLength(1)
    })

    // jsdom applies no SCSS, so the static-brand rule and the layout are asserted on the source.
    it('styles the static brand with no pointer cursor and no hover colour change', () => {
      const block = readScss().match(/&\.is-static\s*\{([\s\S]*?)\n  \}/)?.[1] ?? ''

      expect(block).toMatch(/cursor:\s*default/)
      expect(block).toMatch(/&:hover\s*\{[^}]*color:\s*var\(--fg\)/)
      expect(block).not.toMatch(/pointer/)
    })

    it('keeps the actions right-aligned when the links container is absent', () => {
      const actions = readScss().match(/\.navbar-actions\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

      expect(actions).toMatch(/margin-left:\s*auto/)
    })
  })
})
