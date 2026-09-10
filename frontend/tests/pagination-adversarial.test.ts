import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createTestingPinia } from '@pinia/testing'

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listJobs: vi.fn(),
  listResumes: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  duplicateJob: vi.fn(),
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
  name: 'Amy Admin',
  email: 'amy@example.com',
  role: 'admin',
  org_id: 'demo-org',
  has_profile_image: false
})

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import JobsListPage from '../src/pages/JobsListPage.vue'
import CvsListPage from '../src/pages/CvsListPage.vue'
import Pager from '../src/components/Pager.vue'
import { deleteResume, listJobs, listResumes } from '../src/lib/api'

// QA adversarial pass for .plan/028. The implementing agent covered Pager's own disabled/emit
// matrix and the stores' call shape; this file targets the two integration properties the plan
// singled out as the risky ones — the client-side Jobs filter must keep searching the WHOLE
// list (Open Question 1), and a delete must not strand the user on an emptied page — plus the
// cap value the plan had to correct mid-implementation.

// The cap the plan settled on. Duplicated here on purpose: if anyone edits UNPAGED_LIMIT,
// JobCvsModal's literal, backend's MAX_PAGE_LIMIT, or the contract without editing the others,
// one of these assertions fails.
const CAP = 500
const PAGE_SIZE = 10

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    org_id: 'demo-org',
    title: `Job ${id}`,
    description: 'Description',
    location: 'Berlin, Germany',
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

function resume(id: string) {
  return {
    id,
    candidate_id: `candidate-${id}`,
    candidate_name: `Candidate ${id}`,
    candidate_email: `${id}@example.com`,
    file_name: `${id}.pdf`,
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-03T00:00:00.000Z',
    jobs: [],
    owner_user_id: 'u1',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  }
}

function mountJobs() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  return mount(JobsListPage, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false }), router] }
  })
}

function mountCvs() {
  return mount(CvsListPage, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

// The page has several `.btn-ghost` buttons (Upload CV, Edit, Replace file, Delete), so match
// on the label rather than on position.
function buttonByText(wrapper: ReturnType<typeof mountCvs>, text: string) {
  const found = wrapper.findAll('button').find((button) => button.text().trim().startsWith(text))
  if (!found) {
    throw new Error(`No button labelled "${text}". Buttons: ${wrapper.findAll('button').map((b) => b.text()).join(' | ')}`)
  }
  return found
}

async function deleteFirstCv(wrapper: ReturnType<typeof mountCvs>) {
  await buttonByText(wrapper, 'Delete').trigger('click')
  await buttonByText(wrapper, 'Confirm delete').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUser.value = {
    id: 'u1',
    name: 'Amy Admin',
    email: 'amy@example.com',
    role: 'admin',
    org_id: 'demo-org',
    has_profile_image: false
  }
})

describe('Jobs filter vs. pagination (.plan/028 Open Question 1)', () => {
  it('re-requests the whole list at the cap, not one page, the moment a filter goes active', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 1, limit: PAGE_SIZE }))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))

    const wrapper = mountJobs()
    await flushPromises()

    // First load: a normal page.
    expect(vi.mocked(listJobs).mock.calls[0]).toEqual(['demo-org', { page: 1, limit: PAGE_SIZE }])

    // A job that only exists in the wider response — proof the filter searches beyond page 1.
    vi.mocked(listJobs).mockResolvedValue(
      pageOf([job('job-1'), job('job-31', { title: 'Job on page 4' })], { total: 40, page: 1, limit: CAP })
    )

    await wrapper.get('input[aria-label="Search jobs by title"]').setValue('page 4')
    await flushPromises()

    const filteredCall = vi.mocked(listJobs).mock.calls.at(-1)
    expect(filteredCall).toEqual(['demo-org', { page: 1, limit: CAP }])
    expect(wrapper.text()).toContain('Job on page 4')
  })

  it('hides the Pager while a filter is active and restores it when the filter is cleared', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 1, limit: PAGE_SIZE }))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))

    const wrapper = mountJobs()
    await flushPromises()
    expect(wrapper.findComponent(Pager).exists()).toBe(true)

    await wrapper.get('input[aria-label="Search jobs by title"]').setValue('Job')
    await flushPromises()
    expect(wrapper.findComponent(Pager).exists()).toBe(false)

    await wrapper.get('input[aria-label="Search jobs by title"]').setValue('')
    await flushPromises()
    expect(wrapper.findComponent(Pager).exists()).toBe(true)
  })

  it('uses the cap for every filter dimension, not just the title box', async () => {
    for (const [selector, value] of [
      ['input[placeholder="Search by location"]', 'Berlin'],
      ['input[aria-label="Job creation date"]', '2026-07-01']
    ] as const) {
      vi.clearAllMocks()
      vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 1, limit: PAGE_SIZE }))
      vi.mocked(listResumes).mockResolvedValue(pageOf([]))

      const wrapper = mountJobs()
      await flushPromises()

      await wrapper.get(selector).setValue(value)
      await flushPromises()

      expect(vi.mocked(listJobs).mock.calls.at(-1)).toEqual(['demo-org', { page: 1, limit: CAP }])
    }
  })

  it('does not re-request on every keystroke inside an already-active filter', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 1, limit: PAGE_SIZE }))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))

    const wrapper = mountJobs()
    await flushPromises()

    const input = wrapper.get('input[aria-label="Search jobs by title"]')
    await input.setValue('B')
    await flushPromises()
    const afterFirstKeystroke = vi.mocked(listJobs).mock.calls.length

    await input.setValue('Ba')
    await input.setValue('Bac')
    await flushPromises()

    expect(vi.mocked(listJobs).mock.calls.length).toBe(afterFirstKeystroke)
  })

  it('resets to page 1 when a filter is cleared, rather than restoring a stale page number', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 3, limit: PAGE_SIZE }))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))

    const wrapper = mountJobs()
    await flushPromises()

    await wrapper.get('input[aria-label="Search jobs by title"]').setValue('Job')
    await flushPromises()

    vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 1, limit: PAGE_SIZE }))
    await wrapper.get('input[aria-label="Search jobs by title"]').setValue('')
    await flushPromises()

    expect(vi.mocked(listJobs).mock.calls.at(-1)).toEqual(['demo-org', { page: 1, limit: PAGE_SIZE }])
  })

  it('always requests the CV cross-reference list at the cap, so CV counts cover every page', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('job-1')], { total: 40, page: 1, limit: PAGE_SIZE }))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))

    mountJobs()
    await flushPromises()

    expect(vi.mocked(listResumes)).toHaveBeenCalledWith({ page: 1, limit: CAP })
  })
})

describe('deleting off the end of a page (.plan/028 Steps 10-11)', () => {
  it('steps the CVs page back when the delete empties the last page', async () => {
    vi.mocked(listResumes).mockResolvedValue(pageOf([resume('r-11')], { total: 11, page: 2, limit: PAGE_SIZE }))

    const wrapper = mountCvs()
    await flushPromises()

    await wrapper.get('button[aria-label="Next page"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Page 2 of 2')

    vi.mocked(deleteResume).mockResolvedValue(undefined)
    // The re-fetch of page 2 now comes back empty; the step-back re-request returns page 1.
    vi.mocked(listResumes)
      .mockResolvedValueOnce(pageOf([], { total: 10, page: 2, limit: PAGE_SIZE }))
      .mockResolvedValueOnce(pageOf([resume('r-1')], { total: 10, page: 1, limit: PAGE_SIZE }))

    await deleteFirstCv(wrapper)

    // Two requests after the delete: page 2 comes back empty, then page 1 is re-requested.
    expect(vi.mocked(listResumes).mock.calls.at(-2)).toEqual([{ page: 2, limit: PAGE_SIZE }])
    expect(vi.mocked(listResumes).mock.calls.at(-1)).toEqual([{ page: 1, limit: PAGE_SIZE }])
    expect(wrapper.text()).toContain('Page 1 of 1')
  })

  it('re-fetches rather than patching the array, so the page refills from the next page', async () => {
    vi.mocked(listResumes).mockResolvedValue(
      pageOf([resume('r-1'), resume('r-2')], { total: 12, page: 1, limit: PAGE_SIZE })
    )

    const wrapper = mountCvs()
    await flushPromises()
    const callsBeforeDelete = vi.mocked(listResumes).mock.calls.length

    vi.mocked(deleteResume).mockResolvedValue(undefined)
    vi.mocked(listResumes).mockResolvedValue(
      pageOf([resume('r-2'), resume('r-3')], { total: 11, page: 1, limit: PAGE_SIZE })
    )

    await deleteFirstCv(wrapper)

    // A local filter would have left the list at one row and never called the API again.
    expect(vi.mocked(listResumes).mock.calls.length).toBeGreaterThan(callsBeforeDelete)
    expect(wrapper.text()).toContain('Candidate r-3')
  })
})

describe('Pager degenerate inputs', () => {
  it('does not render Infinity when limit is 0', () => {
    const wrapper = mount(Pager, { props: { page: 1, total: 25, limit: 0 } })

    expect(wrapper.text()).not.toContain('Infinity')
    expect(wrapper.text()).toContain('Page 1 of 25')
  })

  it('lets a stale page past the end walk back rather than trapping the user', async () => {
    const wrapper = mount(Pager, { props: { page: 9, total: 25, limit: 10 } })

    expect(wrapper.get('button[aria-label="Next page"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[aria-label="Previous page"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('button[aria-label="Previous page"]').trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[8]])
  })
})
