import { ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../lib/api'
import { errorMessage } from './error'
import type { Job, JobResume } from '../types'

// Owns the job collection and every job-related API call (.plan/018). Mutations no longer
// notify anyone themselves (.plan/023): a failure propagates to the caller untouched, and the
// calling component raises the toast, right next to the local success-path state that failure
// concerns (an edit form staying open, a list left as it was). The list load is the exception:
// it sets `loadError` instead, because JobsListPage renders a blocking "couldn't load" card
// rather than a toast for that case.
export const useJobStore = defineStore('job', () => {
  const jobs = ref<Job[]>([])
  const loadError = ref<string | null>(null)
  // Paging state from the last successful load (.plan/028). `total` is the whole org's job
  // count, not this page's length, so a pager can render "Page X of Y" from it. `page`/`limit`
  // hold the server's effective (post-clamp) values, and are what a re-fetch replays.
  const total = ref(0)
  const page = ref(1)
  const limit = ref(10)
  // The org the current page was loaded for, so a post-mutation re-fetch can replay the same
  // request without the caller having to hand it back.
  const loadedOrgId = ref<string | null>(null)

  async function listJobs(orgId: string, pageNumber = 1, pageSize = 10) {
    loadError.value = null
    try {
      const result = await api.listJobs(orgId, { page: pageNumber, limit: pageSize })
      jobs.value = result.items
      total.value = result.total
      page.value = result.page
      limit.value = result.limit
      loadedOrgId.value = orgId
      return jobs.value
    } catch (err) {
      loadError.value = errorMessage(err, 'Failed to load jobs')
      throw err
    }
  }

  // Replays the last load's org/page/limit. Used after a mutation that changes how many rows
  // exist, where patching `jobs.value` locally would misrepresent the page (see deleteJob).
  // Deleting the only row on the last page empties that page, so it steps back one page rather
  // than leaving the list stranded on a page that no longer exists.
  async function reloadPage() {
    if (loadedOrgId.value === null) {
      return
    }
    await listJobs(loadedOrgId.value, page.value, limit.value)
    if (jobs.value.length === 0 && page.value > 1) {
      await listJobs(loadedOrgId.value, page.value - 1, limit.value)
    }
  }

  // Single-job read. Not a list load, so it does not set `loadError` — the caller decides how
  // to surface it.
  async function getJob(id: string) {
    return api.getJob(id)
  }

  async function createJob(input: api.CreateJobInput) {
    return api.createJob(input)
  }

  async function updateJob(id: string, input: api.UpdateJobInput) {
    const updated = await api.updateJob(id, input)
    jobs.value = jobs.value.map((existing) => (existing.id === updated.id ? updated : existing))
    return updated
  }

  // Re-fetches instead of filtering the deleted job out locally (.plan/028 Step 10): with
  // server-side paging, a local filter would leave the current page holding `limit - 1` rows
  // even though the next page has one waiting to move up into the gap.
  async function deleteJob(id: string) {
    await api.deleteJob(id)
    await reloadPage()
  }

  async function duplicateJob(id: string) {
    return api.duplicateJob(id)
  }

  // Job-scoped attachment list. JobCvsModal owns the result as local state (it is per-open-job,
  // not app-wide), and renders its own "couldn't load" message, so this only re-throws.
  async function listJobResumes(jobId: string): Promise<JobResume[]> {
    return api.listJobResumes(jobId)
  }

  async function attachResumeToJob(jobId: string, resumeId: string) {
    await api.attachResumeToJob(jobId, resumeId)
  }

  async function detachResumeFromJob(jobId: string, resumeId: string) {
    await api.detachResumeFromJob(jobId, resumeId)
  }

  return {
    jobs,
    loadError,
    total,
    page,
    limit,
    listJobs,
    reloadPage,
    getJob,
    createJob,
    updateJob,
    deleteJob,
    duplicateJob,
    listJobResumes,
    attachResumeToJob,
    detachResumeFromJob
  }
})
