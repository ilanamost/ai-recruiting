import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from '../helpers/page'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../../src/lib/api')>()).UNPAGED_LIMIT,
  listJobs: vi.fn(),
  getJob: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  duplicateJob: vi.fn(),
  listJobResumes: vi.fn(),
  attachResumeToJob: vi.fn(),
  detachResumeFromJob: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import { useJobStore } from '../../src/stores/job'
import * as api from '../../src/lib/api'
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

describe('job store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(api.listJobs).mockReset().mockResolvedValue(pageOf(jobs))
    vi.mocked(api.getJob).mockReset().mockResolvedValue(jobs[0])
    vi.mocked(api.createJob).mockReset().mockResolvedValue(jobs[0])
    vi.mocked(api.updateJob).mockReset()
    vi.mocked(api.deleteJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(api.duplicateJob).mockReset().mockResolvedValue(jobs[0])
    vi.mocked(api.listJobResumes).mockReset().mockResolvedValue([])
    vi.mocked(api.attachResumeToJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(api.detachResumeFromJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(toast.error).mockClear()
  })

  describe('listJobs', () => {
    it('loads the jobs into state and leaves loadError unset', async () => {
      const store = useJobStore()

      await store.listJobs('demo-org')

      expect(api.listJobs).toHaveBeenCalledWith('demo-org', { page: 1, limit: 10 })
      expect(store.jobs).toEqual(jobs)
      expect(store.loadError).toBeNull()
    })

    // .plan/028: the store unwraps the envelope — `jobs` holds only this page's rows, while
    // total/page/limit carry what the pager needs to describe the whole list.
    it('stores the envelope metadata alongside the page of jobs', async () => {
      vi.mocked(api.listJobs).mockResolvedValue(pageOf(jobs, { total: 24, page: 2, limit: 10 }))
      const store = useJobStore()

      await store.listJobs('demo-org', 2)

      expect(store.jobs).toEqual(jobs)
      expect(store.total).toBe(24)
      expect(store.page).toBe(2)
      expect(store.limit).toBe(10)
    })

    it('passes an explicit page and limit through to the API', async () => {
      const store = useJobStore()

      await store.listJobs('demo-org', 3, 500)

      expect(api.listJobs).toHaveBeenCalledWith('demo-org', { page: 3, limit: 500 })
    })

    // The server clamps out-of-range paging (api-contract.yaml) and echoes back the effective
    // values, so the store trusts the response over what it asked for — otherwise the pager
    // would render a page number nothing was actually loaded for.
    it('records the server\'s effective page, not the requested one', async () => {
      vi.mocked(api.listJobs).mockResolvedValue(pageOf([], { total: 24, page: 1, limit: 10 }))
      const store = useJobStore()

      await store.listJobs('demo-org', 0, 99999)

      expect(store.page).toBe(1)
      expect(store.limit).toBe(10)
      expect(store.total).toBe(24)
    })

    // The toast/loadError split from .plan/018 Open Question 2: a failed *list load* leaves the
    // page with nothing to show, so it must stay a persistent blocking message, never a toast.
    it('sets loadError and does NOT toast when the load fails', async () => {
      vi.mocked(api.listJobs).mockRejectedValue(new Error('Network is down'))
      const store = useJobStore()

      await expect(store.listJobs('demo-org')).rejects.toThrow('Network is down')

      expect(store.loadError).toBe('Network is down')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('falls back to "Failed to load jobs" when the rejection is not an Error', async () => {
      vi.mocked(api.listJobs).mockRejectedValue('boom')
      const store = useJobStore()

      await expect(store.listJobs('demo-org')).rejects.toBeTruthy()

      expect(store.loadError).toBe('Failed to load jobs')
    })

    it('clears a previous loadError when a later load succeeds', async () => {
      vi.mocked(api.listJobs).mockRejectedValueOnce(new Error('Network is down'))
      const store = useJobStore()

      await expect(store.listJobs('demo-org')).rejects.toThrow()
      expect(store.loadError).toBe('Network is down')

      await store.listJobs('demo-org')

      expect(store.loadError).toBeNull()
      expect(store.jobs).toEqual(jobs)
    })
  })

  describe('createJob', () => {
    it('returns the created job', async () => {
      const store = useJobStore()

      const created = await store.createJob({ org_id: 'demo-org', title: 'T', description: 'D' })

      expect(api.createJob).toHaveBeenCalledWith({ org_id: 'demo-org', title: 'T', description: 'D' })
      expect(created).toEqual(jobs[0])
      expect(toast.error).not.toHaveBeenCalled()
    })

    // .plan/023 moved the toast to JobForm's onSubmit — see JobForm.test.ts for the message and
    // its 'Failed to create job' fallback. The store's job is to get out of the way.
    it('propagates the failure untouched, without toasting or setting loadError', async () => {
      vi.mocked(api.createJob).mockRejectedValue(new Error('Title is required'))
      const store = useJobStore()

      await expect(store.createJob({ org_id: 'demo-org', title: '', description: 'D' })).rejects.toThrow(
        'Title is required'
      )

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })

  describe('updateJob', () => {
    it('replaces the matching job in state', async () => {
      const updated = { ...jobs[0], title: 'Senior Backend Engineer' }
      vi.mocked(api.updateJob).mockResolvedValue(updated)
      const store = useJobStore()
      await store.listJobs('demo-org')

      await store.updateJob('job-1', { title: 'Senior Backend Engineer' })

      expect(store.jobs[0]).toEqual(updated)
      expect(store.jobs[1]).toEqual(jobs[1])
    })

    // .plan/023: JobsListPage's saveEdit owns the toast now (JobsListPage.test.ts).
    it('propagates the failure untouched and leaves state untouched', async () => {
      vi.mocked(api.updateJob).mockRejectedValue(new Error('Job not found'))
      const store = useJobStore()
      await store.listJobs('demo-org')

      await expect(store.updateJob('job-1', { title: 'x' })).rejects.toThrow('Job not found')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.jobs).toEqual(jobs)
      expect(store.loadError).toBeNull()
    })
  })

  describe('deleteJob', () => {
    // .plan/028 Step 10: the deleted job is no longer filtered out locally. A local filter
    // would leave this page holding 9 of 10 rows while the next page still had one waiting to
    // move up, so the store re-requests the same page and takes whatever the server sends.
    it('re-fetches the current page instead of filtering locally', async () => {
      vi.mocked(api.listJobs).mockResolvedValue(pageOf(jobs, { total: 24, page: 2, limit: 10 }))
      const store = useJobStore()
      await store.listJobs('demo-org', 2)
      const remaining = [jobs[1]]
      vi.mocked(api.listJobs).mockResolvedValue(pageOf(remaining, { total: 23, page: 2, limit: 10 }))

      await store.deleteJob('job-1')

      expect(api.deleteJob).toHaveBeenCalledWith('job-1')
      expect(api.listJobs).toHaveBeenLastCalledWith('demo-org', { page: 2, limit: 10 })
      expect(store.jobs.map((job) => job.id)).toEqual(['job-2'])
      expect(store.total).toBe(23)
    })

    // Deleting the only row on the last page would otherwise strand the list on a page that no
    // longer exists — an empty list with a pager insisting there are 3 pages.
    it('steps back a page when the re-fetch comes back empty', async () => {
      vi.mocked(api.listJobs).mockResolvedValue(pageOf([jobs[0]], { total: 21, page: 3, limit: 10 }))
      const store = useJobStore()
      await store.listJobs('demo-org', 3)
      vi.mocked(api.listJobs)
        .mockResolvedValueOnce(pageOf([], { total: 20, page: 3, limit: 10 }))
        .mockResolvedValueOnce(pageOf(jobs, { total: 20, page: 2, limit: 10 }))

      await store.deleteJob('job-1')

      expect(api.listJobs).toHaveBeenLastCalledWith('demo-org', { page: 2, limit: 10 })
      expect(store.page).toBe(2)
      expect(store.jobs).toEqual(jobs)
    })

    it('does not re-fetch when no page has been loaded yet', async () => {
      const store = useJobStore()

      await store.deleteJob('job-1')

      expect(api.deleteJob).toHaveBeenCalledWith('job-1')
      expect(api.listJobs).not.toHaveBeenCalled()
    })

    // .plan/023: JobsListPage's confirmDelete owns the toast now (JobsListPage.test.ts).
    it('propagates the failure untouched and keeps the job in state', async () => {
      vi.mocked(api.deleteJob).mockRejectedValue(new Error('Forbidden'))
      const store = useJobStore()
      await store.listJobs('demo-org')

      await expect(store.deleteJob('job-1')).rejects.toThrow('Forbidden')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.jobs.map((job) => job.id)).toEqual(['job-1', 'job-2'])
      expect(store.loadError).toBeNull()
    })
  })

  describe('duplicateJob', () => {
    it('returns the duplicate', async () => {
      const store = useJobStore()

      await expect(store.duplicateJob('job-1')).resolves.toEqual(jobs[0])
      expect(api.duplicateJob).toHaveBeenCalledWith('job-1')
    })

    // .plan/023: JobsListPage's duplicate owns the toast now (JobsListPage.test.ts).
    it('propagates the failure untouched, without toasting', async () => {
      vi.mocked(api.duplicateJob).mockRejectedValue(new Error('Job not found'))
      const store = useJobStore()

      await expect(store.duplicateJob('job-1')).rejects.toThrow('Job not found')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })

  describe('attachResumeToJob / detachResumeFromJob', () => {
    it('attaches and detaches without toasting on success', async () => {
      const store = useJobStore()

      await store.attachResumeToJob('job-1', 'resume-1')
      await store.detachResumeFromJob('job-1', 'resume-1')

      expect(api.attachResumeToJob).toHaveBeenCalledWith('job-1', 'resume-1')
      expect(api.detachResumeFromJob).toHaveBeenCalledWith('job-1', 'resume-1')
      expect(toast.error).not.toHaveBeenCalled()
    })

    // .plan/023: JobCvsModal's attach/confirmDetach own these toasts now (JobCvsModal.test.ts).
    it('propagates an attach failure untouched, without toasting', async () => {
      vi.mocked(api.attachResumeToJob).mockRejectedValue(new Error('Already attached'))
      const store = useJobStore()

      await expect(store.attachResumeToJob('job-1', 'resume-1')).rejects.toThrow('Already attached')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })

    it('propagates a detach failure untouched, without toasting', async () => {
      vi.mocked(api.detachResumeFromJob).mockRejectedValue(new Error('Not attached'))
      const store = useJobStore()

      await expect(store.detachResumeFromJob('job-1', 'resume-1')).rejects.toThrow('Not attached')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })

  describe('reads that neither toast nor set loadError', () => {
    it('re-throws a getJob failure untouched', async () => {
      vi.mocked(api.getJob).mockRejectedValue(new Error('Job not found'))
      const store = useJobStore()

      await expect(store.getJob('job-1')).rejects.toThrow('Job not found')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })

    // JobCvsModal renders its own inline "Failed to load CVs for this job" message for this,
    // so the store neither toasts nor claims the page-level loadError.
    it('re-throws a listJobResumes failure untouched', async () => {
      vi.mocked(api.listJobResumes).mockRejectedValue(new Error('Job not found'))
      const store = useJobStore()

      await expect(store.listJobResumes('job-1')).rejects.toThrow('Job not found')

      expect(toast.error).not.toHaveBeenCalled()
      expect(store.loadError).toBeNull()
    })
  })
})
