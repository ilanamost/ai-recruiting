import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

// QA adversarial pass for .plan/019-2026-08-10-mobile-nav.md.
//
// jsdom evaluates no CSS and no @media query, so nothing here proves the 768px breakpoint
// itself — that is covered by the built-CSS inspection in .orchestrate/qa-report.md and by a
// manual resize check. What these tests DO prove is the JS-driven state machine: that
// aria-expanded, the Menu/X icon swap, and the .is-open class never drift apart, and that
// every close path (hamburger, nav link, overlay) leaves the component fully consistent.
//
// Post-QA fix: both click-outside overlays are now <Teleport to="body">'d (a nested overlay
// inside <nav> was clipped to the navbar strip by .navbar's backdrop-filter, which makes <nav>
// the containing block for any position:fixed descendant — clicking real page content below the
// navbar could never have closed either menu). Teleported content renders outside the mounted
// component's own tree, so it must be queried via document.body, not wrapper.find(). Each
// overlay carries its own class (.navbar-mobile-overlay / .navbar-settings-overlay) so the two
// are distinguishable at the body level now that neither is nested inside the other's ancestor.

function bodyOverlay(selector: string) {
  const el = document.body.querySelector(selector)
  return el ? new DOMWrapper(el) : null
}

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

async function mountNav(path = '/') {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(NavBar, { global: { plugins: [router] } })
  return { router, wrapper }
}

// The single source of truth for "is the mobile menu open?" as the user perceives it: the
// class that the CSS keys off, the ARIA state a screen reader announces, and the icon drawn.
function openState(wrapper: ReturnType<typeof mount>) {
  const hamburger = wrapper.find('.navbar-hamburger')
  const icon = wrapper.find('.navbar-hamburger svg')
  const iconClass = icon.attributes('class') ?? ''
  return {
    isOpenClass: wrapper.find('.navbar-links').classes().includes('is-open'),
    ariaExpanded: hamburger.attributes('aria-expanded'),
    ariaLabel: hamburger.attributes('aria-label'),
    icon: iconClass.includes('lucide-x') ? 'X' : iconClass.includes('lucide-menu') ? 'Menu' : 'unknown',
    overlayPresent: document.body.querySelector('.navbar-mobile-overlay') !== null
  }
}

const CLOSED = { isOpenClass: false, ariaExpanded: 'false', ariaLabel: 'Open menu', icon: 'Menu', overlayPresent: false }
const OPEN = { isOpenClass: true, ariaExpanded: 'true', ariaLabel: 'Close menu', icon: 'X', overlayPresent: true }

describe('mobile nav — adversarial', () => {
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

  describe('state stays fully in sync across every close path', () => {
    // The existing suite checks aria-expanded after a hamburger toggle and checks .is-open
    // after a link/overlay close, but never checks aria-expanded or the icon after those two
    // close paths. A close that dropped .is-open while leaving aria-expanded="true" would
    // pass the existing tests and ship a nav that lies to screen readers.
    it('resets class, aria and icon together when closed via a nav link', async () => {
      const { wrapper } = await mountNav('/')

      await wrapper.find('.navbar-hamburger').trigger('click')
      expect(openState(wrapper)).toEqual(OPEN)

      const jobsLink = wrapper.findAll('.navbar-link').find((link) => link.text().includes('Jobs'))
      await jobsLink?.trigger('click')
      await flushPromises()

      expect(openState(wrapper)).toEqual(CLOSED)
    })

    it('resets class, aria and icon together when closed via the outside overlay', async () => {
      const { wrapper } = await mountNav('/')

      await wrapper.find('.navbar-hamburger').trigger('click')
      expect(openState(wrapper)).toEqual(OPEN)

      await bodyOverlay('.navbar-mobile-overlay')?.trigger('click')
      await flushPromises()

      expect(openState(wrapper)).toEqual(CLOSED)
    })

    it('stays in sync through repeated rapid toggling', async () => {
      const { wrapper } = await mountNav('/')

      for (let i = 0; i < 5; i++) {
        await wrapper.find('.navbar-hamburger').trigger('click')
        expect(openState(wrapper)).toEqual(OPEN)
        await wrapper.find('.navbar-hamburger').trigger('click')
        expect(openState(wrapper)).toEqual(CLOSED)
      }
    })
  })

  describe('nav links navigate AND close — the @click must not swallow the navigation', () => {
    // `to` and `@click="closeMobileMenu"` sit on the same RouterLink. Vue merges the extra
    // listener with RouterLink's own internal one rather than replacing it, so both must run.
    it.each([
      ['New job', '/jobs/new'],
      ['Jobs', '/jobs'],
      ['CVs', '/cvs']
    ])('routes to %s (%s) and closes the panel', async (label, path) => {
      mockUser.value = { ...mockUser.value, role: 'admin' }
      const { router, wrapper } = await mountNav('/')

      await wrapper.find('.navbar-hamburger').trigger('click')
      const link = wrapper.findAll('.navbar-link').find((l) => l.text().includes(label))
      await link?.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe(path)
      expect(openState(wrapper)).toEqual(CLOSED)
    })

    // A link pointing at the route already displayed is a no-op navigation. The close must not
    // be conditional on the navigation actually changing the route, or the panel would stick
    // open over the page the user is already on.
    it('closes the panel even when the link targets the current route', async () => {
      const { router, wrapper } = await mountNav('/jobs')

      await wrapper.find('.navbar-hamburger').trigger('click')
      expect(openState(wrapper)).toEqual(OPEN)

      const jobsLink = wrapper.findAll('.navbar-link').find((l) => l.text().includes('Jobs'))
      await jobsLink?.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/jobs')
      expect(openState(wrapper)).toEqual(CLOSED)
    })
  })

  describe('the mobile panel offers exactly the links the role sees on desktop', () => {
    // The plan puts per-role visibility explicitly out of scope. These pin that the v-if
    // conditions still gate the panel contents once it is open, not just the desktop row.
    it.each([
      ['recruiter', ['New job', 'Jobs']],
      ['candidate', ['Jobs', 'CVs']],
      ['admin', ['New job', 'Jobs', 'CVs']]
    ])('shows %s exactly %j inside the open panel', async (role, expected) => {
      mockUser.value = { ...mockUser.value, role }
      const { wrapper } = await mountNav('/')

      await wrapper.find('.navbar-hamburger').trigger('click')

      const panel = wrapper.find('.navbar-links')
      expect(panel.classes()).toContain('is-open')
      expect(panel.findAll('.navbar-link').map((l) => l.text())).toEqual(expected)
    })
  })

  describe('degenerate and structural cases', () => {
    // Logged-out / not-yet-hydrated user. `user?.role !== 'candidate'` is true when user is
    // null, so the links render — the point here is that the toggle does not throw.
    it('renders and toggles without a user', async () => {
      mockUser.value = null
      const { wrapper } = await mountNav('/')

      expect(wrapper.find('.navbar-hamburger').exists()).toBe(true)
      await wrapper.find('.navbar-hamburger').trigger('click')
      expect(openState(wrapper)).toEqual(OPEN)
      await bodyOverlay('.navbar-mobile-overlay')?.trigger('click')
      await flushPromises()
      expect(openState(wrapper)).toEqual(CLOSED)
    })

    // Regression guard for the QA-reported containing-block bug: a position:fixed overlay
    // nested inside <nav> was clipped to the navbar strip by .navbar's backdrop-filter, so it
    // never actually covered page content below the nav — clicking the rest of the page could
    // never have closed the menu. Both overlays are now <Teleport to="body">'d specifically to
    // escape that containing block, so this asserts they land there, not inside <nav>.
    it('teleports the mobile overlay to <body>, not inside <nav>', async () => {
      const { wrapper } = await mountNav('/')
      await wrapper.find('.navbar-hamburger').trigger('click')

      expect(wrapper.find('nav .navbar-mobile-overlay').exists()).toBe(false)
      expect(bodyOverlay('.navbar-mobile-overlay')).not.toBeNull()
      expect(bodyOverlay('.navbar-mobile-overlay')!.element.parentElement).toBe(document.body)
    })

    // z-10 on the teleported overlay keeps it below .navbar's own z-20 stacking context, so
    // <nav> — and everything inside it, including the open panel — still paints above the
    // overlay once both are siblings under <body> rather than nested. .navbar-links itself
    // carries z-index: 30 in the stylesheet (media-query-only, unobservable via jsdom's style
    // attribute — confirmed instead by the built-CSS grep in .orchestrate/qa-report.md).
    it('keeps the overlay at a lower z-index than the navbar it sits behind', async () => {
      const { wrapper } = await mountNav('/')
      await wrapper.find('.navbar-hamburger').trigger('click')

      expect(bodyOverlay('.navbar-mobile-overlay')!.classes()).toContain('z-10')
    })

    it('keeps the two overlays independent — distinct elements, both body-level', async () => {
      const { wrapper } = await mountNav('/')

      await wrapper.find('button[aria-label="Settings"]').trigger('click')
      // Both overlays teleport to <body> now, so what distinguishes them is no longer DOM
      // ancestry (neither is nested in the other's containing element) but their own class.
      expect(bodyOverlay('.navbar-mobile-overlay')).toBeNull()
      expect(bodyOverlay('.navbar-settings-overlay')).not.toBeNull()

      await wrapper.find('button[aria-label="Settings"]').trigger('click')
      await wrapper.find('.navbar-hamburger').trigger('click')
      expect(bodyOverlay('.navbar-mobile-overlay')).not.toBeNull()
      expect(bodyOverlay('.navbar-settings-overlay')).toBeNull()
    })
  })

  describe('the two menus are independent state, not mutually exclusive', () => {
    // Documents ACTUAL behaviour, not desired behaviour. mobileMenuOpen and menuOpen are two
    // unrelated refs with no coordination, so both panels can be open at once. Post-fix, this is
    // no longer just a jsdom artifact: the teleported overlay sits at z-10, below .navbar's own
    // z-20 stacking context, so <nav> (including .navbar-actions and the Settings button) now
    // genuinely renders above the mobile overlay in a real browser too — the click is not
    // intercepted, both menus really can end up open together. No mutual exclusion was ever
    // requested by the plan; this documents the behavior rather than asserting it's ideal.
    it('lets both panels be open simultaneously at the state level', async () => {
      const { wrapper } = await mountNav('/')

      await wrapper.find('.navbar-hamburger').trigger('click')
      await wrapper.find('button[aria-label="Settings"]').trigger('click')

      expect(wrapper.find('.navbar-links').classes()).toContain('is-open')
      expect(wrapper.find('.navbar-menu').exists()).toBe(true)
    })

    // The existing suite only covers "open settings, mobile stays closed" — which is trivially
    // true because the mobile menu was never opened. This is the direction that actually
    // exercises leakage between the two refs.
    it('does not let the settings menu closing also close the mobile menu', async () => {
      const { wrapper } = await mountNav('/')

      await wrapper.find('.navbar-hamburger').trigger('click')
      await wrapper.find('button[aria-label="Settings"]').trigger('click')
      await wrapper.find('button[aria-label="Settings"]').trigger('click')

      expect(wrapper.find('.navbar-menu').exists()).toBe(false)
      expect(openState(wrapper)).toEqual(OPEN)
    })

    // Navigating away via the settings menu must not strand the mobile panel open.
    it('leaves the mobile panel state untouched when navigating via User settings', async () => {
      const { router, wrapper } = await mountNav('/')

      await wrapper.find('button[aria-label="Settings"]').trigger('click')
      const item = wrapper.findAll('button').find((b) => b.text().includes('User settings'))
      await item?.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.path).toBe('/settings')
      expect(openState(wrapper)).toEqual(CLOSED)
    })
  })

  describe('the brand wordmark is independently targetable', () => {
    // The whole point of the <span> wrapper: the mobile rule hides the text without touching
    // the Sparkles icon beside it. If someone later moves the icon inside the span, the
    // .navbar-brand-text { display: none } rule would hide the icon too and the mobile brand
    // would vanish entirely.
    it('keeps the Sparkles icon outside .navbar-brand-text', async () => {
      const { wrapper } = await mountNav('/')

      const brand = wrapper.find('.navbar-brand')
      const text = brand.find('.navbar-brand-text')

      expect(text.exists()).toBe(true)
      expect(text.text()).toBe('AI Recruiting')
      expect(text.findAll('svg')).toHaveLength(0)
      expect(brand.findAll('svg').length).toBeGreaterThan(0)
    })

    // Fixed alongside the overlay teleport (QA finding — this was latent until then): the brand
    // link now carries @click="closeMobileMenu" too, same as the three nav links, so navigating
    // home via the wordmark also closes an open mobile panel instead of leaving it stranded.
    it('navigates home and closes the mobile menu when the brand is clicked', async () => {
      const { router, wrapper } = await mountNav('/jobs')

      await wrapper.find('.navbar-hamburger').trigger('click')
      expect(openState(wrapper)).toEqual(OPEN)

      await wrapper.find('.navbar-brand').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('home')
      expect(openState(wrapper)).toEqual(CLOSED)
    })
  })
})
