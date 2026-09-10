import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from '../helpers/page'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../../src/lib/api')>()).UNPAGED_LIMIT,
  listResumes: vi.fn(),
  uploadResume: vi.fn(),
  updateResume: vi.fn(),
  replaceResumeFile: vi.fn(),
  deleteResume: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import { useResumeStore } from '../../src/stores/resume'
import * as api from '../../src/lib/api'
import { toast } from 'vue-sonner'

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
    jobs: [],
    owner_user_id: 'u2',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  }
]

const file = new File(['%PDF-1.4 fake bytes'], 'jane-v2.pdf', { type: 'application/pdf' })

describe('resume store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(api.listResumes).mockReset().mockResolvedValue(pageOf(resumes))
    vi.mocked(api.uploadResume).mockReset()
    vi.mocked(api.updateResume).mockReset()
    vi.mocked(api.replaceResumeFile).mockReset()
    vi.mocked(api.deleteResume).mockReset().mockResolvedValue(undefined)
    vi.mocked(toast.error).mockClear()
  })

  describe('listResumes', () => {
    it('loads the resumes into state and leaves loadError unset', async () => {
      const store = useResumeStore()

      await store.listResumes()

      expect(api.listResumes).toHaveBeenCalledWith({ page: 1, limit: 10 })
      expect(store.resumes).toEqual(resumes)
      expect(store.loadError).toBeNull()
    })

    // .plan/028: same envelope handling as the job store — `resumes` is one page, and
    // total/page/limit describe the whole list for the pager.
    it('stores the envelope metadata alongside the page of resumes', async () => {
      vi.mocked(api.listResumes).mockResolvedValue(pageOf(resumes, { total: 42, page: 2, limit: 10 }))
      const store = useResumeStore()

      await store.listResumes(2)

      expect(api.listResumes).toHaveBeenCalledWith({ page: 2, limit: 10 })
      expect(store.resumes).toEqual(resumes)
      expect(store.total).toBe(42)
      expect(store.page).toBe(2)
      expect(store.limit).toBe(10)
    })

    // JobCvsModal's attach dropdown needs every CV, not one page, and passes a high limit for
    // it — the third `options` argument has to survive that (it's what keeps a background
    // refresh from blanking the page behind the modal with a shared loadError).
    it('keeps `silent` working alongside the paging arguments', async () => {
      vi.mocked(api.listResumes).mockRejectedValue(new Error('Network is down'))
      const store = useResumeStore()

      await expect(store.listResumes(1, 500, { silent: true })).rejects.toThrow('Network is down')

      expect(api.listResumes).toHaveBeenCalledWith({ page: 1, limit: 500 })
      expect(store.loadError).toBeNull()
    })

    // The toast/loadError split from .plan/018 Open Question 2 — CvsListPage renders a blocking
    // "couldn't load" card for this, so it must not become a toast.
    it('sets loadError and does NOT toast when the load fails', async () => {
      vi.mocked(api.listResumes).mockRejectedValue(new Error('Network is down'))
      const store = useResumeStore()

      await expect(store.listResumes()).rejects.toThrow('Network is down')

      expect(store.loadError).toBe('Network is down')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('falls back to "Failed to load CVs" when the rejection is not an Error', async () => {
      vi.mocked(api.listResumes).mockRejectedValue('boom')
      const store = useResumeStore()

      await expect(store.listResumes()).rejects.toBeTruthy()

      expect(store.loadError).toBe('Failed to load CVs')
    })

    it('clears a previous loadError when a later load succeeds', async () => {
      vi.mocked(api.listResumes).mockRejectedValueOnce(new Error('Network is down'))
      const store = useResumeStore()

      await expect(store.listResumes()).rejects.toThrow()
      expect(store.loadError).toBe('Network is down')

      await store.listResumes()

      expect(store.loadError).toBeNull()
    })
  })

  describe('uploadResume', () => {
    // .plan/028 Step 11: no more local prepend. With server-side paging, prepending would push
    // the page to `limit + 1` rows and put the new CV somewhere the server's ordering doesn't,
    // so the store re-requests the current page and renders whatever comes back.
    it('re-fetches the current page instead of prepending locally', async () => {
      const uploaded = { ...resumes[0], id: 'resume-3', candidate_name: 'New Candidate' }
      vi.mocked(api.uploadResume).mockResolvedValue(uploaded)
      vi.mocked(api.listResumes).mockResolvedValue(pageOf(resumes, { total: 20, page: 2, limit: 10 }))
      const store = useResumeStore()
      await store.listResumes(2)
      vi.mocked(api.listResumes).mockResolvedValue(pageOf([uploaded, ...resumes], { total: 21, page: 2, limit: 10 }))

      const result = await store.uploadResume({ name: 'New Candidate', email: 'new@example.com', file })

      expect(result).toEqual(uploaded)
      expect(api.listResumes).toHaveBeenLastCalledWith({ page: 2, limit: 10 })
      expect(store.resumes.map((resume) => resume.id)).toEqual(['resume-3', 'resume-1', 'resume-2'])
      expect(store.total).toBe(21)
    })

    // .plan/023 moved the toast to CvsListPage's submitUpload — see CvsListPage.test.ts for the
    // message and its 'Failed to upload CV' fallback. The store's job is to get out of the way.
    it('propagates the failure untouched, without toasting or setting loadError', async () => {
      vi.mocked(api.uploadResume).mockRejectedValue(new Error('Unsupported file type'))
      const store = useResumeStore()

      await expect(store.uploadResume({ name: 'A', email: 'a@example.com', file })).rejects.toThrow(
        'Unsupported file type'
      )

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })

  describe('updateResume', () => {
    it('replaces the matching resume in state', async () => {
      const updated = { ...resumes[0], candidate_name: 'Jane R. Doe' }
      vi.mocked(api.updateResume).mockResolvedValue(updated)
      const store = useResumeStore()
      await store.listResumes()

      await store.updateResume('resume-1', { name: 'Jane R. Doe' })

      expect(store.resumes[0]).toEqual(updated)
      expect(store.resumes[1]).toEqual(resumes[1])
    })

    // .plan/023: CvsListPage's saveEdit owns the toast now (CvsListPage.test.ts).
    it('propagates the failure untouched and leaves state untouched', async () => {
      vi.mocked(api.updateResume).mockRejectedValue(new Error('Forbidden'))
      const store = useResumeStore()
      await store.listResumes()

      await expect(store.updateResume('resume-1', { name: 'x' })).rejects.toThrow('Forbidden')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.resumes).toEqual(resumes)
      expect(store.loadError).toBeNull()
    })
  })

  describe('replaceResumeFile', () => {
    it('replaces the matching resume in state, keeping its id', async () => {
      const updated = { ...resumes[0], file_name: 'jane-v2.pdf' }
      vi.mocked(api.replaceResumeFile).mockResolvedValue(updated)
      const store = useResumeStore()
      await store.listResumes()

      await store.replaceResumeFile('resume-1', file)

      expect(api.replaceResumeFile).toHaveBeenCalledWith('resume-1', file)
      expect(store.resumes[0].file_name).toBe('jane-v2.pdf')
      expect(store.resumes[0].id).toBe('resume-1')
    })

    // .plan/023: CvsListPage's onReplaceFileChange owns the toast now (CvsListPage.test.ts).
    it('propagates the failure untouched, without toasting', async () => {
      vi.mocked(api.replaceResumeFile).mockRejectedValue(new Error('File too large'))
      const store = useResumeStore()

      await expect(store.replaceResumeFile('resume-1', file)).rejects.toThrow('File too large')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })

  describe('deleteResume', () => {
    // Same reasoning as uploadResume: a local filter would leave the page one row short of
    // `limit` while the next page still holds a CV that belongs in the gap.
    it('re-fetches the current page instead of filtering locally', async () => {
      vi.mocked(api.listResumes).mockResolvedValue(pageOf(resumes, { total: 20, page: 2, limit: 10 }))
      const store = useResumeStore()
      await store.listResumes(2)
      vi.mocked(api.listResumes).mockResolvedValue(pageOf([resumes[1]], { total: 19, page: 2, limit: 10 }))

      await store.deleteResume('resume-1')

      expect(api.deleteResume).toHaveBeenCalledWith('resume-1')
      expect(api.listResumes).toHaveBeenLastCalledWith({ page: 2, limit: 10 })
      expect(store.resumes.map((resume) => resume.id)).toEqual(['resume-2'])
      expect(store.total).toBe(19)
    })

    it('steps back a page when deleting the last CV on the last page empties it', async () => {
      vi.mocked(api.listResumes).mockResolvedValue(pageOf([resumes[0]], { total: 11, page: 2, limit: 10 }))
      const store = useResumeStore()
      await store.listResumes(2)
      vi.mocked(api.listResumes)
        .mockResolvedValueOnce(pageOf([], { total: 10, page: 2, limit: 10 }))
        .mockResolvedValueOnce(pageOf(resumes, { total: 10, page: 1, limit: 10 }))

      await store.deleteResume('resume-1')

      expect(api.listResumes).toHaveBeenLastCalledWith({ page: 1, limit: 10 })
      expect(store.page).toBe(1)
      expect(store.resumes).toEqual(resumes)
    })

    // .plan/023: CvsListPage's confirmDelete owns the toast now (CvsListPage.test.ts).
    it('propagates the failure untouched and keeps the resume in state', async () => {
      vi.mocked(api.deleteResume).mockRejectedValue(new Error('Forbidden'))
      const store = useResumeStore()
      await store.listResumes()

      await expect(store.deleteResume('resume-1')).rejects.toThrow('Forbidden')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.resumes.map((resume) => resume.id)).toEqual(['resume-1', 'resume-2'])
      expect(store.loadError).toBeNull()
    })
  })
})
