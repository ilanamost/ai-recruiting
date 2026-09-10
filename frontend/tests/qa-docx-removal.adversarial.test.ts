import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

/**
 * QA adversarial pass for .plan/030-2026-09-08-remove-docx-cv-support.md (frontend).
 *
 * JobCvsModal.test.ts already covers the happy legacy case — open a non-PDF CV,
 * see the fallback, fetch nothing. These cases attack what that one cannot see:
 * `previewFileStatus` is a single ref shared by every row, so the risk is state
 * leaking across selections (a legacy row leaving 'error' stuck on the next PDF,
 * or a healthy PDF leaving 'ok' stuck on the next legacy row, which would render
 * a broken iframe). Also covers mime types that are absent or malformed rather
 * than merely "not PDF", and asserts globally that no request in any of these
 * flows targets the removed /html route.
 */

vi.mock('../src/lib/api', async (importOriginal) => ({
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listJobResumes: vi.fn(),
  listResumes: vi.fn(),
  attachResumeToJob: vi.fn(),
  detachResumeFromJob: vi.fn(),
  getMatchForPair: vi.fn(),
  listLatestMatchesForJob: vi.fn(),
  createMatch: vi.fn(),
  getMatch: vi.fn(),
  getResumeFileUrl: vi.fn((id: string, options?: { download?: boolean }) =>
    `http://localhost:3001/api/resume/${id}/file${options?.download ? '?download=1' : ''}`
  )
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

import JobCvsModal from '../src/components/JobCvsModal.vue'
import {
  attachResumeToJob,
  createMatch,
  detachResumeFromJob,
  getMatch,
  getMatchForPair,
  listJobResumes,
  listLatestMatchesForJob,
  listResumes
} from '../src/lib/api'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const FALLBACK = "This CV's file couldn't be loaded — replace it from the CVs page."

const job = {
  id: 'job-1',
  org_id: 'demo-org',
  title: 'Backend Engineer',
  description: 'Node and TypeScript',
  location: 'Berlin, Germany',
  created_at: '2026-07-01T00:00:00.000Z'
}

const healthyPdf = {
  id: 'resume-1',
  candidate_id: 'candidate-1',
  candidate_name: 'Jane Doe',
  candidate_email: 'jane@example.com',
  file_name: 'jane.pdf',
  mime_type: 'application/pdf',
  content: 'Five years of experience',
  created_at: '2026-07-03T00:00:00.000Z',
  jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
  attached_at: '2026-07-04T00:00:00.000Z',
  owner_user_id: 'u1',
  years_experience: 4,
  skills: ['node', 'typescript']
}

const legacyDocx = {
  ...healthyPdf,
  id: 'resume-2',
  candidate_id: 'candidate-2',
  candidate_name: 'John Smith',
  candidate_email: 'john@example.com',
  file_name: 'john.docx',
  mime_type: DOCX_MIME,
  attached_at: '2026-07-05T00:00:00.000Z',
  owner_user_id: 'u2',
  years_experience: 9,
  skills: ['python', 'typescript']
}

function mountModal() {
  return mount(JobCvsModal, {
    props: { job },
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

async function openRow(wrapper: ReturnType<typeof mountModal>, name: string) {
  const row = wrapper.findAll('li').find((li) => li.text().includes(name))
  await row?.trigger('click')
  await flushPromises()
}

describe('JobCvsModal — legacy non-PDF CV (.plan/030 adversarial)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Amy Admin',
      email: 'amy@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listJobResumes).mockReset().mockResolvedValue([healthyPdf, legacyDocx])
    vi.mocked(listResumes).mockReset().mockResolvedValue(pageOf([healthyPdf, legacyDocx]))
    vi.mocked(attachResumeToJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(detachResumeFromJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(getMatchForPair).mockReset().mockResolvedValue(null)
    vi.mocked(listLatestMatchesForJob).mockReset().mockResolvedValue([])
    vi.mocked(createMatch).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(getMatch).mockReset().mockResolvedValue(undefined as never)

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not leave the error state stuck when a PDF is opened after a legacy CV', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openRow(wrapper, 'John Smith')
    expect(wrapper.text()).toContain(FALLBACK)
    expect(wrapper.find('iframe').exists()).toBe(false)

    // Switching to a healthy PDF must recover: the HEAD check runs and the iframe renders.
    await openRow(wrapper, 'Jane Doe')
    expect(wrapper.text()).not.toContain(FALLBACK)
    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)
    expect(iframe.attributes('src')).toBe('http://localhost:3001/api/resume/resume-1/file')
  })

  it('does not leave the ok state stuck when a legacy CV is opened after a healthy PDF', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openRow(wrapper, 'Jane Doe')
    expect(wrapper.find('iframe').exists()).toBe(true)

    // The dangerous direction: a stale 'ok' here would point an iframe at a DOCX byte stream.
    await openRow(wrapper, 'John Smith')
    expect(wrapper.text()).toContain(FALLBACK)
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('shows the fallback for a missing, empty, or malformed mime_type rather than crashing', async () => {
    const malformed = [undefined, null, '', 'application/pdf ', 'APPLICATION/PDF', 'application/msword']

    for (const mime of malformed) {
      vi.mocked(listJobResumes).mockResolvedValue([{ ...legacyDocx, mime_type: mime as string }])
      const wrapper = mountModal()
      await flushPromises()

      await openRow(wrapper, 'John Smith')

      expect(wrapper.text(), `mime_type ${JSON.stringify(mime)}`).toContain(FALLBACK)
      expect(wrapper.find('iframe').exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('never requests the removed /html route in any preview flow', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openRow(wrapper, 'John Smith')
    await openRow(wrapper, 'Jane Doe')
    await openRow(wrapper, 'John Smith')

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(requestedUrls.some((url) => url.includes('/html'))).toBe(false)
    // Only the healthy PDF should have produced a request at all.
    expect(requestedUrls).toEqual(['http://localhost:3001/api/resume/resume-1/file'])
  })

  it('still offers a download link for a legacy CV — the backend serves those bytes unchanged', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openRow(wrapper, 'John Smith')

    // The download link lives on each list row, so scope the lookup to the legacy CV's own row —
    // an unscoped findAll would return the healthy PDF's link and pass for the wrong reason.
    const legacyRow = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
    const downloadLink = legacyRow?.findAll('a').find((a) => a.text().includes('Download'))
    expect(downloadLink?.attributes('href')).toBe('http://localhost:3001/api/resume/resume-2/file?download=1')
  })
})
