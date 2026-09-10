import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// QA adversarial pass over .plan/023-2026-08-11-toast-in-components.md, complementing
// pinia-stores.adversarial.test.ts rather than repeating it. That file already drives each of the
// twelve relocated toasts end to end through its new owning component and pins the verbatim
// fallback string. Three things it cannot catch by construction, each covered below:
//
//  A. `toHaveBeenCalledWith` passes even if the toast fired twice. The whole point of this plan is
//     that exactly one layer reports a failure — a re-introduced store-side toast would
//     double-report next to the call site's own and every existing assertion would still pass.
//  B. The plan removed a `try/catch` from around each mutation body. A `catch` that only toasted
//     and re-threw is safe to delete, but the edit has to leave the success-path local-state write
//     *after* its `await` — a mutation that rejects must not still mutate `jobs`/`resumes`.
//     .plan/023 Scope: "A store action still updates jobs/resumes on success exactly as it does
//     today."
//  C. Store-side silence is asserted for only six of the twelve actions there. The plan's risk is
//     a *missed row*, so the store-side half of the table deserves all twelve too — a store that
//     kept one toast is the exact mirror of a component that dropped one.

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
  getResumeFileUrl: vi.fn(() => 'http://localhost:3001/api/resume/resume-1/file'),
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
import JobCvsModal from '../src/components/JobCvsModal.vue'
import * as api from '../src/lib/api'
import { toast } from 'vue-sonner'
import { useJobStore } from '../src/stores/job'
import { useResumeStore } from '../src/stores/resume'
import { useMatchStore } from '../src/stores/match'

const job = {
  id: 'job-1',
  org_id: 'demo-org',
  title: 'Backend Engineer',
  description: 'Node and TypeScript',
  location: 'Berlin, Germany',
  created_at: '2026-07-01T00:00:00.000Z'
}

const resume = {
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

const attachedResume = { ...resume, attached_at: '2026-07-04T00:00:00.000Z' }

function stubHappyPaths() {
  vi.mocked(api.listJobs).mockResolvedValue(pageOf([job]) as never)
  vi.mocked(api.listResumes).mockResolvedValue(pageOf([resume]) as never)
  vi.mocked(api.listJobResumes).mockResolvedValue([attachedResume] as never)
  vi.mocked(api.listLatestMatchesForJob).mockResolvedValue([] as never)
  vi.mocked(api.getMatchForPair).mockResolvedValue(null as never)
}

function testingPinia() {
  return createTestingPinia({ createSpy: vi.fn, stubActions: false })
}

function clickButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))!.trigger('click')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUser.value = { ...mockUser.value, role: 'admin' }
  stubHappyPaths()
})

// ---------------------------------------------------------------------------
// A. Exactly one report per failure — one representative call site per store.
// ---------------------------------------------------------------------------
describe('a relocated failure is reported exactly once, not once per layer', () => {
  it('JobsListPage.saveEdit toasts a single time when updateJob rejects', async () => {
    vi.mocked(api.updateJob).mockRejectedValue(new Error('Job not found'))
    const wrapper = mount(JobsListPage, {
      global: { plugins: [testingPinia()], stubs: { JobCvsModal: true } }
    })
    await flushPromises()

    await clickButton(wrapper, 'Edit')
    await wrapper.find('li input[type=text]').setValue('Senior Backend Engineer')
    await clickButton(wrapper, 'Save')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Job not found')
  })

  it('CvsListPage.confirmDelete toasts a single time when deleteResume rejects', async () => {
    vi.mocked(api.deleteResume).mockRejectedValue(new Error('Forbidden'))
    const wrapper = mount(CvsListPage, { global: { plugins: [testingPinia()] } })
    await flushPromises()

    await clickButton(wrapper, 'Delete')
    await clickButton(wrapper, 'Confirm delete')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Forbidden')
  })

  it('JobCvsModal.loadPreviewExtras toasts a single time when getMatchForPair rejects', async () => {
    vi.mocked(api.getMatchForPair).mockRejectedValue(new Error('Match service down'))
    const wrapper = mount(JobCvsModal, { props: { job }, global: { plugins: [testingPinia()] } })
    await flushPromises()

    await wrapper.findAll('li').find((row) => row.text().includes('Jane Doe'))!.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Match service down')
  })
})

// ---------------------------------------------------------------------------
// B. Removing the catch must not have moved any success-path state write ahead of its await.
// ---------------------------------------------------------------------------
describe('a rejected mutation leaves the store collection exactly as it was', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('deleteJob does not drop the job from jobs when the API rejects', async () => {
    const store = useJobStore()
    await store.listJobs('demo-org')
    vi.mocked(api.deleteJob).mockRejectedValue(new Error('Forbidden'))

    await expect(store.deleteJob('job-1')).rejects.toThrow('Forbidden')
    expect(store.jobs.map((entry) => entry.id)).toEqual(['job-1'])
  })

  it('updateJob does not apply the edit to jobs when the API rejects', async () => {
    const store = useJobStore()
    await store.listJobs('demo-org')
    vi.mocked(api.updateJob).mockRejectedValue(new Error('Job not found'))

    await expect(store.updateJob('job-1', { title: 'Senior Backend Engineer' } as never)).rejects.toThrow(
      'Job not found'
    )
    expect(store.jobs[0].title).toBe('Backend Engineer')
  })

  it('uploadResume does not prepend a phantom resume when the API rejects', async () => {
    const store = useResumeStore()
    await store.listResumes()
    vi.mocked(api.uploadResume).mockRejectedValue(new Error('File too large'))

    await expect(store.uploadResume({} as never)).rejects.toThrow('File too large')
    expect(store.resumes.map((entry) => entry.id)).toEqual(['resume-1'])
  })

  it('deleteResume does not drop the resume when the API rejects', async () => {
    const store = useResumeStore()
    await store.listResumes()
    vi.mocked(api.deleteResume).mockRejectedValue(new Error('Forbidden'))

    await expect(store.deleteResume('resume-1')).rejects.toThrow('Forbidden')
    expect(store.resumes.map((entry) => entry.id)).toEqual(['resume-1'])
  })

  it('replaceResumeFile leaves the existing file name in place when the API rejects', async () => {
    const store = useResumeStore()
    await store.listResumes()
    vi.mocked(api.replaceResumeFile).mockRejectedValue(new Error('Unsupported file type'))

    await expect(store.replaceResumeFile('resume-1', {} as File)).rejects.toThrow('Unsupported file type')
    expect(store.resumes[0].file_name).toBe('jane.pdf')
  })
})

// ---------------------------------------------------------------------------
// C. The store-side half of .plan/023's twelve-row table: all twelve stay silent.
// ---------------------------------------------------------------------------
describe('all twelve relocated actions are silent at the store layer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // [ label, lib/api call to reject, store call ]
  const silentAtStore: Array<[string, keyof typeof api, () => Promise<unknown>]> = [
    ['createJob', 'createJob', () => useJobStore().createJob({} as never)],
    ['updateJob', 'updateJob', () => useJobStore().updateJob('job-1', {} as never)],
    ['deleteJob', 'deleteJob', () => useJobStore().deleteJob('job-1')],
    ['duplicateJob', 'duplicateJob', () => useJobStore().duplicateJob('job-1')],
    ['attachResumeToJob', 'attachResumeToJob', () => useJobStore().attachResumeToJob('job-1', 'resume-1')],
    ['detachResumeFromJob', 'detachResumeFromJob', () => useJobStore().detachResumeFromJob('job-1', 'resume-1')],
    ['uploadResume', 'uploadResume', () => useResumeStore().uploadResume({} as never)],
    ['updateResume', 'updateResume', () => useResumeStore().updateResume('resume-1', {} as never)],
    ['replaceResumeFile', 'replaceResumeFile', () => useResumeStore().replaceResumeFile('resume-1', {} as File)],
    ['deleteResume', 'deleteResume', () => useResumeStore().deleteResume('resume-1')],
    ['getMatchForPair', 'getMatchForPair', () => useMatchStore().getMatchForPair('job-1', 'resume-1')],
    [
      'listLatestMatchesForJob',
      'listLatestMatchesForJob',
      () => useMatchStore().listLatestMatchesForJob('job-1')
    ]
  ]

  it.each(silentAtStore)(
    '%s propagates the rejection unmodified and never toasts',
    async (_label, apiCall, callStore) => {
      const failure = new Error('upstream failure')
      vi.mocked(api[apiCall] as ReturnType<typeof vi.fn>).mockRejectedValue(failure)

      // Identity, not just message: the store must re-throw the original rejection, not wrap it —
      // the components read `err instanceof Error ? err.message : fallback` off exactly this value.
      await expect(callStore()).rejects.toBe(failure)
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    }
  )

  it('no store module imports vue-sonner at all', async () => {
    // The three store modules are already imported at the top of this file. If any of them still
    // pulled in vue-sonner, the mocked module would be part of their graph — this asserts the
    // stronger property the plan's Steps 1-3 actually ask for: the dependency is gone, not merely
    // unused.
    const [jobSource, resumeSource, matchSource] = await Promise.all([
      import('../src/stores/job?raw'),
      import('../src/stores/resume?raw'),
      import('../src/stores/match?raw')
    ])

    for (const module of [jobSource, resumeSource, matchSource]) {
      expect((module.default as string).includes("from 'vue-sonner'")).toBe(false)
    }
  })

  it('the match store keeps no errorMessage dependency either', async () => {
    const matchSource = (await import('../src/stores/match?raw')).default as string
    expect(matchSource.includes('errorMessage')).toBe(false)

    // ...while the two stores that still render a blocking load card do keep it.
    const jobSource = (await import('../src/stores/job?raw')).default as string
    const resumeSource = (await import('../src/stores/resume?raw')).default as string
    expect(jobSource.includes("errorMessage(err, 'Failed to load jobs')")).toBe(true)
    expect(resumeSource.includes("errorMessage(err, 'Failed to load CVs')")).toBe(true)
  })
})
