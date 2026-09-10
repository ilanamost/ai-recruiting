import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { pageOf } from './helpers/page'

vi.mock('../src/lib/api', async (importOriginal) => ({
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listResumes: vi.fn(),
  updateResume: vi.fn(),
  deleteResume: vi.fn(),
  replaceResumeFile: vi.fn(),
  uploadResume: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

const mockUser = ref<Record<string, unknown>>({
  id: 'u1',
  name: 'Cara Candidate',
  email: 'cara@example.com',
  role: 'candidate',
  org_id: 'demo-org',
  has_profile_image: false
})

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import CvsListPage from '../src/pages/CvsListPage.vue'
import { listResumes } from '../src/lib/api'

/**
 * QA adversarial pass over the frontend half of
 * .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md.
 *
 * tests/CvsListPage.test.ts already covers the plan's own cases. This file
 * only probes the edges of the defensive filter itself: an owner id that is a
 * PREFIX of the viewer's (a `startsWith`/`includes` filter would pass it), an
 * owner id differing only by case, and the filter's interaction with the
 * page's Pager when the (hypothetically broken) backend still reports a wide
 * `total`.
 */

function mountPage() {
  return mount(CvsListPage, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

function resumeFor(id: string, ownerUserId: string | null, name: string) {
  return {
    id,
    candidate_id: `candidate-${id}`,
    candidate_name: name,
    candidate_email: `${id}@example.com`,
    file_name: `${id}.pdf`,
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-09-01T00:00:00.000Z',
    jobs: [],
    owner_user_id: ownerUserId,
    years_experience: 3,
    skills: ['typescript']
  }
}

const own = resumeFor('resume-own', 'u1', 'Cara Candidate')

describe('CvsListPage — candidate ownership filter, adversarial (.plan/032)', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Cara Candidate',
      email: 'cara@example.com',
      role: 'candidate',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listResumes).mockReset()
  })

  // 'u1' is a prefix of 'u10' and of 'u1-admin'. A filter written with
  // startsWith/includes rather than === would render both of these.
  it('does not render a CV whose owner id merely starts with the viewer\'s id', async () => {
    vi.mocked(listResumes).mockResolvedValue(
      pageOf([own, resumeFor('resume-u10', 'u10', 'Prefix Collision'), resumeFor('resume-u1x', 'u1-admin', 'Suffix Collision')])
    )

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('Cara Candidate')
    expect(wrapper.text()).not.toContain('Prefix Collision')
    expect(wrapper.text()).not.toContain('Suffix Collision')
  })

  it('does not render a CV whose owner id differs only by case', async () => {
    vi.mocked(listResumes).mockResolvedValue(pageOf([own, resumeFor('resume-upper', 'U1', 'Case Collision')]))

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Case Collision')
  })

  // The filter must key off the CURRENT viewer, not whoever was signed in when
  // the module loaded — the store is shared app state that survives a role
  // switch in a single-page session.
  it('re-filters when the signed-in user changes identity', async () => {
    vi.mocked(listResumes).mockResolvedValue(
      pageOf([own, resumeFor('resume-other', 'u2', 'Other Candidate')])
    )

    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Other Candidate')

    mockUser.value = { ...mockUser.value, id: 'u2' }
    await flushPromises()

    expect(wrapper.text()).toContain('Other Candidate')
    expect(wrapper.text()).not.toContain('Cara Candidate')
  })

  // Recruiter is explicitly NOT narrowed by this plan — the filter must not
  // leak onto the other roles via a falsy-role or default-branch mistake.
  it('leaves Recruiter and Admin unfiltered on the same response', async () => {
    const broad = pageOf([own, resumeFor('resume-other', 'u2', 'Other Candidate')])

    for (const role of ['recruiter', 'admin']) {
      vi.mocked(listResumes).mockResolvedValue(broad)
      mockUser.value = { ...mockUser.value, id: 'u1', role }

      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findAll('li')).toHaveLength(2)
      expect(wrapper.text()).toContain('Other Candidate')
    }
  })
})
