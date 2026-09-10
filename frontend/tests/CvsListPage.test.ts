import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
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
  name: 'Amy Admin',
  email: 'amy@example.com',
  role: 'admin',
  org_id: 'demo-org',
  has_profile_image: false
})

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import CvsListPage from '../src/pages/CvsListPage.vue'
import { deleteResume, listResumes, replaceResumeFile, updateResume, uploadResume } from '../src/lib/api'
import { toast } from 'vue-sonner'

// .plan/018: the page reads the resume store instead of calling lib/api itself. Each mount gets
// its own testing Pinia with `stubActions: false`, so the real store actions run against the
// mocked lib/api — a mutation failure propagates out of the store and this page turns it into a
// toast itself (.plan/023), while a failed list load still becomes the store's `loadError` card.
function mountPage() {
  return mount(CvsListPage, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
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
    // .plan/029 added these to the Resume shape. This page does not filter on them — the
    // recruiter filters live in JobCvsModal — so they are only here to satisfy the type.
    years_experience: 4,
    skills: ['typescript']
  }
]

// The per-card entrance stagger the page binds via :style, in ms and in list order
// (.plan/014). Read back off the rendered style attribute rather than asserting exact values
// field-by-field, so the step size stays an implementation detail of lib/animation.
function animationDelays(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('li').map((card) => {
    const matched = /animation-delay:\s*([\d.]+)ms/.exec(card.attributes('style') ?? '')
    return matched ? Number(matched[1]) : null
  })
}

// Longer than the stagger cap (8 steps), so the last cards must share one delay.
const manyResumes = Array.from({ length: 12 }, (_, index) => ({
  ...resumes[0],
  id: `resume-many-${index}`,
  candidate_name: `Candidate ${index}`
}))

function attachFile(wrapper: ReturnType<typeof mount>, selector: string, file: File) {
  const input = wrapper.find(selector)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  return input.trigger('change')
}

describe('CvsListPage', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Amy Admin',
      email: 'amy@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listResumes).mockReset().mockResolvedValue(pageOf(resumes))
    vi.mocked(updateResume).mockReset()
    vi.mocked(deleteResume).mockReset().mockResolvedValue(undefined)
    vi.mocked(replaceResumeFile).mockReset()
    vi.mocked(uploadResume).mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('lists every CV with its attached-job badges', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(listResumes).toHaveBeenCalledWith({ page: 1, limit: 10 })
    expect(wrapper.text()).toContain('Jane Doe')
    expect(wrapper.text()).toContain('jane@example.com')
    expect(wrapper.text()).toContain('jane.pdf')
    expect(wrapper.text()).toContain('Backend Engineer')
  })

  it('shows a not-attached label for a CV with no jobs', async () => {
    vi.mocked(listResumes).mockResolvedValue(pageOf([{ ...resumes[0], jobs: [] }]))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Not attached to any job')
  })

  it('shows an empty state when there are no CVs', async () => {
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No CVs yet')
  })

  it('shows an error message when loading fails', async () => {
    vi.mocked(listResumes).mockRejectedValue(new Error('Failed to load CVs'))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load CVs')
    // .plan/018 Open Question 2: a failed list load stays a blocking card, never a toast — the
    // page would otherwise be blank with only a passing notification.
    expect(toast.error).not.toHaveBeenCalled()
  })

  // .plan/023 moved this toast back out of the resume store and into the page; the page also
  // keeps its own success-path bookkeeping (closing the edit form), which must not run on failure.
  it('surfaces a failed edit as a toast and keeps the form open', async () => {
    vi.mocked(updateResume).mockRejectedValue(new Error('Forbidden'))
    const wrapper = mountPage()
    await flushPromises()

    const editButton = wrapper.findAll('button').find((btn) => btn.text().includes('Edit'))
    await editButton?.trigger('click')
    await wrapper.find('input[type=text]').setValue('Jane R. Doe')
    const saveButton = wrapper.findAll('button').find((btn) => btn.text().includes('Save'))
    await saveButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Forbidden')
    expect(toast.success).not.toHaveBeenCalled()
    // Still in edit mode, with the Save button back out of its saving state.
    expect(wrapper.findAll('button').some((btn) => btn.text() === 'Save')).toBe(true)
  })

  it('surfaces a failed delete as a toast and leaves the CV in the list', async () => {
    vi.mocked(deleteResume).mockRejectedValue(new Error('Forbidden'))
    const wrapper = mountPage()
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((btn) => btn.text().includes('Delete'))
    await deleteButton?.trigger('click')
    const confirmButton = wrapper.findAll('button').find((btn) => btn.text().includes('Confirm delete'))
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Forbidden')
    expect(wrapper.text()).toContain('Jane Doe')
  })

  it('edits a candidate name and email', async () => {
    vi.mocked(updateResume).mockResolvedValue({ ...resumes[0], candidate_name: 'Jane R. Doe' })
    const wrapper = mountPage()
    await flushPromises()

    const editButton = wrapper.findAll('button').find((btn) => btn.text().includes('Edit'))
    await editButton?.trigger('click')

    await wrapper.find('input[type=text]').setValue('Jane R. Doe')
    const saveButton = wrapper.findAll('button').find((btn) => btn.text().includes('Save'))
    await saveButton?.trigger('click')
    await flushPromises()

    expect(updateResume).toHaveBeenCalledWith('resume-1', {
      name: 'Jane R. Doe',
      email: 'jane@example.com'
    })
    expect(wrapper.text()).toContain('Jane R. Doe')
  })

  it('replaces a CV file in place, keeping the same id', async () => {
    const file = new File(['%PDF-1.4 fake bytes'], 'jane-v2.pdf', { type: 'application/pdf' })
    vi.mocked(replaceResumeFile).mockResolvedValue({ ...resumes[0], file_name: 'jane-v2.pdf' })
    const wrapper = mountPage()
    await flushPromises()

    const replaceButton = wrapper.findAll('button').find((btn) => btn.text().includes('Replace file'))
    await replaceButton?.trigger('click')
    await attachFile(wrapper, 'input[type=file].hidden', file)
    await flushPromises()

    expect(replaceResumeFile).toHaveBeenCalledWith('resume-1', file)
    expect(wrapper.text()).toContain('jane-v2.pdf')
    expect(toast.success).toHaveBeenCalledWith('CV file replaced')
  })

  // .plan/023: onReplaceFileChange raises this toast itself now — the store no longer does.
  it('surfaces a failed file replace as a toast, leaving the existing file in place', async () => {
    const file = new File(['%PDF-1.4 fake bytes'], 'jane-v2.pdf', { type: 'application/pdf' })
    vi.mocked(replaceResumeFile).mockRejectedValue(new Error('File too large'))
    const wrapper = mountPage()
    await flushPromises()

    const replaceButton = wrapper.findAll('button').find((btn) => btn.text().includes('Replace file'))
    await replaceButton?.trigger('click')
    await attachFile(wrapper, 'input[type=file].hidden', file)
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('File too large')
    expect(toast.success).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('jane.pdf')
    // The button leaves its "Replacing…" state, so the replace can be retried.
    expect(wrapper.findAll('button').some((btn) => btn.text().includes('Replace file'))).toBe(true)
  })

  it('uploads a job-less CV', async () => {
    const file = new File(['%PDF-1.4 fake bytes'], 'newcandidate.pdf', { type: 'application/pdf' })
    vi.mocked(uploadResume).mockResolvedValue({
      id: 'resume-2',
      candidate_id: 'candidate-2',
      candidate_name: 'New Candidate',
      candidate_email: 'new@example.com',
      file_name: 'newcandidate.pdf',
      mime_type: 'application/pdf',
      content: 'text',
      created_at: '2026-07-06T00:00:00.000Z',
      jobs: [],
      owner_user_id: 'u1',
      // .plan/029 added these to Resume. Unused here — this suite predates the
      // recruiter filters and does not exercise them.
      years_experience: null,
      skills: []
    })
    const wrapper = mountPage()
    await flushPromises()

    const openUploadButton = wrapper.findAll('button').find((btn) => btn.text().includes('Upload CV'))
    await openUploadButton?.trigger('click')

    const nameInputs = wrapper.findAll('input[type=text]')
    await nameInputs[nameInputs.length - 1].setValue('New Candidate')
    await wrapper.find('input[type=email]').setValue('new@example.com')
    await attachFile(wrapper, 'form input[type=file]', file)

    // .plan/028: the store re-requests the current page after an upload instead of prepending
    // the new CV locally, so the new CV reaches the list through this reload, exactly as it
    // does against the real API.
    vi.mocked(listResumes).mockResolvedValue(
      pageOf([{ ...resumes[0], id: 'resume-2', candidate_name: 'New Candidate', jobs: [] }, ...resumes])
    )

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(uploadResume).toHaveBeenCalledWith({ name: 'New Candidate', email: 'new@example.com', file })
    expect(wrapper.text()).toContain('New Candidate')
    expect(wrapper.text()).toContain('Not attached to any job')
  })

  // .plan/023: submitUpload raises this toast itself now, and the form must keep the values the
  // candidate already typed so they can retry without re-entering everything.
  it('surfaces a failed upload as a toast and keeps the upload form open with its values', async () => {
    const file = new File(['%PDF-1.4 fake bytes'], 'newcandidate.pdf', { type: 'application/pdf' })
    vi.mocked(uploadResume).mockRejectedValue(new Error('Unsupported file type'))
    const wrapper = mountPage()
    await flushPromises()

    const openUploadButton = wrapper.findAll('button').find((btn) => btn.text().includes('Upload CV'))
    await openUploadButton?.trigger('click')

    const nameInputs = wrapper.findAll('input[type=text]')
    await nameInputs[nameInputs.length - 1].setValue('New Candidate')
    await wrapper.find('input[type=email]').setValue('new@example.com')
    await attachFile(wrapper, 'form input[type=file]', file)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Unsupported file type')
    expect(toast.success).not.toHaveBeenCalled()
    expect(wrapper.find('form').exists()).toBe(true)
    expect((wrapper.find('input[type=email]').element as HTMLInputElement).value).toBe('new@example.com')
  })

  it('requires a confirm step before deleting, naming the cascade impact', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((btn) => btn.text().includes('Delete'))
    await deleteButton?.trigger('click')

    expect(deleteResume).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This will also delete its match results.')

    // .plan/028: the deleted CV leaves the list via the store's re-fetch, not a local filter.
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))

    const confirmButton = wrapper.findAll('button').find((btn) => btn.text().includes('Confirm delete'))
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(deleteResume).toHaveBeenCalledWith('resume-1')
    expect(wrapper.text()).toContain('No CVs yet')
  })

  it('cancels a delete without calling the API', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const deleteButton = wrapper.findAll('button').find((btn) => btn.text().includes('Delete'))
    await deleteButton?.trigger('click')

    const cancelButton = wrapper.findAll('button').find((btn) => btn.text() === 'Cancel')
    await cancelButton?.trigger('click')
    await flushPromises()

    expect(deleteResume).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Jane Doe')
  })

  // Server-side pagination (.plan/028 Step 13). The page owns the page number and re-requests
  // on every change; the store/API keep the envelope's total so the pager can say "of Y".
  describe('pagination', () => {
    it('requests the first page at the default page size on mount', async () => {
      mountPage()
      await flushPromises()

      expect(listResumes).toHaveBeenCalledWith({ page: 1, limit: 10 })
    })

    it('renders the pager with the total page count from the response envelope', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf(resumes, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findComponent({ name: 'Pager' }).exists()).toBe(true)
      expect(wrapper.text()).toContain('Page 1 of 3')
    })

    it('re-requests the next page when Next is clicked', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf(resumes, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      const nextResumes = [{ ...resumes[0], id: 'resume-11', candidate_name: 'Page Two Candidate' }]
      vi.mocked(listResumes).mockResolvedValue(pageOf(nextResumes, { total: 25, page: 2, limit: 10 }))

      await wrapper.get('button[aria-label="Next page"]').trigger('click')
      await flushPromises()

      expect(listResumes).toHaveBeenLastCalledWith({ page: 2, limit: 10 })
      expect(wrapper.text()).toContain('Page Two Candidate')
      expect(wrapper.text()).not.toContain('Jane Doe')
      expect(wrapper.text()).toContain('Page 2 of 3')
    })

    // The rows-per-page select resets to page 1 rather than replaying the current page number
    // at the new size — page 2 at limit 10 has no defined meaning at limit 50.
    it('re-requests page 1 at the new size when the rows-per-page select changes', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf(resumes, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.get('button[aria-label="Next page"]').trigger('click')
      await flushPromises()

      vi.mocked(listResumes).mockResolvedValue(pageOf(resumes, { total: 25, page: 1, limit: 50 }))
      await wrapper.get('select[aria-label="Rows per page"]').setValue('50')
      await flushPromises()

      expect(listResumes).toHaveBeenLastCalledWith({ page: 1, limit: 50 })
      expect(wrapper.text()).toContain('Page 1 of 1')
    })

    // Failure path: the CVs page has no filter escape hatch, so a failed page change must land
    // on the same blocking "couldn't load" card as a failed first load, not a silent no-op.
    it('shows the blocking load-error card when a page change fails', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf(resumes, { total: 25, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      vi.mocked(listResumes).mockRejectedValue(new Error('Network is down'))

      await wrapper.get('button[aria-label="Next page"]').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('Network is down')
    })

    it('hides the pager entirely when there are no CVs at all', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([], { total: 0, page: 1, limit: 10 }))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findComponent({ name: 'Pager' }).exists()).toBe(false)
      expect(wrapper.text()).toContain('No CVs yet')
    })
  })

  // Card entrance animation (.plan/014 items 2 and 5). jsdom neither runs CSS animations nor
  // resolves stylesheets, so these assert the class and the bound delay the component
  // produces — the visual check is manual, per the plan's Risks section.
  describe('entrance animation', () => {
    it('gives every CV card the entrance class and a stagger delay that grows with index', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([resumes[0], { ...resumes[0], id: 'resume-2' }]))
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
      vi.mocked(listResumes).mockResolvedValue(pageOf(manyResumes))
      const wrapper = mountPage()
      await flushPromises()

      const delays = animationDelays(wrapper)
      expect(delays).toHaveLength(manyResumes.length)

      // Monotonically non-decreasing, and flat once the cap is reached.
      for (let index = 1; index < delays.length; index += 1) {
        expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]!)
      }
      expect(delays.at(-1)).toBe(delays[8])
      expect(delays.at(-1)).toBeLessThanOrEqual(500)
    })

    it('fades in the "No CVs yet" empty state', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([]))
      const wrapper = mountPage()
      await flushPromises()

      const emptyCard = wrapper.find('.card.fade-in')
      expect(emptyCard.exists()).toBe(true)
      expect(emptyCard.text()).toContain('No CVs yet')
    })

    it('fades in the error card', async () => {
      vi.mocked(listResumes).mockRejectedValue(new Error('Failed to load CVs'))
      const wrapper = mountPage()
      await flushPromises()

      const errorCard = wrapper.find('.card.fade-in')
      expect(errorCard.exists()).toBe(true)
      expect(errorCard.text()).toContain('Failed to load CVs')
    })
  })

  describe('recruiter role (read-only)', () => {
    beforeEach(() => {
      mockUser.value = { ...mockUser.value, role: 'recruiter' }
    })

    it('lists CVs but hides Upload CV, Edit, Replace file, and Delete controls', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('Jane Doe')
      const buttonLabels = wrapper.findAll('button').map((btn) => btn.text())
      expect(buttonLabels.some((text) => text.includes('Upload CV'))).toBe(false)
      expect(buttonLabels).not.toContain('Edit')
      expect(buttonLabels.some((text) => text.includes('Replace file'))).toBe(false)
      expect(buttonLabels).not.toContain('Delete')
    })
  })

  describe('candidate role, own CV (per .plan/009-...-candidate-cv-ownership-scoping.md)', () => {
    beforeEach(() => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
    })

    it('lists CVs and shows Upload CV, Edit, Replace file, and Delete on a CV they own', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(listResumes).toHaveBeenCalledWith({ page: 1, limit: 10 })
      expect(wrapper.text()).toContain('Jane Doe')
      const buttonLabels = wrapper.findAll('button').map((btn) => btn.text())
      expect(buttonLabels.some((text) => text.includes('Upload CV'))).toBe(true)
      expect(buttonLabels).toContain('Edit')
      expect(buttonLabels.some((text) => text.includes('Replace file'))).toBe(true)
      expect(buttonLabels).toContain('Delete')
    })

    it('can edit and replace a CV file they own', async () => {
      vi.mocked(updateResume).mockResolvedValue({ ...resumes[0], candidate_name: 'Jane R. Doe' })
      const wrapper = mountPage()
      await flushPromises()

      const editButton = wrapper.findAll('button').find((btn) => btn.text().includes('Edit'))
      await editButton?.trigger('click')
      await wrapper.find('input[type=text]').setValue('Jane R. Doe')
      const saveButton = wrapper.findAll('button').find((btn) => btn.text().includes('Save'))
      await saveButton?.trigger('click')
      await flushPromises()

      expect(updateResume).toHaveBeenCalledWith('resume-1', { name: 'Jane R. Doe', email: 'jane@example.com' })
    })
  })

  // .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md supersedes .plan/009's Open
  // Question 2: a Candidate must not see another candidate's CV on this route at all — not even
  // as a read-only row with the management controls hidden, which is what this block used to
  // assert. The backend now narrows GET /api/resume to the caller's own CVs; these mocks
  // deliberately return the pre-.plan/032 broad response to prove the page's own defensive
  // filter would still hide a non-owned row on its own.
  describe('candidate role, another candidate\'s CV (ownership-scoped, .plan/032-...)', () => {
    const ownResume = { ...resumes[0], owner_user_id: 'u1' }
    const othersResume = {
      id: 'resume-2',
      candidate_id: 'candidate-2',
      candidate_name: 'John Smith',
      candidate_email: 'john@example.com',
      file_name: 'john.pdf',
      mime_type: 'application/pdf',
      content: 'text',
      created_at: '2026-07-04T00:00:00.000Z',
      jobs: [],
      owner_user_id: 'u2',
      // .plan/029 added these to Resume. Unused here — this suite predates the
      // recruiter filters and does not exercise them.
      years_experience: null,
      skills: []
    }
    // Open Question 2 of .plan/032: a null owner is "owned by someone else" for a Candidate.
    const unownedResume = { ...othersResume, id: 'resume-3', candidate_name: 'Nobody Owns This', owner_user_id: null }

    beforeEach(() => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
      vi.mocked(listResumes).mockResolvedValue(pageOf([ownResume, othersResume]))
    })

    it('renders only the CV they own, dropping another candidate\'s row entirely', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const rows = wrapper.findAll('li')
      expect(rows).toHaveLength(1)
      expect(rows[0].text()).toContain('Jane Doe')

      // None of the other candidate's PII reaches the page — name, email, or file name.
      expect(wrapper.text()).not.toContain('John Smith')
      expect(wrapper.text()).not.toContain('john@example.com')
      expect(wrapper.text()).not.toContain('john.pdf')
    })

    it('keeps Edit, Replace file, and Delete on the row they own', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const rows = wrapper.findAll('li')
      const ownRow = rows.find((row) => row.text().includes('Jane Doe'))

      expect(ownRow?.findAll('button').some((btn) => btn.text().includes('Edit'))).toBe(true)
      expect(ownRow?.findAll('button').some((btn) => btn.text().includes('Replace file'))).toBe(true)
      expect(ownRow?.findAll('button').some((btn) => btn.text().includes('Delete'))).toBe(true)
    })

    it('drops a null-owner CV too, treating it as owned by someone else', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([ownResume, unownedResume]))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findAll('li')).toHaveLength(1)
      expect(wrapper.text()).not.toContain('Nobody Owns This')
    })

    it('falls back to the empty state when every returned CV belongs to someone else', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([othersResume, unownedResume]))
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findAll('li')).toHaveLength(0)
      expect(wrapper.text()).toContain('No CVs yet')
      expect(wrapper.text()).not.toContain('John Smith')
    })

    it('still shows Upload CV even when nothing in the response is theirs', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([othersResume]))
      const wrapper = mountPage()
      await flushPromises()

      const buttonLabels = wrapper.findAll('button').map((btn) => btn.text())
      expect(buttonLabels.some((text) => text.includes('Upload CV'))).toBe(true)
    })
  })

  describe('admin role sees management controls on every row regardless of owner', () => {
    it('shows Edit and Delete on both an owned and an unowned/other-owned CV row', async () => {
      vi.mocked(listResumes).mockResolvedValue(pageOf([
        { ...resumes[0], owner_user_id: 'u1' },
        {
          id: 'resume-2',
          candidate_id: 'candidate-2',
          candidate_name: 'John Smith',
          candidate_email: 'john@example.com',
          file_name: 'john.pdf',
          mime_type: 'application/pdf',
          content: 'text',
          created_at: '2026-07-04T00:00:00.000Z',
          jobs: [],
          owner_user_id: null,
          // .plan/029 added these to Resume. Unused here — this suite predates the
          // recruiter filters and does not exercise them.
          years_experience: null,
          skills: []
        }
      ]))
      const wrapper = mountPage()
      await flushPromises()

      const rows = wrapper.findAll('li')
      for (const row of rows) {
        expect(row.findAll('button').some((btn) => btn.text().includes('Edit'))).toBe(true)
        expect(row.findAll('button').some((btn) => btn.text().includes('Delete'))).toBe(true)
      }
    })
  })
})
