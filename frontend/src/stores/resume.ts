import { ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../lib/api'
import { errorMessage } from './error'
import type { Resume } from '../types'

// Owns the resume collection and every resume-related API call (.plan/018). Same split as the
// job store: a mutation failure propagates to the calling component, which raises the toast
// (.plan/023), while the list load sets `loadError` so CvsListPage can keep rendering its
// blocking "couldn't load" card instead of a toast.
export const useResumeStore = defineStore('resume', () => {
  const resumes = ref<Resume[]>([])
  const loadError = ref<string | null>(null)
  // Paging state from the last successful load (.plan/028), same shape as the job store:
  // `total` counts every CV, not this page's rows, and `page`/`limit` hold the server's
  // effective (post-clamp) values so a re-fetch replays exactly what was last requested.
  const total = ref(0)
  const page = ref(1)
  const limit = ref(10)

  // `silent` skips the shared `loadError` write — JobCvsModal calls this to refresh the
  // attach-dropdown list while it's open, and already renders its own local failure message;
  // without `silent` that background refresh would set the same `loadError` CvsListPage/
  // JobsListPage render as a page-wide blocking card, collapsing the page behind the modal on
  // any transient failure (QA finding, .plan/018 — `closeManageCvs` doesn't reload, so the
  // page stayed blocked after the modal closed, too).
  async function listResumes(pageNumber = 1, pageSize = 10, options?: { silent?: boolean }) {
    if (!options?.silent) {
      loadError.value = null
    }
    try {
      const result = await api.listResumes({ page: pageNumber, limit: pageSize })
      resumes.value = result.items
      total.value = result.total
      page.value = result.page
      limit.value = result.limit
      return resumes.value
    } catch (err) {
      if (!options?.silent) {
        loadError.value = errorMessage(err, 'Failed to load CVs')
      }
      throw err
    }
  }

  // Replays the last load's page/limit after a mutation that changes the row count. Stepping
  // back a page when the current one comes back empty keeps a delete from stranding the list on
  // a page that no longer exists.
  async function reloadPage() {
    await listResumes(page.value, limit.value)
    if (resumes.value.length === 0 && page.value > 1) {
      await listResumes(page.value - 1, limit.value)
    }
  }

  // Re-fetches rather than prepending the new CV locally (.plan/028 Step 11): with server-side
  // paging, a local prepend would push the page to `limit + 1` rows and show a CV that belongs
  // on whatever page the server's ordering actually puts it on.
  async function uploadResume(input: api.UploadResumeInput) {
    const resume = await api.uploadResume(input)
    await reloadPage()
    return resume
  }

  async function updateResume(id: string, input: api.UpdateResumeInput) {
    const updated = await api.updateResume(id, input)
    resumes.value = resumes.value.map((existing) => (existing.id === updated.id ? updated : existing))
    return updated
  }

  async function replaceResumeFile(id: string, file: File) {
    const updated = await api.replaceResumeFile(id, file)
    resumes.value = resumes.value.map((existing) => (existing.id === updated.id ? updated : existing))
    return updated
  }

  // Same reason as uploadResume: a local filter would leave the page one row short of `limit`
  // while the next page still holds a CV that should move up into the gap.
  async function deleteResume(id: string) {
    await api.deleteResume(id)
    await reloadPage()
  }

  return {
    resumes,
    loadError,
    total,
    page,
    limit,
    listResumes,
    reloadPage,
    uploadResume,
    updateResume,
    replaceResumeFile,
    deleteResume
  }
})
