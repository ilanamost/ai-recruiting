import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

const mockUser = ref<Record<string, unknown> | null>(null)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import HomePage from '../src/pages/HomePage.vue'

// A real memory router, not a RouterLink stub: every assertion here is about where a link
// actually points, which only resolves to an href with the router installed.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/jobs', name: 'jobs-list', component: { template: '<div />' } },
      { path: '/jobs/new', name: 'job-new', component: { template: '<div />' } },
      { path: '/cvs', name: 'cvs-list', component: { template: '<div />' } }
    ]
  })
}

async function mountHome() {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  return mount(HomePage, { global: { plugins: [router] } })
}

function setRole(role: string) {
  mockUser.value = {
    id: 'u1',
    name: 'Test User',
    email: 'test@example.com',
    role,
    org_id: 'demo-org',
    has_profile_image: false
  }
}

// Every content section is expanded on mount (backlog: accordions open by default). Header
// buttons are in document order: 0 = "What it does", 1 = "How it works", 2 = "Key features".
function sectionHeaders(wrapper: Awaited<ReturnType<typeof mountHome>>) {
  return wrapper.findAll('section.card button[aria-expanded]')
}

async function toggleSection(wrapper: Awaited<ReturnType<typeof mountHome>>, index: number) {
  await sectionHeaders(wrapper)[index].trigger('click')
}

// "Content" is whatever the header toggles: the intro's paragraphs, the steps list, the
// features list. Absence of all of them is what "collapsed" means for that section.
function sectionContent(wrapper: Awaited<ReturnType<typeof mountHome>>, index: number) {
  return wrapper.findAll('section.card')[index].find('p, ol, ul')
}

// The action row is the only per-role logic on the page (.plan/017 Open Question 2 / Risks),
// so it is asserted exhaustively: the right two links, and the absence of the wrong ones.
function actionLinks(wrapper: Awaited<ReturnType<typeof mountHome>>) {
  return wrapper.findAll('a.btn').map((link) => ({
    text: link.text(),
    href: link.attributes('href')
  }))
}

describe('HomePage', () => {
  beforeEach(() => {
    setRole('recruiter')
  })

  describe('content sections', () => {
    it('renders all three sections as cards, each with a heading', async () => {
      const wrapper = await mountHome()

      const sections = wrapper.findAll('section.card')
      expect(sections).toHaveLength(3)

      const headings = wrapper.findAll('h1, h2').map((heading) => heading.text())
      expect(headings).toEqual(['What it does', 'How it works', 'Key features'])
    })

    it('explains what the product is, who it is for, and the problem it solves', async () => {
      const wrapper = await mountHome()

      const intro = wrapper.findAll('section.card')[0]
      const text = intro.text()

      // Purpose: a CV in, a score and an explanation out.
      expect(text).toContain('job description')
      expect(text.toLowerCase()).toContain('score')
      expect(text.toLowerCase()).toContain('explanation')
      // Audience: recruiters primary, candidates secondary.
      expect(text.toLowerCase()).toContain('recruiter')
      expect(text.toLowerCase()).toContain('candidate')
      // Problem: manual screening is slow/inconsistent, keyword ATS tools are shallow.
      expect(text.toLowerCase()).toContain('inconsistent')
      expect(text.toLowerCase()).toContain('keyword')
      // Not a stub — each paragraph carries real prose.
      const paragraphs = intro.findAll('p')
      expect(paragraphs.length).toBeGreaterThanOrEqual(2)
      for (const paragraph of paragraphs) {
        expect(paragraph.text().length).toBeGreaterThan(40)
      }
    })

    it('renders the analyze → match → score → explain loop as an ordered list', async () => {
      const wrapper = await mountHome()

      const howItWorks = wrapper.findAll('section.card')[1]
      const steps = howItWorks.findAll('ol > li')
      expect(steps.length).toBeGreaterThanOrEqual(4)
      for (const step of steps) {
        expect(step.text().trim().length).toBeGreaterThan(10)
      }

      const text = howItWorks.text().toLowerCase()
      expect(text).toContain('upload')
      expect(text).toContain('extract')
      expect(text).toContain('job description')
      expect(text).toContain('score')
      expect(text).toContain('explanation')
    })

    it('renders a key-features list where every item has an icon and non-empty text', async () => {
      const wrapper = await mountHome()

      const features = wrapper.findAll('section.card')[2]
      const items = features.findAll('ul > li')
      expect(items.length).toBeGreaterThanOrEqual(4)

      for (const item of items) {
        expect(item.find('svg').exists()).toBe(true)
        expect(item.text().trim().length).toBeGreaterThan(20)
      }

      const text = features.text().toLowerCase()
      expect(text).toContain('job')
      expect(text).toContain('cv')
      expect(text).toContain('role')
    })
  })

  describe('collapsible sections', () => {
    const sections = [
      { index: 0, title: 'What it does' },
      { index: 1, title: 'How it works' },
      { index: 2, title: 'Key features' }
    ]

    it('starts with every section expanded', async () => {
      const wrapper = await mountHome()

      for (const { index } of sections) {
        expect(sectionContent(wrapper, index).exists()).toBe(true)
        expect(sectionHeaders(wrapper)[index].attributes('aria-expanded')).toBe('true')
      }
    })

    it.each(sections)('collapses and re-expands "$title" when its header is clicked', async ({ index }) => {
      const wrapper = await mountHome()

      await toggleSection(wrapper, index)
      expect(sectionContent(wrapper, index).exists()).toBe(false)
      expect(sectionHeaders(wrapper)[index].attributes('aria-expanded')).toBe('false')

      await toggleSection(wrapper, index)
      expect(sectionContent(wrapper, index).exists()).toBe(true)
      expect(sectionHeaders(wrapper)[index].attributes('aria-expanded')).toBe('true')
    })

    // Independent toggles, not a single-open accordion and not one shared boolean
    // (.plan/022 Open Question 1): closing one leaves the other two exactly as they were.
    it.each(sections)('closing "$title" leaves the other two sections expanded', async ({ index }) => {
      const wrapper = await mountHome()

      await toggleSection(wrapper, index)

      for (const other of sections.filter((section) => section.index !== index)) {
        expect(sectionContent(wrapper, other.index).exists()).toBe(true)
        expect(sectionHeaders(wrapper)[other.index].attributes('aria-expanded')).toBe('true')
      }
    })

    it('keeps an already-closed section closed when another one is reopened', async () => {
      const wrapper = await mountHome()

      await toggleSection(wrapper, 0)
      await toggleSection(wrapper, 2)
      await toggleSection(wrapper, 2)

      expect(sectionContent(wrapper, 0).exists()).toBe(false)
      expect(sectionContent(wrapper, 2).exists()).toBe(true)
      expect(sectionContent(wrapper, 1).exists()).toBe(true)
    })
  })

  describe('role-aware action row', () => {
    it.each(['admin', 'recruiter'])('offers %s exactly "Post a job" and "View jobs"', async (role) => {
      setRole(role)
      const wrapper = await mountHome()

      expect(actionLinks(wrapper)).toEqual([
        { text: 'Post a job', href: '/jobs/new' },
        { text: 'View jobs', href: '/jobs' }
      ])
    })

    it('offers a candidate exactly "Browse jobs" and "Upload a CV"', async () => {
      setRole('candidate')
      const wrapper = await mountHome()

      expect(actionLinks(wrapper)).toEqual([
        { text: 'Browse jobs', href: '/jobs' },
        { text: 'Upload a CV', href: '/cvs' }
      ])
    })

    // The router already blocks a Candidate from /jobs/new; the page must not dangle the link
    // in front of them either, or the CTA is a dead end by design. Asserted over links only —
    // the explainer copy above legitimately says "post a job" as prose, which is not a CTA.
    it('never shows a candidate a job-creation link', async () => {
      setRole('candidate')
      const wrapper = await mountHome()

      const linkTexts = wrapper.findAll('a').map((link) => link.text())
      expect(linkTexts).not.toContain('Post a job')
      expect(wrapper.find('a[href="/jobs/new"]').exists()).toBe(false)
    })

    // Mirror image: neither privileged role gets the Candidate's CV-upload CTA — /cvs is
    // hidden from a Recruiter entirely (.plan/015).
    it.each(['admin', 'recruiter'])('never shows %s the candidate CV-upload CTA', async (role) => {
      setRole(role)
      const wrapper = await mountHome()

      const linkTexts = wrapper.findAll('a').map((link) => link.text())
      expect(linkTexts).not.toContain('Upload a CV')
      expect(wrapper.find('a[href="/cvs"]').exists()).toBe(false)
    })

    it('navigates when an action link is clicked', async () => {
      setRole('recruiter')
      const router = makeRouter()
      await router.push('/')
      await router.isReady()
      const wrapper = mount(HomePage, { global: { plugins: [router] } })

      const postJob = wrapper.findAll('a.btn').find((link) => link.text() === 'Post a job')
      await postJob?.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('job-new')
    })
  })
})
