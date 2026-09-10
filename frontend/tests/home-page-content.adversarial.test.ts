import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

// QA adversarial pass for .plan/017: the action row is the page's only per-role logic, and the
// role it reads can be null (auth still resolving, a logout mid-render) or an unexpected string.
const mockUser = ref<Record<string, unknown> | null>(null)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import HomePage from '../src/pages/HomePage.vue'

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

function hrefs(wrapper: Awaited<ReturnType<typeof mountHome>>) {
  return wrapper.findAll('a').map((link) => link.attributes('href'))
}

describe('HomePage action row edge cases (adversarial)', () => {
  beforeEach(() => {
    mockUser.value = null
  })

  // Fail-closed: with no user resolved, the page must never offer the job-creation CTA, which
  // the router would bounce a Candidate away from anyway.
  it('never offers a job-creation link when no user is resolved', async () => {
    const wrapper = await mountHome()

    expect(hrefs(wrapper)).not.toContain('/jobs/new')
  })

  it('never offers a job-creation link for an unrecognised role', async () => {
    mockUser.value = { id: 'u1', role: 'auditor' }
    const wrapper = await mountHome()

    expect(hrefs(wrapper)).not.toContain('/jobs/new')
  })

  // A Recruiter must not be pointed at /cvs from anywhere on this page — .plan/015 hid that
  // route for the role, and the guard would redirect them straight back out.
  it('points a recruiter at no route their own guards would redirect them away from', async () => {
    mockUser.value = { id: 'u1', role: 'recruiter' }
    const wrapper = await mountHome()

    expect(hrefs(wrapper)).not.toContain('/cvs')
    expect(wrapper.text()).not.toContain('/cvs')
  })

  // Every rendered link must resolve to a real route, for every role — no dead CTA.
  it.each(['admin', 'recruiter', 'candidate'])('renders only resolvable links for %s', async (role) => {
    mockUser.value = { id: 'u1', role }
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(HomePage, { global: { plugins: [router] } })

    const links = wrapper.findAll('a').map((link) => link.attributes('href') ?? '')
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(router.resolve(href).matched.length).toBeGreaterThan(0)
    }
  })

  // Content guard: the explainer must not go stale into promising a capability the product
  // does not have (per .doc/product-definition.md's out-of-scope list).
  it('does not claim out-of-scope capabilities', async () => {
    mockUser.value = { id: 'u1', role: 'recruiter' }
    const wrapper = await mountHome()
    const text = wrapper.text().toLowerCase()

    // Guard the guard: sections are expanded by default, so this sees the real copy.
    expect(text).toContain('job description')

    for (const claim of ['shortlist', 'rank candidates', 'interview scheduling', 'pipeline']) {
      expect(text).not.toContain(claim)
    }
  })
})
