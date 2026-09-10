import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
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
  duplicateJob: vi.fn()
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
import { deleteJob, duplicateJob, listJobs, listResumes, updateJob } from '../src/lib/api'
import { toast } from 'vue-sonner'

const jobs = [
  {
    id: 'job-1',
    org_id: 'demo-org',
    title: 'Backend Engineer',
    description: 'Node and TypeScript',
    location: 'Berlin, Germany',
    created_at: '2026-07-01T00:00:00.000Z'
  },
  {
    id: 'job-2',
    org_id: 'demo-org',
    title: 'Frontend Engineer',
    description: 'Vue and Tailwind',
    location: null,
    created_at: '2026-07-02T00:00:00.000Z'
  }
]

// Search/filter fixtures (.plan/013): distinct titles, locations (one deliberately null), and
// posting dates, so each filter dimension can be isolated and combined.
// - title "Backend"  -> job-1, job-3
// - location "Berlin" -> job-1, job-2   (job-3 has no location, so it never matches)
// - posted 2026-07-05..2026-07-15 -> job-2
// Combining title + location therefore narrows to job-1 alone, which OR-ing could not produce.
const filterJobs = [
  {
    id: 'job-1',
    org_id: 'demo-org',
    title: 'Backend Engineer',
    description: 'Node and TypeScript',
    location: 'Berlin, Germany',
    created_at: '2026-07-01T00:00:00.000Z'
  },
  {
    id: 'job-2',
    org_id: 'demo-org',
    title: 'Frontend Engineer',
    description: 'Vue and Tailwind',
    location: 'Berlin, Germany',
    created_at: '2026-07-10T00:00:00.000Z'
  },
  {
    id: 'job-3',
    org_id: 'demo-org',
    title: 'Backend Architect',
    description: 'Distributed systems',
    location: null,
    created_at: '2026-07-20T00:00:00.000Z'
  }
]

// Titles of the job cards currently rendered, in list order. The filtered-empty state's
// heading is a sibling of the <ul>, so scoping to `li` keeps it out of the result.
function renderedTitles(wrapper: VueWrapper) {
  return wrapper.findAll('li p.font-semibold').map((title) => title.text())
}

// The per-card entrance stagger the page binds via :style, in ms and in list order
// (.plan/014). Read back off the rendered style attribute rather than asserting exact values
// field-by-field, so the step size stays an implementation detail of lib/animation.
function animationDelays(wrapper: VueWrapper) {
  return wrapper.findAll('li').map((card) => {
    const matched = /animation-delay:\s*([\d.]+)ms/.exec(card.attributes('style') ?? '')
    return matched ? Number(matched[1]) : null
  })
}

// Longer than the stagger cap (8 steps), so the last cards must share one delay.
const manyJobs = Array.from({ length: 12 }, (_, index) => ({
  id: `job-many-${index}`,
  org_id: 'demo-org',
  title: `Job ${index}`,
  description: 'Description',
  location: null,
  created_at: '2026-07-01T00:00:00.000Z'
}))

// The value <input type="date"> holds for a given timestamp, in the runner's local timezone —
// the same local calendar key the page filters on (localDateKey). Computed rather than
// hardcoded so an exact-day assertion can't drift in a timezone behind/ahead of UTC.
function localKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA')
}

const resumes = [
  {
    id: 'resume-1',
    candidate_id: 'candidate-1',
    candidate_name: 'Jane Doe',
    candidate_email: 'jane@example.com',
    file_name: 'jane.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-03T00:00:00.000Z',
    jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
    owner_user_id: 'u1',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  },
  {
    id: 'resume-2',
    candidate_id: 'candidate-2',
    candidate_name: 'John Smith',
    candidate_email: 'john@example.com',
    file_name: 'john.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-04T00:00:00.000Z',
    jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
    owner_user_id: 'u1',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  }
]

// Mixed ownership: one resume owned by the logged-in candidate (u1), one owned by a
// different candidate, both attached to job-1 — see
// .plan/011-2026-08-09-candidate-job-cv-visibility.md Step 4.
const mixedOwnershipResumes = [
  { ...resumes[0], owner_user_id: 'u1' },
  { ...resumes[1], owner_user_id: 'u2' }
]

// JobCvsModal fetches its own data via listJobResumes/listResumes when opened; it has its own
// dedicated test suite, so it's stubbed here to keep this page's tests focused on the page.
//
// .plan/018: the page reads the job and resume stores instead of calling lib/api itself. Every
// mount installs its own testing Pinia with `stubActions: false`, so the real store actions run
// against the mocked lib/api below — a mutation failure propagates out of the store and this
// page turns it into a toast itself (.plan/023), while a failed list load still becomes the
// store's `loadError` card.
function mountPage() {
  return mount(JobsListPage, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
      stubs: { JobCvsModal: true }
    }
  })
}

// The empty-state CTA is a RouterLink, which only renders as a real <a href> with a router
// installed — the plain `mountPage()` mount leaves it unresolved, so an href assertion there
// would pass vacuously. These tests mount with a memory router instead.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/jobs', name: 'jobs-list', component: { template: '<div />' } },
      { path: '/jobs/new', name: 'job-new', component: { template: '<div />' } }
    ]
  })
}

async function mountWithRouter() {
  const router = makeRouter()
  await router.push('/jobs')
  await router.isReady()
  return mount(JobsListPage, {
    global: {
      plugins: [router, createTestingPinia({ createSpy: vi.fn, stubActions: false })],
      stubs: { JobCvsModal: true }
    }
  })
}

describe('JobsListPage', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Amy Admin',
      email: 'amy@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listJobs).mockReset().mockResolvedValue(pageOf(jobs))
    vi.mocked(listResumes).mockReset().mockResolvedValue(pageOf(resumes))
    vi.mocked(updateJob).mockReset()
    vi.mocked(deleteJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(duplicateJob).mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('lists every job with its CV count', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(listJobs).toHaveBeenCalledWith('demo-org', { page: 1, limit: 10 })
    expect(wrapper.text()).toContain('Backend Engineer')
    expect(wrapper.text()).toContain('2 CVs')
    expect(wrapper.text()).toContain('Frontend Engineer')
    expect(wrapper.text()).toContain('0 CVs')
  })

  it('shows an empty state when there are no jobs', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([]))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No jobs yet')
  })

  // .plan/017 moved the job-creation form off '/' — this CTA has to follow it, or the empty
  // state sends an Admin/Recruiter to the home page instead of the form.
  it('points the empty-state "Create a job" CTA at /jobs/new', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([]))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))
    const wrapper = await mountWithRouter()
    await flushPromises()

    const cta = wrapper.findAll('a').find((link) => link.text() === 'Create a job')
    expect(cta?.attributes('href')).toBe('/jobs/new')
  })

  it('shows an error message when loading fails', async () => {
    vi.mocked(listJobs).mockRejectedValue(new Error('Failed to load jobs'))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load jobs')
    // .plan/018 Open Question 2: a failed list load stays a blocking card, never a toast — the
    // page would otherwise be blank with only a passing notification.
    expect(toast.error).not.toHaveBeenCalled()
  })

  // The CV list is the page's other source of data, and it feeds the same blocking card.
  it('shows the CV-load failure in the same blocking card, without toasting', async () => {
    vi.mocked(listResumes).mockRejectedValue(new Error('CV service is unavailable'))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('CV service is unavailable')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('edits a job title and description', async () => {
    vi.mocked(updateJob).mockResolvedValue({ ...jobs[0], title: 'Senior Backend Engineer' })
    const wrapper = mountPage()
    await flushPromises()

    const editButtons = wrapper.findAll('button').filter((btn) => btn.text().includes('Edit'))
    await editButtons[0].trigger('click')

    // Scoped to the card: the search/filter bar above the list has text inputs of its own.
    await wrapper.find('li input[type=text]').setValue('Senior Backend Engineer')
    const saveButton = wrapper.findAll('button').find((btn) => btn.text().includes('Save'))
    await saveButton?.trigger('click')
    await flushPromises()

    expect(updateJob).toHaveBeenCalledWith('job-1', {
      title: 'Senior Backend Engineer',
      description: 'Node and TypeScript',
      location: 'Berlin, Germany'
    })
    expect(wrapper.text()).toContain('Senior Backend Engineer')
  })

  it('duplicates a job and refreshes the list', async () => {
    vi.mocked(duplicateJob).mockResolvedValue({
      id: 'job-3',
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node and TypeScript',
      location: 'Berlin, Germany',
      created_at: '2026-07-05T00:00:00.000Z'
    })
    const wrapper = mountPage()
    await flushPromises()

    const duplicateButton = wrapper.findAll('button').find((btn) => btn.text().includes('Duplicate'))
    await duplicateButton?.trigger('click')
    await flushPromises()

    expect(duplicateJob).toHaveBeenCalledWith('job-1')
    // load() is called again after a successful duplicate to refresh jobs/resumes
    expect(listJobs).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenCalledWith('Job duplicated')
  })

  it('shows an error toast when duplicating fails', async () => {
    vi.mocked(duplicateJob).mockRejectedValue(new Error('Failed to duplicate job'))
    const wrapper = mountPage()
    await flushPromises()

    const duplicateButton = wrapper.findAll('button').find((btn) => btn.text().includes('Duplicate'))
    await duplicateButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Failed to duplicate job')
  })

  // .plan/023 moved these toasts back out of the job store and into the page's own catch
  // blocks; mounting with a real testing Pinia keeps the failure paths exercised end to end.
  it('surfaces a failed edit as a toast and keeps the edit form open', async () => {
    vi.mocked(updateJob).mockRejectedValue(new Error('Job not found'))
    const wrapper = mountPage()
    await flushPromises()

    const editButtons = wrapper.findAll('button').filter((btn) => btn.text().includes('Edit'))
    await editButtons[0].trigger('click')
    await wrapper.find('li input[type=text]').setValue('Senior Backend Engineer')
    const saveButton = wrapper.findAll('button').find((btn) => btn.text().includes('Save'))
    await saveButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Job not found')
    expect(toast.success).not.toHaveBeenCalled()
    expect(wrapper.findAll('button').some((btn) => btn.text() === 'Save')).toBe(true)
  })

  it('surfaces a failed delete as a toast and leaves the job and its CV count intact', async () => {
    vi.mocked(deleteJob).mockRejectedValue(new Error('Forbidden'))
    const wrapper = mountPage()
    await flushPromises()

    const deleteButtons = wrapper.findAll('button').filter((btn) => btn.text().includes('Delete'))
    await deleteButtons[0].trigger('click')
    const confirmButton = wrapper.findAll('button').find((btn) => btn.text().includes('Confirm delete'))
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Forbidden')
    expect(wrapper.text()).toContain('Backend Engineer')
    // The page's own cross-referencing bookkeeping is success-path only: the CV count must not
    // have been stripped when the delete failed.
    expect(wrapper.text()).toContain('2 CVs')
  })

  it('opens the Manage CVs popup for a job', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'JobCvsModal' }).exists()).toBe(false)

    const manageButton = wrapper.findAll('button').find((btn) => btn.text().includes('Manage CVs'))
    await manageButton?.trigger('click')

    const modal = wrapper.findComponent({ name: 'JobCvsModal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('job')).toMatchObject({ id: 'job-1' })
  })

  it('requires a confirm step before deleting, naming the cascade impact', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const deleteButtons = wrapper.findAll('button').filter((btn) => btn.text().includes('Delete'))
    await deleteButtons[0].trigger('click')

    expect(deleteJob).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This will detach 2 CVs from this job and delete their match results for it.')

    // .plan/028: the deleted job leaves the list via the store's re-fetch of the current page,
    // not a local filter, so the server is what stops returning it.
    vi.mocked(listJobs).mockResolvedValue(pageOf([jobs[1]]))

    const confirmButton = wrapper.findAll('button').find((btn) => btn.text().includes('Confirm delete'))
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(deleteJob).toHaveBeenCalledWith('job-1')
    expect(wrapper.text()).not.toContain('Backend Engineer')
  })

  it('cancels a delete without calling the API', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const deleteButtons = wrapper.findAll('button').filter((btn) => btn.text().includes('Delete'))
    await deleteButtons[0].trigger('click')

    const cancelButton = wrapper.findAll('button').find((btn) => btn.text() === 'Cancel')
    await cancelButton?.trigger('click')
    await flushPromises()

    expect(deleteJob).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Backend Engineer')
  })

  describe('candidate role (corrected 2026-08-04 #2)', () => {
    beforeEach(() => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
    })

    it('calls listResumes and shows the CV count badge and jobs list', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(listJobs).toHaveBeenCalledWith('demo-org', { page: 1, limit: 10 })
      expect(listResumes).toHaveBeenCalledWith({ page: 1, limit: 500 })
      expect(wrapper.text()).toContain('Backend Engineer')
      expect(wrapper.text()).toContain('2 CVs')
    })

    it('hides Edit, Duplicate, and Delete, but shows Manage CVs', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const buttonLabels = wrapper.findAll('button').map((btn) => btn.text())
      expect(buttonLabels).not.toContain('Edit')
      expect(buttonLabels.some((text) => text.includes('Duplicate'))).toBe(false)
      expect(buttonLabels).not.toContain('Delete')
      expect(buttonLabels).toContain('Manage CVs')
    })

    it('can open the Manage CVs popup', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const manageButton = wrapper.findAll('button').find((btn) => btn.text().includes('Manage CVs'))
      await manageButton?.trigger('click')

      const modal = wrapper.findComponent({ name: 'JobCvsModal' })
      expect(modal.exists()).toBe(true)
    })

    it('hides the "Create a job" CTA in the empty state', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf([]))
      vi.mocked(listResumes).mockResolvedValue(pageOf([]))
      const wrapper = await mountWithRouter()
      await flushPromises()

      expect(wrapper.text()).toContain('No jobs yet')
      expect(wrapper.find('a[href="/jobs/new"]').exists()).toBe(false)
      expect(wrapper.findAll('a')).toHaveLength(0)
    })

    it('scopes the CV count badge to only its own resumes for a mixed-ownership set (.plan/011)', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf(mixedOwnershipResumes))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('1 CV')
      expect(wrapper.text()).not.toContain('2 CVs')
    })

    // Adversarial (QA, .plan/011): cvCount filters resumes.value by both `resume.jobs.some(job
    // => job.id === jobId)` and ownership independently per job — a resume attached to *multiple*
    // jobs should be counted (or excluded) correctly on each job's own badge, not just in the
    // single-job fixtures above. Own resume A is attached to both jobs; own resume D is attached
    // only to job-1; other-owned resume B is attached to both jobs. Expect job-1's badge to count
    // A+D (2, own) out of 3 attached, and job-2's badge to count A only (1, own) out of 2 attached.
    it('scopes the badge correctly per job when a resume is attached to multiple jobs with mixed ownership (.plan/011 adversarial)', async () => {
      const resumeA = {
        ...resumes[0],
        id: 'resume-a',
        owner_user_id: 'u1',
        jobs: [
          { id: 'job-1', title: 'Backend Engineer' },
          { id: 'job-2', title: 'Frontend Engineer' }
        ]
      }
      const resumeD = {
        ...resumes[0],
        id: 'resume-d',
        owner_user_id: 'u1',
        jobs: [{ id: 'job-1', title: 'Backend Engineer' }]
      }
      const resumeB = {
        ...resumes[1],
        id: 'resume-b',
        owner_user_id: 'u2',
        jobs: [
          { id: 'job-1', title: 'Backend Engineer' },
          { id: 'job-2', title: 'Frontend Engineer' }
        ]
      }
      vi.mocked(listResumes).mockResolvedValue(pageOf([resumeA, resumeD, resumeB]))
      const wrapper = mountPage()
      await flushPromises()

      const jobCards = wrapper.findAll('li')
      const backendCard = jobCards.find((li) => li.text().includes('Backend Engineer'))
      const frontendCard = jobCards.find((li) => li.text().includes('Frontend Engineer'))

      expect(backendCard?.find('.list-badge').text()).toContain('2 CVs')
      expect(frontendCard?.find('.list-badge').text()).toContain('1 CV')
      expect(frontendCard?.find('.list-badge').text()).not.toContain('2 CV')
    })
  })

  describe('admin/recruiter role with a mixed-ownership resume set (.plan/011)', () => {
    it('shows the full CV count for an admin, unaffected by ownership', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf(mixedOwnershipResumes))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('2 CVs')
    })

    it('shows the full CV count for a recruiter, unaffected by ownership', async () => {
      mockUser.value = { ...mockUser.value, role: 'recruiter' }
      vi.mocked(listResumes).mockResolvedValue(pageOf(mixedOwnershipResumes))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('2 CVs')
    })
  })

  // Card entrance animation (.plan/014 items 2 and 5). jsdom neither runs CSS animations nor
  // resolves stylesheets, so these assert the class and the bound delay the component
  // produces — the visual check is manual, per the plan's Risks section.
  describe('entrance animation', () => {
    it('gives every job card the entrance class and a stagger delay that grows with index', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const cards = wrapper.findAll('li')
      expect(cards).toHaveLength(2)
      for (const card of cards) {
        expect(card.classes()).toContain('card-enter')
      }

      const delays = animationDelays(wrapper)
      expect(delays[0]).toBe(0)
      expect(delays[1]).toBeGreaterThan(delays[0]!)
    })

    it('caps the stagger delay so a long list does not leave its last cards waiting', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(manyJobs))
      vi.mocked(listResumes).mockResolvedValue(pageOf([]))
      const wrapper = mountPage()
      await flushPromises()

      const delays = animationDelays(wrapper)
      expect(delays).toHaveLength(manyJobs.length)

      // Monotonically non-decreasing, and flat once the cap is reached.
      for (let index = 1; index < delays.length; index += 1) {
        expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]!)
      }
      expect(delays.at(-1)).toBe(delays[8])
      expect(delays.at(-1)).toBeLessThanOrEqual(500)
    })

    it('fades in the "No jobs yet" empty state', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf([]))
      vi.mocked(listResumes).mockResolvedValue(pageOf([]))
      const wrapper = mountPage()
      await flushPromises()

      const emptyCard = wrapper.find('.card.fade-in')
      expect(emptyCard.exists()).toBe(true)
      expect(emptyCard.text()).toContain('No jobs yet')
    })

    it('fades in the filtered-empty state', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('input[placeholder="Search by title"]').setValue('Designer')

      const emptyCard = wrapper.find('.card.fade-in')
      expect(emptyCard.exists()).toBe(true)
      expect(emptyCard.text()).toContain('No jobs match your filters')
    })

    it('fades in the error card', async () => {
      vi.mocked(listJobs).mockRejectedValue(new Error('Failed to load jobs'))
      const wrapper = mountPage()
      await flushPromises()

      const errorCard = wrapper.find('.card.fade-in')
      expect(errorCard.exists()).toBe(true)
      expect(errorCard.text()).toContain('Failed to load jobs')
    })
  })

  // Job preview dialog (.plan/020): clicking a job's description opens a read-only dialog
  // showing the full, untruncated description. The card itself keeps the 140-character
  // snippet, so every assertion here is scoped to one side or the other.
  describe('job preview dialog (.plan/020)', () => {
    // Deliberately longer than descriptionSnippet's 140-character threshold, so the dialog
    // showing this text in full proves it isn't just re-rendering the card's snippet.
    const longDescription =
      'We are hiring a backend engineer to own our matching pipeline end to end, from CV ingestion ' +
      'through scoring and explanation.\nYou will work in Node and TypeScript against Postgres, and ' +
      'partner closely with the recruiting team.'

    const previewJobs = [{ ...jobs[0], description: longDescription }, jobs[1]]

    // The preview dialog is the only `.fixed.inset-0` this page renders itself — JobCvsModal is
    // stubbed in mountPage(), so it contributes no backdrop of its own.
    function previewDialog(wrapper: VueWrapper) {
      return wrapper.find('.fixed.inset-0')
    }

    beforeEach(() => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(previewJobs))
    })

    it('truncates the description on the card and renders no dialog until it is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const snippet = wrapper.find('li p.cursor-pointer.text-fg-muted')
      expect(snippet.text()).toBe(`${longDescription.slice(0, 140)}…`)
      expect(previewDialog(wrapper).exists()).toBe(false)
    })

    it('opens the dialog with the full untruncated description when the description is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('li p.cursor-pointer.text-fg-muted').trigger('click')

      const dialog = previewDialog(wrapper)
      expect(dialog.exists()).toBe(true)
      expect(dialog.text()).toContain(longDescription)
      // The card's snippet ellipsis must not be what the dialog is showing.
      expect(dialog.text()).not.toContain('…')
    })

    it('also opens the dialog when the job title is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('li p.cursor-pointer.font-semibold').trigger('click')

      const dialog = previewDialog(wrapper)
      expect(dialog.exists()).toBe(true)
      expect(dialog.find('h2').text()).toBe('Backend Engineer')
    })

    it('shows the job title, location, created date, and CV count in the dialog', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('li p.cursor-pointer.text-fg-muted').trigger('click')

      const dialog = previewDialog(wrapper)
      expect(dialog.find('h2').text()).toBe('Backend Engineer')
      expect(dialog.text()).toContain('Berlin, Germany')
      expect(dialog.text()).toContain('2 CVs')
      expect(dialog.text()).toContain('Created')
    })

    // job-2 has location: null — the badge is conditional, matching the card.
    it('omits the location badge for a job with no location', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const snippets = wrapper.findAll('li p.cursor-pointer.text-fg-muted')
      await snippets[1].trigger('click')

      const dialog = previewDialog(wrapper)
      expect(dialog.find('h2').text()).toBe('Frontend Engineer')
      expect(dialog.text()).not.toContain('Berlin')
    })

    it('closes the dialog via its close button', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('li p.cursor-pointer.text-fg-muted').trigger('click')
      expect(previewDialog(wrapper).exists()).toBe(true)

      await wrapper.find('button[aria-label="Close preview"]').trigger('click')

      expect(previewDialog(wrapper).exists()).toBe(false)
    })

    it('closes the dialog when the backdrop is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('li p.cursor-pointer.text-fg-muted').trigger('click')
      await previewDialog(wrapper).trigger('click')

      expect(previewDialog(wrapper).exists()).toBe(false)
    })

    // The @click.self counterpart of the test above: a click that starts inside the panel
    // bubbles up to the backdrop, and must not be mistaken for a backdrop click.
    it('keeps the dialog open when the panel itself is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('li p.cursor-pointer.text-fg-muted').trigger('click')
      await previewDialog(wrapper).find('.card').trigger('click')

      expect(previewDialog(wrapper).exists()).toBe(true)
      expect(previewDialog(wrapper).text()).toContain(longDescription)
    })

    // The description sits alongside Edit/Duplicate/Manage CVs/Delete on the same card, so
    // opening the preview must not disturb any of them (.plan/020 Q1).
    it('does not open the preview when a card action button is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const manageButton = wrapper.findAll('button').find((btn) => btn.text().includes('Manage CVs'))
      await manageButton?.trigger('click')

      expect(wrapper.findComponent({ name: 'JobCvsModal' }).exists()).toBe(true)
      expect(previewDialog(wrapper).exists()).toBe(false)
    })
  })

  describe('search and filter (.plan/013)', () => {
    // Own CV attached to job-1 only; a different candidate's CV is attached to job-2, so for
    // a Candidate job-2 must still read as "not applied" (cvCount is ownership-scoped).
    const filterResumes = [
      { ...resumes[0], id: 'resume-own', owner_user_id: 'u1', jobs: [{ id: 'job-1', title: 'Backend Engineer' }] },
      { ...resumes[1], id: 'resume-other', owner_user_id: 'u2', jobs: [{ id: 'job-2', title: 'Frontend Engineer' }] }
    ]

    beforeEach(() => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(filterJobs))
      vi.mocked(listResumes).mockResolvedValue(pageOf(filterResumes))
    })

    it('shows a location badge only for jobs that have one', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const cards = wrapper.findAll('li')
      const withLocation = cards.find((li) => li.text().includes('Backend Engineer'))
      const withoutLocation = cards.find((li) => li.text().includes('Backend Architect'))

      expect(withLocation?.text()).toContain('Berlin, Germany')
      expect(withoutLocation?.text()).not.toContain('Berlin')
    })

    it('narrows the list by a case-insensitive title search', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(renderedTitles(wrapper)).toHaveLength(3)

      await wrapper.find('input[placeholder="Search by title"]').setValue('backend')

      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Backend Architect'])
    })

    it('narrows the list by location, excluding a job that has no location', async () => {
      const wrapper = mountPage()
      await flushPromises()

      // An empty location term matches every job, including the one with location: null.
      expect(renderedTitles(wrapper)).toContain('Backend Architect')

      await wrapper.find('input[placeholder="Search by location"]').setValue('berlin')

      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Frontend Engineer'])
      expect(renderedTitles(wrapper)).not.toContain('Backend Architect')
    })

    // Revised 2026-08-10: the from/to pair became a single "Job creation date" filter that
    // matches the creation day exactly, so there is one date input and no range semantics.
    it('narrows the list by an exact job-creation date', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const dateInputs = wrapper.findAll('input[type=date]')
      expect(dateInputs).toHaveLength(1)
      const dateInput = dateInputs[0]

      await dateInput.setValue(localKey(filterJobs[1].created_at))
      expect(renderedTitles(wrapper)).toEqual(['Frontend Engineer'])

      // Exact match, not a lower bound: another job's day swaps the result rather than adding.
      await dateInput.setValue(localKey(filterJobs[2].created_at))
      expect(renderedTitles(wrapper)).toEqual(['Backend Architect'])

      // Clearing the date lifts the constraint entirely.
      await dateInput.setValue('')
      expect(renderedTitles(wrapper)).toHaveLength(3)
    })

    it('combines the creation date with the title search using AND', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('input[placeholder="Search by title"]').setValue('Backend')
      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Backend Architect'])

      // job-2's creation day matches no "Backend" job, so AND leaves nothing.
      await wrapper.find('input[type=date]').setValue(localKey(filterJobs[1].created_at))
      expect(renderedTitles(wrapper)).toHaveLength(0)

      await wrapper.find('input[type=date]').setValue(localKey(filterJobs[0].created_at))
      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer'])
    })

    it('combines title and location with AND, narrowing further than either alone', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('input[placeholder="Search by title"]').setValue('Backend')
      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Backend Architect'])

      await wrapper.find('input[placeholder="Search by location"]').setValue('Berlin')

      // OR would have kept all three; AND leaves only the job matching both.
      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer'])
    })

    it('shows a distinct empty state — not the "Create a job" CTA — when filters match nothing', async () => {
      const wrapper = await mountWithRouter()
      await flushPromises()

      await wrapper.find('input[placeholder="Search by title"]').setValue('Designer')

      expect(renderedTitles(wrapper)).toHaveLength(0)
      expect(wrapper.text()).toContain('No jobs match your filters')
      expect(wrapper.text()).not.toContain('No jobs yet')
      expect(wrapper.find('a[href="/jobs/new"]').exists()).toBe(false)
    })

    // Scoped to "Applied" specifically (not "no select on the page at all") because Pager's own
    // rows-per-page select (.plan/028 addendum) legitimately renders regardless of role.
    it('does not render the applied filter for an admin', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.find('select[aria-label="Rows per page"]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('Applied')
      expect(wrapper.text()).not.toContain('Not applied')
    })

    it('does not render the applied filter for a recruiter', async () => {
      mockUser.value = { ...mockUser.value, role: 'recruiter' }
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.find('select[aria-label="Rows per page"]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('Applied')
      expect(wrapper.text()).not.toContain('Not applied')
    })

    describe('as a candidate', () => {
      beforeEach(() => {
        mockUser.value = { ...mockUser.value, role: 'candidate' }
      })

      it('renders the applied filter with All / Applied / Not applied', async () => {
        const wrapper = mountPage()
        await flushPromises()

        const select = wrapper.find('select')
        expect(select.exists()).toBe(true)
        expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual([
          'all',
          'applied',
          'not_applied'
        ])
        expect(renderedTitles(wrapper)).toHaveLength(3)
      })

      it('shows only jobs the candidate has one of their own CVs attached to', async () => {
        const wrapper = mountPage()
        await flushPromises()

        await wrapper.find('select').setValue('applied')

        expect(renderedTitles(wrapper)).toEqual(['Backend Engineer'])
      })

      it('shows the complement for "not applied", ignoring another candidate\'s attached CV', async () => {
        const wrapper = mountPage()
        await flushPromises()

        await wrapper.find('select').setValue('not_applied')

        // job-2 has a CV attached, but it belongs to u2 — so it is still "not applied" for u1.
        expect(renderedTitles(wrapper)).toEqual(['Frontend Engineer', 'Backend Architect'])
      })

      it('combines the applied filter with the title search using AND', async () => {
        const wrapper = mountPage()
        await flushPromises()

        await wrapper.find('select').setValue('not_applied')
        await wrapper.find('input[placeholder="Search by title"]').setValue('Backend')

        expect(renderedTitles(wrapper)).toEqual(['Backend Architect'])
      })
    })
  })

  // Server-side pagination (.plan/028 Step 14). Open Question 1's resolution: filtering stays
  // client-side, so an active filter has to be handed the whole list rather than one page —
  // otherwise the search box would silently only search the 10 jobs currently on screen.
  describe('pagination', () => {
    it('requests the first page at the default page size on mount', async () => {
      mountPage()
      await flushPromises()

      expect(listJobs).toHaveBeenCalledWith('demo-org', { page: 1, limit: 10 })
    })

    it('renders the pager with the total page count from the response envelope', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findComponent({ name: 'Pager' }).exists()).toBe(true)
      expect(wrapper.text()).toContain('Page 1 of 3')
    })

    it('re-requests the next page when Next is clicked', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      const pageTwoJobs = [{ ...jobs[0], id: 'job-11', title: 'Page Two Engineer' }]
      vi.mocked(listJobs).mockResolvedValue(pageOf(pageTwoJobs, { total: 25, page: 2, limit: 10 }))

      await wrapper.get('button[aria-label="Next page"]').trigger('click')
      await flushPromises()

      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 2, limit: 10 })
      expect(renderedTitles(wrapper)).toEqual(['Page Two Engineer'])
      expect(wrapper.text()).toContain('Page 2 of 3')
    })

    // The rows-per-page select resets to page 1 rather than replaying the current page number
    // at the new size — page 2 at limit 10 has no defined meaning at limit 50.
    it('re-requests page 1 at the new size when the rows-per-page select changes', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.get('button[aria-label="Next page"]').trigger('click')
      await flushPromises()

      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 50 }))
      await wrapper.get('select[aria-label="Rows per page"]').setValue('50')
      await flushPromises()

      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 1, limit: 50 })
      expect(wrapper.text()).toContain('Page 1 of 1')
    })

    it('requests the whole list unpaginated and hides the pager once a title filter is active', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('input[placeholder="Search by title"]').setValue('Backend')
      await flushPromises()

      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 1, limit: 500 })
      expect(wrapper.findComponent({ name: 'Pager' }).exists()).toBe(false)
    })

    it('does the same for the location, date, and applied filters', async () => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))

      const byLocation = mountPage()
      await flushPromises()
      await byLocation.find('input[placeholder="Search by location"]').setValue('Berlin')
      await flushPromises()
      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 1, limit: 500 })

      const byDate = mountPage()
      await flushPromises()
      await byDate.find('input[type=date]').setValue('2026-07-01')
      await flushPromises()
      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 1, limit: 500 })

      const byApplied = mountPage()
      await flushPromises()
      await byApplied.find('select').setValue('applied')
      await flushPromises()
      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 1, limit: 500 })
    })

    it('returns to paged requests and shows the pager again when the filter is cleared', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      const titleInput = wrapper.find('input[placeholder="Search by title"]')
      await titleInput.setValue('Backend')
      await flushPromises()
      expect(wrapper.findComponent({ name: 'Pager' }).exists()).toBe(false)

      await titleInput.setValue('')
      await flushPromises()

      expect(listJobs).toHaveBeenLastCalledWith('demo-org', { page: 1, limit: 10 })
      expect(wrapper.findComponent({ name: 'Pager' }).exists()).toBe(true)
    })

    // The reload is only worth paying for on the empty/non-empty boundary — every later
    // keystroke is already filtering the full list client-side.
    it('does not re-request on every keystroke within an already-active filter', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      const titleInput = wrapper.find('input[placeholder="Search by title"]')
      await titleInput.setValue('B')
      await flushPromises()
      const callsAfterFirstCharacter = vi.mocked(listJobs).mock.calls.length

      await titleInput.setValue('Ba')
      await titleInput.setValue('Bac')
      await flushPromises()

      expect(vi.mocked(listJobs).mock.calls.length).toBe(callsAfterFirstCharacter)
    })

    // Client-side filtering is unchanged (plan: "keep the existing filteredJobs computed") —
    // with the unpaginated list loaded, the filter still searches every job, not one page.
    it('keeps filtering the whole list, not just the page that was loaded first', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf([jobs[0]], { total: 2, page: 1, limit: 1 }))
      const wrapper = mountPage()
      await flushPromises()

      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer'])

      // The unpaginated re-request the filter triggers brings back the job that was on page 2.
      vi.mocked(listJobs).mockResolvedValue(pageOf(jobs, { total: 2, page: 1, limit: 500 }))
      await wrapper.find('input[placeholder="Search by title"]').setValue('Frontend')
      await flushPromises()

      expect(renderedTitles(wrapper)).toEqual(['Frontend Engineer'])
    })
  })
})
