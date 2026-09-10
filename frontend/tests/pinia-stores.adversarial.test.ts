import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// QA adversarial pass over .plan/018-2026-08-10-pinia-stores.md, as amended by
// .plan/023-2026-08-11-toast-in-components.md.
//
// Two things the migrated suites cannot catch by construction:
//  1. JobsListPage.test.ts stubs JobCvsModal, and JobCvsModal.test.ts mounts the modal alone —
//     so no existing test has both on screen at once. The refactor made them share one
//     `resumeStore`, which is exactly where a cross-component regression can hide.
//  2. Where a failure gets reported is the plan's core rule. .plan/023 moved every mutation and
//     lookup toast out of the stores and into the call site, keeping the list-load `loadError`
//     card where it was — so the rule now has three directions (component toasts, store
//     `loadError`, deliberate silence) that are easy to get backwards without noticing. Each is
//     asserted explicitly, and the twelve relocated toasts are re-checked end to end through the
//     components that now own them, since a dropped one is otherwise invisible.

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listJobs: vi.fn(),
  listResumes: vi.fn(),
  listJobResumes: vi.fn(),
  attachResumeToJob: vi.fn(),
  detachResumeFromJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  duplicateJob: vi.fn(),
  createJob: vi.fn(),
  getJob: vi.fn(),
  uploadResume: vi.fn(),
  updateResume: vi.fn(),
  replaceResumeFile: vi.fn(),
  deleteResume: vi.fn(),
  getResumeFileUrl: vi.fn(() => 'http://localhost:3001/api/resume/r1/file'),
  createMatch: vi.fn(),
  getMatch: vi.fn(),
  getMatchForPair: vi.fn(),
  listLatestMatchesForJob: vi.fn()
}))

vi.mock('../src/lib/http', () => ({
  apiFetch: vi.fn(async () => ({ ok: true }))
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
import JobForm from '../src/components/JobForm.vue'
import JobCvsModal from '../src/components/JobCvsModal.vue'
import * as api from '../src/lib/api'
import { toast } from 'vue-sonner'
import { useJobStore } from '../src/stores/job'
import { useResumeStore } from '../src/stores/resume'
import { useMatchStore } from '../src/stores/match'

const jobs = [
  {
    id: 'job-1',
    org_id: 'demo-org',
    title: 'Backend Engineer',
    description: 'Node and TypeScript',
    location: 'Berlin, Germany',
    created_at: '2026-07-01T00:00:00.000Z'
  }
]

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
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  // JobCvsModal fetches the job's match scores for Admin/Recruiter on open (.plan/021); default it
  // to "nothing scored yet" so only the tests that care about it have to say anything.
  vi.mocked(api.listLatestMatchesForJob).mockResolvedValue([] as never)
})

// ---------------------------------------------------------------------------
// 1. Cross-component shared state: the real JobCvsModal mounted inside the real
//    JobsListPage, which no existing test does.
// ---------------------------------------------------------------------------
describe('JobsListPage + real JobCvsModal sharing one resume store', () => {
  async function openModalOverLoadedPage() {
    vi.mocked(api.listJobs).mockResolvedValue(pageOf(jobs) as never)
    vi.mocked(api.listResumes).mockResolvedValue(pageOf(resumes) as never)
    vi.mocked(api.listJobResumes).mockResolvedValue([] as never)

    // Note: no `stubs` here — the real JobCvsModal renders, unlike JobsListPage.test.ts.
    const wrapper = mount(JobsListPage, {
      global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
    })
    await flushPromises()

    // Page loaded cleanly first: the job list is on screen, no blocking error card.
    expect(wrapper.text()).toContain('Backend Engineer')
    expect(wrapper.text()).not.toContain('Failed to load')

    return wrapper
  }

  // Fixed (QA finding, post-report): resumeStore.listResumes() now takes an optional
  // `{ silent: true }` that skips the shared `loadError` write. JobCvsModal passes it since it
  // already renders its own local failure message — the modal's background refresh must not be
  // able to blank out a page that loaded successfully.
  it('keeps the jobs list on screen when the MODAL\'s CV load fails, silent mode', async () => {
    const wrapper = await openModalOverLoadedPage()

    // The modal re-lists resumes on open. Make that one call fail, as a session expiry or a
    // 500 would. Nothing about the already-loaded jobs list has changed.
    vi.mocked(api.listJobResumes).mockResolvedValue([] as never)
    vi.mocked(api.listResumes).mockRejectedValue(new Error('CV service unavailable'))

    const manage = wrapper.findAll('button').find((b) => b.text().includes('Manage CVs'))
    await manage!.trigger('click')
    await flushPromises()

    // The modal still surfaces its own failure - unchanged.
    expect(wrapper.text()).toContain('CV service unavailable')

    // ...but the page behind it survives: silent mode means the modal's failed refresh never
    // touches resumeStore.loadError, so JobsListPage's `jobStore.loadError ?? resumeStore.loadError`
    // stays null and the job cards stay on screen.
    const resumeStore = useResumeStore()
    expect(resumeStore.loadError).toBeNull()
    expect(wrapper.find('.card.fade-in.text-danger').exists()).toBe(false)
    expect(wrapper.text()).toContain('Berlin, Germany')

    // Still not a toast either - the split itself holds.
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('leaves the jobs page intact after a failed-then-closed modal load', async () => {
    const wrapper = await openModalOverLoadedPage()

    vi.mocked(api.listResumes).mockRejectedValue(new Error('CV service unavailable'))
    const manage = wrapper.findAll('button').find((b) => b.text().includes('Manage CVs'))
    await manage!.trigger('click')
    await flushPromises()

    const close = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Close')
    await close!.trigger('click')
    await flushPromises()

    // Nothing was ever written to the shared loadError, so there is nothing to leave behind.
    expect(useResumeStore().loadError).toBeNull()
    expect(wrapper.text()).toContain('Berlin, Germany')
  })

  it('refreshes the CV-count badge from the shared store when the modal opens (report item 4)', async () => {
    const wrapper = await openModalOverLoadedPage()
    expect(wrapper.text()).toContain('1 CV')

    // Same endpoint, different server state — someone else detached the CV meanwhile.
    vi.mocked(api.listResumes).mockResolvedValue(pageOf([{ ...resumes[0], jobs: [] }]) as never)

    const manage = wrapper.findAll('button').find((b) => b.text().includes('Manage CVs'))
    await manage!.trigger('click')
    await flushPromises()

    // The badge behind the open modal moved 1 -> 0. Real, and only possible because the two
    // components now share one store.
    expect(wrapper.text()).toContain('0 CVs')
  })
})

// ---------------------------------------------------------------------------
// 2. Where a failure gets reported, asserted in every direction, per store.
// ---------------------------------------------------------------------------
describe('failure routing (plan Open Question 2, amended by .plan/023)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // .plan/023 reversed this direction: the store used to toast and re-throw, and now only
  // re-throws. A toast raised from in here would double-report alongside the call site's own.
  describe('mutations report nothing themselves and never set loadError', () => {
    it('jobStore.deleteJob', async () => {
      vi.mocked(api.deleteJob).mockRejectedValue(new Error('boom'))
      const store = useJobStore()
      await expect(store.deleteJob('job-1')).rejects.toThrow('boom')
      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })

    it('jobStore.attachResumeToJob', async () => {
      vi.mocked(api.attachResumeToJob).mockRejectedValue(new Error('nope'))
      const store = useJobStore()
      await expect(store.attachResumeToJob('job-1', 'resume-1')).rejects.toThrow('nope')
      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })

    it('resumeStore.uploadResume', async () => {
      vi.mocked(api.uploadResume).mockRejectedValue(new Error('too big'))
      const store = useResumeStore()
      await expect(store.uploadResume({} as never)).rejects.toThrow('too big')
      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })

    it('resumeStore.replaceResumeFile', async () => {
      vi.mocked(api.replaceResumeFile).mockRejectedValue(new Error('bad file'))
      const store = useResumeStore()
      await expect(store.replaceResumeFile('r1', {} as File)).rejects.toThrow('bad file')
      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })

    it('matchStore.getMatchForPair', async () => {
      vi.mocked(api.getMatchForPair).mockRejectedValue(new Error('lookup down'))
      const store = useMatchStore()
      await expect(store.getMatchForPair('job-1', 'resume-1')).rejects.toThrow('lookup down')
      expect(toast.error).not.toHaveBeenCalled()
      // The match store holds no loadError at all, by design (plan Step 4).
      expect('loadError' in store).toBe(false)
    })

    it('matchStore.listLatestMatchesForJob', async () => {
      vi.mocked(api.listLatestMatchesForJob).mockRejectedValue(new Error('scores down'))
      const store = useMatchStore()
      await expect(store.listLatestMatchesForJob('job-1')).rejects.toThrow('scores down')
      expect(toast.error).not.toHaveBeenCalled()
      expect('loadError' in store).toBe(false)
    })
  })

  describe('list loads set loadError and never toast', () => {
    it('jobStore.listJobs', async () => {
      vi.mocked(api.listJobs).mockRejectedValue(new Error('jobs down'))
      const store = useJobStore()
      await expect(store.listJobs('demo-org')).rejects.toThrow('jobs down')
      expect(store.loadError).toBe('jobs down')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('resumeStore.listResumes', async () => {
      vi.mocked(api.listResumes).mockRejectedValue(new Error('cvs down'))
      const store = useResumeStore()
      await expect(store.listResumes()).rejects.toThrow('cvs down')
      expect(store.loadError).toBe('cvs down')
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('non-mutating reads neither toast nor set loadError', () => {
    it('matchStore.createMatch and getMatch stay silent (report item 1)', async () => {
      vi.mocked(api.createMatch).mockRejectedValue(new Error('scoring down'))
      vi.mocked(api.getMatch).mockRejectedValue(new Error('scoring down'))
      const store = useMatchStore()
      await expect(store.createMatch({} as never)).rejects.toThrow('scoring down')
      await expect(store.getMatch('m1')).rejects.toThrow('scoring down')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('jobStore.listJobResumes stays silent and does not touch loadError (report item 3)', async () => {
      vi.mocked(api.listJobResumes).mockRejectedValue(new Error('no attachments'))
      const store = useJobStore()
      await expect(store.listJobResumes('job-1')).rejects.toThrow('no attachments')
      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// 3. The twelve relocated toasts, driven end to end through the component that now owns each
//    one (.plan/023's Scope table, which is also the checklist its Risks section calls for).
//
//    Each case rejects the underlying lib/api call with a non-Error value: that is the only way
//    to reach the fallback branch of `err instanceof Error ? err.message : '<fallback>'`, so it
//    pins the verbatim fallback string *and* proves the call site toasts at all. A relocation
//    that dropped a toast on the floor leaves its row here failing with zero toast calls.
// ---------------------------------------------------------------------------
describe('every relocated toast still fires, from its new call site, with its verbatim fallback', () => {
  const attachedResume = { ...resumes[0], attached_at: '2026-07-04T00:00:00.000Z' }
  const unattachedResume = {
    ...resumes[0],
    id: 'resume-2',
    candidate_name: 'Amy Lee',
    file_name: 'amy.pdf',
    jobs: []
  }
  const match = {
    id: 'match-1',
    resume_id: 'resume-1',
    job_id: 'job-1',
    score: 82,
    explanation: 'Strong overlap in required skills.',
    created_at: '2026-07-06T00:00:00.000Z'
  }

  // Everything a mount needs to reach its interaction, so each case only has to break the one
  // call it is about. Implementations survive `vi.clearAllMocks()`, so a rejection left behind
  // by an earlier case would otherwise leak into the next mount.
  function stubHappyPaths() {
    vi.mocked(api.listJobs).mockResolvedValue(pageOf(jobs) as never)
    vi.mocked(api.listResumes).mockResolvedValue(pageOf([attachedResume, unattachedResume]) as never)
    vi.mocked(api.listJobResumes).mockResolvedValue([attachedResume] as never)
    vi.mocked(api.listLatestMatchesForJob).mockResolvedValue([] as never)
    vi.mocked(api.getMatchForPair).mockResolvedValue(null as never)
    vi.mocked(api.createMatch).mockResolvedValue(match as never)
    vi.mocked(api.getMatch).mockResolvedValue(match as never)
  }

  function testingPinia() {
    return createTestingPinia({ createSpy: vi.fn, stubActions: false })
  }

  function setFile(wrapper: ReturnType<typeof mount>, selector: string) {
    const file = new File(['%PDF-1.4 fake bytes'], 'amy-v2.pdf', { type: 'application/pdf' })
    const input = wrapper.find(selector)
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    return input.trigger('change')
  }

  function clickButton(wrapper: ReturnType<typeof mount>, label: string) {
    return wrapper.findAll('button').find((button) => button.text().includes(label))!.trigger('click')
  }

  async function mountJobsPage() {
    const wrapper = mount(JobsListPage, {
      global: { plugins: [testingPinia()], stubs: { JobCvsModal: true } }
    })
    await flushPromises()
    return wrapper
  }

  async function mountCvsPage() {
    const wrapper = mount(CvsListPage, { global: { plugins: [testingPinia()] } })
    await flushPromises()
    return wrapper
  }

  async function mountModal() {
    const wrapper = mount(JobCvsModal, {
      props: { job: jobs[0] },
      global: { plugins: [testingPinia()] }
    })
    await flushPromises()
    return wrapper
  }

  // [ label (store action -> owning call site), lib/api call to break, driver, verbatim fallback ]
  const relocatedToasts: Array<[string, keyof typeof api, () => Promise<unknown>, string]> = [
    [
      'createJob -> JobForm.onSubmit',
      'createJob',
      async () => {
        const wrapper = mount(JobForm, { global: { plugins: [testingPinia()] } })
        await wrapper.find('input[type=text]').setValue('Backend Engineer')
        await wrapper.find('textarea').setValue('Node and TypeScript')
        await wrapper.find('form').trigger('submit')
        return flushPromises()
      },
      'Failed to create job'
    ],
    [
      'updateJob -> JobsListPage.saveEdit',
      'updateJob',
      async () => {
        const wrapper = await mountJobsPage()
        await clickButton(wrapper, 'Edit')
        await wrapper.find('li input[type=text]').setValue('Senior Backend Engineer')
        await clickButton(wrapper, 'Save')
        return flushPromises()
      },
      'Failed to update job'
    ],
    [
      'deleteJob -> JobsListPage.confirmDelete',
      'deleteJob',
      async () => {
        const wrapper = await mountJobsPage()
        await clickButton(wrapper, 'Delete')
        await clickButton(wrapper, 'Confirm delete')
        return flushPromises()
      },
      'Failed to delete job'
    ],
    [
      'duplicateJob -> JobsListPage.duplicate',
      'duplicateJob',
      async () => {
        const wrapper = await mountJobsPage()
        await clickButton(wrapper, 'Duplicate')
        return flushPromises()
      },
      'Failed to duplicate job'
    ],
    [
      'attachResumeToJob -> JobCvsModal.attach',
      'attachResumeToJob',
      async () => {
        const wrapper = await mountModal()
        await wrapper.find('select').setValue(unattachedResume.id)
        await clickButton(wrapper, 'Attach CV')
        return flushPromises()
      },
      'Failed to attach CV'
    ],
    [
      'detachResumeFromJob -> JobCvsModal.confirmDetach',
      'detachResumeFromJob',
      async () => {
        const wrapper = await mountModal()
        await clickButton(wrapper, 'Detach')
        await clickButton(wrapper, 'Confirm detach')
        return flushPromises()
      },
      'Failed to detach CV'
    ],
    [
      'uploadResume -> CvsListPage.submitUpload',
      'uploadResume',
      async () => {
        const wrapper = await mountCvsPage()
        await clickButton(wrapper, 'Upload CV')
        const textInputs = wrapper.findAll('input[type=text]')
        await textInputs[textInputs.length - 1].setValue('Amy Lee')
        await wrapper.find('input[type=email]').setValue('amy@example.com')
        await setFile(wrapper, 'form input[type=file]')
        await wrapper.find('form').trigger('submit')
        return flushPromises()
      },
      'Failed to upload CV'
    ],
    [
      'updateResume -> CvsListPage.saveEdit',
      'updateResume',
      async () => {
        const wrapper = await mountCvsPage()
        await clickButton(wrapper, 'Edit')
        await wrapper.find('li input[type=text]').setValue('Jane R. Doe')
        await clickButton(wrapper, 'Save')
        return flushPromises()
      },
      'Failed to update CV'
    ],
    [
      'replaceResumeFile -> CvsListPage.onReplaceFileChange',
      'replaceResumeFile',
      async () => {
        const wrapper = await mountCvsPage()
        await clickButton(wrapper, 'Replace file')
        await setFile(wrapper, 'input[type=file].hidden')
        return flushPromises()
      },
      'Failed to replace CV file'
    ],
    [
      'deleteResume -> CvsListPage.confirmDelete',
      'deleteResume',
      async () => {
        const wrapper = await mountCvsPage()
        await clickButton(wrapper, 'Delete')
        await clickButton(wrapper, 'Confirm delete')
        return flushPromises()
      },
      'Failed to delete CV'
    ],
    [
      'getMatchForPair -> JobCvsModal.loadPreviewExtras',
      'getMatchForPair',
      async () => {
        const wrapper = await mountModal()
        await wrapper.findAll('li').find((row) => row.text().includes('Jane Doe'))!.trigger('click')
        return flushPromises()
      },
      'Failed to look up an existing match'
    ],
    [
      // The one addition rather than relocation (.plan/023 Assumptions): this call site
      // swallowed the rejection silently and leaned on the store's toast, so it needed its own.
      'listLatestMatchesForJob -> JobCvsModal.loadLatestMatches',
      'listLatestMatchesForJob',
      async () => {
        await mountModal()
        return flushPromises()
      },
      'Failed to load match scores'
    ]
  ]

  it.each(relocatedToasts)('%s', async (_label, apiCall, drive, expected) => {
    stubHappyPaths()
    vi.mocked(api[apiCall] as ReturnType<typeof vi.fn>).mockRejectedValue('plain string')

    await drive()

    expect(toast.error).toHaveBeenCalledWith(expected)
  })
})

// ---------------------------------------------------------------------------
// 4. The list-load fallbacks, which .plan/023 left in the stores untouched.
// ---------------------------------------------------------------------------
describe('list-load fallback strings stay on the store, as loadError', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('listJobs falls back to "Failed to load jobs"', async () => {
    vi.mocked(api.listJobs).mockRejectedValue('plain string')
    const store = useJobStore()
    await expect(store.listJobs('demo-org')).rejects.toBe('plain string')
    expect(store.loadError).toBe('Failed to load jobs')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('listResumes falls back to "Failed to load CVs"', async () => {
    vi.mocked(api.listResumes).mockRejectedValue('plain string')
    const store = useResumeStore()
    await expect(store.listResumes()).rejects.toBe('plain string')
    expect(store.loadError).toBe('Failed to load CVs')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
