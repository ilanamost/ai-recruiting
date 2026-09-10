import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const mockUser = ref<Record<string, unknown> | null>(null)
const mockProfileImageUrl = ref<string | null>(null)
const mockLogout = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser, profileImageUrl: mockProfileImageUrl, logout: mockLogout })
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

  it('renders the uploaded profile image when set', async () => {
    mockProfileImageUrl.value = 'http://localhost:3001/api/auth/me/profile-image'
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const img = wrapper.find('.avatar img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('http://localhost:3001/api/auth/me/profile-image')
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
})
