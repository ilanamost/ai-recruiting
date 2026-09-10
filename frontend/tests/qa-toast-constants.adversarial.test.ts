import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { TOAST } from '../src/lib/toastMessages'

// QA adversarial pass over .plan/026-2026-08-17-toast-message-constants.md. This is a pure
// relocation, so the acceptance bar is narrow and unusual: *identical visible behavior*, with the
// copy merely authored elsewhere. tests/lib/toastMessages.test.ts already pins the module shape
// and a sample of the copy. Four things it cannot catch by construction, each covered below:
//
//  A. It pins 12 of the 30 constants by value. The other 18 — jobDeleted, matchLoadFailed,
//     resumeDetachFailed and friends — could be reworded and the whole suite would still pass,
//     which is precisely the regression this plan exists to prevent. All 30 rows of the plan's
//     Scope tables are pinned here instead of a sample.
//  B. Its stray-literal guard iterates a hardcoded list of the six files this plan touched. A
//     *new* component landing `toast.success('Saved')` tomorrow is unguarded. The scan below
//     enumerates every source file under src/ instead, so the invariant covers files that do not
//     exist yet.
//  C. `TOAST.info` being empty is only correct while no info-style toast call site exists. That
//     premise is asserted in prose in the plan and nowhere in code.
//  D. Nothing proves the *rendered* text is unchanged. Constants can be right while a call site
//     points at the wrong one — success.jobDeleted and success.jobDuplicated are interchangeable
//     to the type checker. The behavioral cases drive real components and assert the exact
//     string, written inline rather than read back off TOAST, so an edit to a constant fails here
//     too rather than tautologically passing.

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listJobs: vi.fn(),
  listResumes: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  duplicateJob: vi.fn(),
  updateResume: vi.fn(),
  deleteResume: vi.fn(),
  replaceResumeFile: vi.fn(),
  uploadResume: vi.fn(),
  listJobResumes: vi.fn(),
  getResumeFileUrl: vi.fn(() => 'http://localhost:3001/api/resume/resume-1/file')
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

import JobForm from '../src/components/JobForm.vue'
import JobsListPage from '../src/pages/JobsListPage.vue'
import CvsListPage from '../src/pages/CvsListPage.vue'
import * as api from '../src/lib/api'
import { toast } from 'vue-sonner'

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

function testingPinia() {
  return createTestingPinia({ createSpy: vi.fn, stubActions: false })
}

function clickButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(label))!.trigger('click')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listJobs).mockResolvedValue(pageOf([job]) as never)
  vi.mocked(api.listResumes).mockResolvedValue(pageOf([resume]) as never)
  vi.mocked(api.listJobResumes).mockResolvedValue([] as never)
})

// ---------------------------------------------------------------------------
// A. Every row of the plan's Scope tables, not a sample.
// ---------------------------------------------------------------------------
describe('all 30 constants match the plan Scope tables byte for byte', () => {
  // Transcribed from .plan/026-2026-08-17-toast-message-constants.md, which records the copy as
  // it read *before* the relocation. Independent of src/lib/toastMessages.ts by construction.
  const successCopy: Record<string, string> = {
    jobCreated: 'Job created successfully',
    jobUpdated: 'Job updated',
    jobDeleted: 'Job deleted',
    jobDuplicated: 'Job duplicated',
    resumeUpdated: 'CV updated',
    resumeDeleted: 'CV deleted',
    resumeFileReplaced: 'CV file replaced',
    resumeUploaded: 'CV uploaded',
    resumeAttached: 'CV attached',
    resumeDetached: 'CV detached',
    settingsImageRemoved: 'Profile image removed',
    settingsUpdated: 'Settings updated',
    authLoggedIn: 'Logged in',
    authAccountCreated: 'Account created'
  }

  const errorCopy: Record<string, string> = {
    jobValidationRequired: 'Title and description are required',
    jobCreateFailed: 'Failed to create job',
    jobUpdateFailed: 'Failed to update job',
    jobDeleteFailed: 'Failed to delete job',
    jobDuplicateFailed: 'Failed to duplicate job',
    resumeValidationRequired: 'Name and email are required',
    resumeFileRequired: 'A CV file is required',
    resumeUpdateFailed: 'Failed to update CV',
    resumeDeleteFailed: 'Failed to delete CV',
    resumeFileReplaceFailed: 'Failed to replace CV file',
    resumeUploadFailed: 'Failed to upload CV',
    resumeAttachFailed: 'Failed to attach CV',
    resumeDetachFailed: 'Failed to detach CV',
    matchLoadFailed: 'Failed to load match scores',
    matchLookupFailed: 'Failed to look up an existing match',
    settingsImageRemoveFailed: 'Failed to remove profile image'
  }

  it.each(Object.entries(successCopy))('TOAST.success.%s is exactly %j', (key, copy) => {
    expect((TOAST.success as Record<string, string>)[key]).toBe(copy)
  })

  it.each(Object.entries(errorCopy))('TOAST.error.%s is exactly %j', (key, copy) => {
    expect((TOAST.error as Record<string, string>)[key]).toBe(copy)
  })

  it('exports exactly the Scope tables and nothing extra', () => {
    expect(Object.keys(TOAST.success).sort()).toEqual(Object.keys(successCopy).sort())
    expect(Object.keys(TOAST.error).sort()).toEqual(Object.keys(errorCopy).sort())
  })
})

// ---------------------------------------------------------------------------
// B/C. Repo-wide source scan — covers files this plan never touched, and files
//      that do not exist yet.
// ---------------------------------------------------------------------------
describe('no source file anywhere under src/ authors toast copy inline', () => {
  const sources = import.meta.glob('../src/**/*.{vue,ts}', {
    query: '?raw',
    import: 'default',
    eager: true
  }) as Record<string, string>

  // Every `toast.<type>(` occurrence with its argument list, balanced across newlines so a call
  // wrapped onto a second line cannot slip past a line-anchored regex.
  function toastCalls(source: string) {
    const found: Array<{ type: string; args: string }> = []
    const opener = /toast\.(success|error|info|message|warning)\(/g
    let match: RegExpExecArray | null
    while ((match = opener.exec(source))) {
      let depth = 1
      let inString: string | null = null
      let args = ''
      for (let i = opener.lastIndex; i < source.length && depth > 0; i++) {
        const char = source[i]
        if (inString) {
          args += char
          if (char === inString && source[i - 1] !== '\\') inString = null
          continue
        }
        if (char === "'" || char === '"' || char === '`') inString = char
        else if (char === '(') depth++
        else if (char === ')' && --depth === 0) break
        args += char
      }
      found.push({ type: match[1], args })
    }
    return found
  }

  const callingFiles = Object.entries(sources).filter(
    ([path, source]) => !path.endsWith('toastMessages.ts') && toastCalls(source).length > 0
  )

  it('finds the six call-site files the plan enumerated, and no others', () => {
    expect(callingFiles.map(([path]) => path.split('/').pop()).sort()).toEqual([
      'CvsListPage.vue',
      'JobCvsModal.vue',
      'JobForm.vue',
      'JobsListPage.vue',
      'LoginPage.vue',
      'SettingsPage.vue'
    ])
  })

  it.each(callingFiles)('%s passes no string literal as toast copy', (_path, source) => {
    for (const call of toastCalls(source)) {
      // The message argument only — call options like `{ toasterId: 'center' }` legitimately
      // carry quotes and the plan explicitly keeps them.
      let depth = 0
      let message = ''
      let inString: string | null = null
      for (const char of call.args) {
        if (inString) {
          message += char
          if (char === inString) inString = null
          continue
        }
        if (char === "'" || char === '"' || char === '`') inString = char
        else if (char === '(' || char === '{') depth++
        else if (char === ')' || char === '}') depth--
        else if (char === ',' && depth === 0) break
        message += char
      }
      expect(message).toContain('TOAST.')
      expect(message).not.toMatch(/['"`]/)
    }
  })

  it('has no info, message, or warning call site, which is what makes TOAST.info empty correct', () => {
    const reserved = callingFiles.flatMap(([path, source]) =>
      toastCalls(source)
        .filter((call) => call.type !== 'success' && call.type !== 'error')
        .map((call) => `${path}: toast.${call.type}`)
    )
    expect(reserved).toEqual([])
    expect(TOAST.info).toEqual({})
  })

  it('leaves no constant unreferenced, and shares exactly the two the plan flagged', () => {
    const allSource = Object.entries(sources)
      .filter(([path]) => !path.endsWith('toastMessages.ts'))
      .map(([, source]) => source)
      .join('\n')

    const counts = new Map<string, number>()
    for (const group of ['success', 'error'] as const) {
      for (const key of Object.keys(TOAST[group])) {
        const uses = allSource.match(new RegExp(`TOAST\\.${group}\\.${key}\\b`, 'g')) ?? []
        counts.set(`${group}.${key}`, uses.length)
      }
    }

    // Dead copy is a relocation bug: a constant nothing references means a call site was missed.
    const unreferenced = [...counts].filter(([, n]) => n === 0).map(([key]) => key)
    expect(unreferenced).toEqual([])

    // .plan/026 Risks: exactly two literals were de-duplicated across two call sites each.
    const shared = [...counts].filter(([, n]) => n > 1).map(([key, n]) => `${key} x${n}`).sort()
    expect(shared).toEqual(['error.jobValidationRequired x2', 'error.resumeValidationRequired x2'])
  })

  it('references each shared constant from both of its original files', () => {
    function sourceOf(name: string) {
      return Object.entries(sources).find(([path]) => path.endsWith(name))![1]
    }

    expect(sourceOf('JobForm.vue')).toContain('TOAST.error.jobValidationRequired')
    expect(sourceOf('JobsListPage.vue')).toContain('TOAST.error.jobValidationRequired')

    // Both of resumeValidationRequired's call sites live in one file (saveEdit and submitUpload),
    // so a file-level `toContain` would pass with one of them missing. Count instead.
    const cvsPage = sourceOf('CvsListPage.vue')
    expect(cvsPage.match(/TOAST\.error\.resumeValidationRequired\b/g)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// D. Behavioral: the rendered string, from a real component, at both call sites
//    of each shared constant.
// ---------------------------------------------------------------------------
describe('the text a user actually sees is unchanged', () => {
  it('JobForm validation still reads "Title and description are required"', async () => {
    const wrapper = mount(JobForm, { global: { plugins: [testingPinia()] } })

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Title and description are required')
    expect(api.createJob).not.toHaveBeenCalled()
  })

  it('JobsListPage inline edit validation reads the same string as JobForm', async () => {
    const wrapper = mount(JobsListPage, {
      global: { plugins: [testingPinia()], stubs: { JobCvsModal: true } }
    })
    await flushPromises()

    await clickButton(wrapper, 'Edit')
    await wrapper.find('li input[type=text]').setValue('   ')
    await clickButton(wrapper, 'Save')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Title and description are required')
    expect(api.updateJob).not.toHaveBeenCalled()
  })

  it('CvsListPage inline edit validation reads "Name and email are required"', async () => {
    const wrapper = mount(CvsListPage, { global: { plugins: [testingPinia()] } })
    await flushPromises()

    await clickButton(wrapper, 'Edit')
    await wrapper.find('li input[type=text]').setValue('')
    await clickButton(wrapper, 'Save')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Name and email are required')
    expect(api.updateResume).not.toHaveBeenCalled()
  })

  it('CvsListPage upload validation reads the same string as its inline edit', async () => {
    const wrapper = mount(CvsListPage, { global: { plugins: [testingPinia()] } })
    await flushPromises()

    await clickButton(wrapper, 'Upload CV')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Name and email are required')
    expect(api.uploadResume).not.toHaveBeenCalled()
  })

  it('CvsListPage still demands a file with "A CV file is required" once name and email are filled', async () => {
    const wrapper = mount(CvsListPage, { global: { plugins: [testingPinia()] } })
    await flushPromises()

    await clickButton(wrapper, 'Upload CV')
    const textInputs = wrapper.findAll('input[type=text]')
    await textInputs[textInputs.length - 1].setValue('New Candidate')
    await wrapper.find('input[type=email]').setValue('new@example.com')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('A CV file is required')
    expect(api.uploadResume).not.toHaveBeenCalled()
  })

  it('JobsListPage still reads "Job deleted" on the success path', async () => {
    vi.mocked(api.deleteJob).mockResolvedValue(undefined as never)
    const wrapper = mount(JobsListPage, {
      global: { plugins: [testingPinia()], stubs: { JobCvsModal: true } }
    })
    await flushPromises()

    await clickButton(wrapper, 'Delete')
    await clickButton(wrapper, 'Confirm delete')
    await flushPromises()

    expect(toast.success).toHaveBeenCalledWith('Job deleted')
  })
})

// ---------------------------------------------------------------------------
// The fallback half of every ternary — the shape most at risk in this edit.
// ---------------------------------------------------------------------------
describe('a non-Error rejection still falls back to the relocated copy', () => {
  // The riskiest edit in this plan is the `err instanceof Error ? err.message : '...'` ternary:
  // the fallback moved and the condition did not. Every existing failure-path test rejects with a
  // real Error, so all of them take the `err.message` branch and none of them exercise the branch
  // that was actually edited. Rejecting with a bare string forces the fallback — a mangled
  // ternary surfaces `undefined` or the raw value here instead of the copy.
  it('JobForm shows "Failed to create job" when the rejection is not an Error', async () => {
    vi.mocked(api.createJob).mockRejectedValue('database exploded' as never)
    const wrapper = mount(JobForm, { global: { plugins: [testingPinia()] } })

    await wrapper.find('input[type=text]').setValue('Backend Engineer')
    await wrapper.find('textarea').setValue('Node and TypeScript')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Failed to create job')
    expect(toast.error).not.toHaveBeenCalledWith(undefined)
    expect(toast.error).not.toHaveBeenCalledWith('database exploded')
  })

  it('JobsListPage shows "Failed to duplicate job" when the rejection is not an Error', async () => {
    vi.mocked(api.duplicateJob).mockRejectedValue({ status: 500 } as never)
    const wrapper = mount(JobsListPage, {
      global: { plugins: [testingPinia()], stubs: { JobCvsModal: true } }
    })
    await flushPromises()

    await clickButton(wrapper, 'Duplicate')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Failed to duplicate job')
  })

  it('CvsListPage shows "Failed to delete CV" when the rejection is not an Error', async () => {
    vi.mocked(api.deleteResume).mockRejectedValue('gateway timeout' as never)
    const wrapper = mount(CvsListPage, { global: { plugins: [testingPinia()] } })
    await flushPromises()

    await clickButton(wrapper, 'Delete')
    await clickButton(wrapper, 'Confirm delete')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Failed to delete CV')
  })
})
