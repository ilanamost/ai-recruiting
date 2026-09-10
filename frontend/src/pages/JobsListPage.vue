<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Briefcase, ChevronDown, Copy, Inbox, Loader, MapPin, Pencil, Search, Trash2, Users, X } from '@lucide/vue'
import { cardEnterDelay } from '../lib/animation'
import JobCvsModal from '../components/JobCvsModal.vue'
import Pager from '../components/Pager.vue'
import { UNPAGED_LIMIT } from '../lib/api'
import { useAuth } from '../lib/auth'
import { TOAST } from '../lib/toastMessages'
import { useJobStore } from '../stores/job'
import { useResumeStore } from '../stores/resume'
import type { Job } from '../types'

const ORG_ID = 'demo-org'

const { user } = useAuth()
// Per the plan's Permission Matrix (corrected 2026-08-04): job create/edit/delete/duplicate
// stay Admin/Recruiter only. Candidates can now view CV counts and open "Manage CVs" to
// attach/detach their own CVs (JobCvsModal gates attach/detach itself), so those are no longer
// gated behind this flag.
const canManageJobRecord = computed(() => user.value?.role === 'admin' || user.value?.role === 'recruiter')

// Server data lives in the stores (.plan/018); the page reads it and keeps only its own UI
// state (edit/delete toggles, search filters) local.
const jobStore = useJobStore()
const resumeStore = useResumeStore()

const jobs = computed(() => jobStore.jobs)
const resumes = computed(() => resumeStore.resumes)
const loading = ref(true)
// The blocking "couldn't load" card, not a toast — whichever list failed supplies the message.
const error = computed(() => jobStore.loadError ?? resumeStore.loadError)

const editingId = ref<string | null>(null)
const editTitle = ref('')
const editLocation = ref('')
const editDescription = ref('')
const savingEdit = ref(false)

const deletingId = ref<string | null>(null)
const deleteBusy = ref(false)

const duplicatingId = ref<string | null>(null)

const managingJob = ref<Job | null>(null)

// Read-only preview of a single job (.plan/020). The card keeps showing the 140-character
// snippet; this holds the job whose full description is on screen in the dialog.
const previewJob = ref<Job | null>(null)

function cvCount(jobId: string) {
  return resumes.value
    .filter((resume) => resume.jobs.some((job) => job.id === jobId))
    .filter((resume) => user.value?.role !== 'candidate' || resume.owner_user_id === user.value?.id)
    .length
}

// Search/filter state, all applied client-side over the already-loaded `jobs` ref — see
// .plan/013-2026-08-10-job-search-filter.md Open Question 2 for why there are no server-side
// query params.
const searchTitle = ref('')
const searchLocation = ref('')
// A single job-creation-date filter (exact local calendar day), not a range — the reviewer
// found the from/to pair redundant for a list this size (plan addendum, 2026-08-10).
const filterDate = ref('')
const appliedFilter = ref<'all' | 'applied' | 'not_applied'>('all')

// Only a Candidate owns CVs in the personal sense "applied to a job" needs, so the
// applied/not-applied control is Candidate-only (plan Open Question 3).
const canFilterByApplied = computed(() => user.value?.role === 'candidate')

// Server-side pagination (.plan/028). Open Question 1's resolution: the search/filter above
// stays client-side over whatever `jobs.value` holds, so while a filter is active the page
// requests an effectively-unpaginated list (UNPAGED_LIMIT, not `pageSize`) and hides the Pager
// — otherwise the filter would silently only search the current page. Clearing the filter
// returns to normal paging at whatever size the Pager's select last chose.
const page = ref(1)
const pageSize = ref(10)
// Fixed choices rather than free text: every value here is comfortably under the server's
// 500-item cap (UNPAGED_LIMIT), so a selection here is never itself clamped.
const PAGE_SIZE_OPTIONS = [2, 10, 25, 50, 100] as const
const total = computed(() => jobStore.total)
const limit = computed(() => jobStore.limit)

const hasActiveFilter = computed(
  () =>
    searchTitle.value.trim() !== '' ||
    searchLocation.value.trim() !== '' ||
    filterDate.value !== '' ||
    appliedFilter.value !== 'all'
)

// All filters combine with AND. An empty search term matches every job, including one whose
// location is null; a non-empty location term never matches a job with no location.
const filteredJobs = computed(() =>
  jobs.value.filter((job) => {
    const titleTerm = searchTitle.value.trim().toLowerCase()
    if (titleTerm && !job.title.toLowerCase().includes(titleTerm)) {
      return false
    }

    const locationTerm = searchLocation.value.trim().toLowerCase()
    if (locationTerm && !(job.location ?? '').toLowerCase().includes(locationTerm)) {
      return false
    }

    // Compare local calendar dates, matching what the card's "Created …" line displays
    // (formatDate, also local) — a UTC slice() here would disagree with the card near
    // midnight in timezones ahead of/behind UTC. An unset date means "no constraint".
    if (filterDate.value && localDateKey(job.created_at) !== filterDate.value) {
      return false
    }

    if (canFilterByApplied.value && appliedFilter.value !== 'all') {
      // cvCount is already ownership-scoped for a Candidate (.plan/011), so "> 0" means
      // "this Candidate has at least one of their own CVs attached to this job".
      const hasApplied = cvCount(job.id) > 0
      if (appliedFilter.value === 'applied' ? !hasApplied : hasApplied) {
        return false
      }
    }

    return true
  })
)

function descriptionSnippet(description: string) {
  return description.length > 140 ? `${description.slice(0, 140)}…` : description
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// YYYY-MM-DD in local time, matching both formatDate's local calendar day and the
// YYYY-MM-DD value <input type="date"> produces — used for the creation-date filter.
function localDateKey(value: string) {
  return new Date(value).toLocaleDateString('en-CA')
}

// `background` skips the blocking "Loading jobs…" card. Turning a filter on or off re-requests
// the list at a different page size, and swapping the whole list out for a spinner on the first
// character typed would be a worse experience than letting the already-loaded jobs stay on
// screen (filtered client-side) until the wider response lands.
async function load(options?: { background?: boolean }) {
  if (!options?.background) {
    loading.value = true
  }
  try {
    await Promise.all([
      hasActiveFilter.value
        ? jobStore.listJobs(ORG_ID, 1, UNPAGED_LIMIT)
        : jobStore.listJobs(ORG_ID, page.value, pageSize.value),
      // The CV counts on these cards cross-reference every resume's attached jobs, not one
      // page of CVs, so this list is deliberately requested unpaginated — the CVs page is what
      // paginates resumes.
      resumeStore.listResumes(1, UNPAGED_LIMIT)
    ])
    // Follow whatever page the store actually loaded (it steps back off an emptied last page).
    page.value = jobStore.page
  } catch {
    // Each store records its own list failure in `loadError`, which `error` renders — a failed
    // list load stays a blocking card here and never becomes a toast.
  } finally {
    if (!options?.background) {
      loading.value = false
    }
  }
}

onMounted(() => load())

// Switching a filter on or off changes which request shape is right (unpaginated vs. paged),
// so it re-loads. Typing inside an already-active filter does not — `hasActiveFilter` only
// flips on the empty/non-empty boundary, and the filtering itself stays client-side.
watch(hasActiveFilter, () => {
  page.value = 1
  void load({ background: true })
})

async function goToPage(next: number) {
  page.value = next
  await load()
}

// Same reasoning as CvsListPage: a limit change invalidates the current page number, so this
// resets to page 1. The select this handles is itself hidden while a filter is active (see the
// pagination comment above `pageSize`), so there is no unfiltered/filtered ambiguity to resolve
// here — this only ever fires for the normal paged request.
async function onPageSizeChange(event: Event) {
  pageSize.value = Number((event.target as HTMLSelectElement).value)
  page.value = 1
  await load()
}

function startEdit(job: Job) {
  cancelDelete()
  editingId.value = job.id
  editTitle.value = job.title
  editLocation.value = job.location ?? ''
  editDescription.value = job.description
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(job: Job) {
  if (!editTitle.value.trim() || !editDescription.value.trim()) {
    toast.error(TOAST.error.jobValidationRequired)
    return
  }
  savingEdit.value = true
  try {
    await jobStore.updateJob(job.id, {
      title: editTitle.value,
      description: editDescription.value,
      location: editLocation.value
    })
    toast.success(TOAST.success.jobUpdated)
    editingId.value = null
  } catch (err) {
    // .plan/023: the store lets the rejection through, so the page reports it and the edit
    // form stays open.
    toast.error(err instanceof Error ? err.message : TOAST.error.jobUpdateFailed)
  } finally {
    savingEdit.value = false
  }
}

function startDelete(job: Job) {
  cancelEdit()
  deletingId.value = job.id
}

function cancelDelete() {
  deletingId.value = null
}

async function confirmDelete(job: Job) {
  deleteBusy.value = true
  try {
    await jobStore.deleteJob(job.id)
    // Page-specific bookkeeping, not something the job store can do: the CV counts on this
    // page cross-reference each resume's attached jobs, so the deleted job has to drop out of
    // them too.
    resumeStore.resumes = resumeStore.resumes.map((resume) => ({
      ...resume,
      jobs: resume.jobs.filter((attachedJob) => attachedJob.id !== job.id)
    }))
    // The store re-fetched the current page rather than filtering locally (.plan/028), and may
    // have stepped back a page if this was the last job on the last one.
    page.value = jobStore.page
    toast.success(TOAST.success.jobDeleted)
    deletingId.value = null
  } catch (err) {
    // .plan/023: the confirm step stays open, and the page raises the toast itself.
    toast.error(err instanceof Error ? err.message : TOAST.error.jobDeleteFailed)
  } finally {
    deleteBusy.value = false
  }
}

async function duplicate(job: Job) {
  duplicatingId.value = job.id
  try {
    await jobStore.duplicateJob(job.id)
    toast.success(TOAST.success.jobDuplicated)
    await load()
  } catch (err) {
    // .plan/023: the list is left as it was, and the page raises the toast itself.
    toast.error(err instanceof Error ? err.message : TOAST.error.jobDuplicateFailed)
  } finally {
    duplicatingId.value = null
  }
}

function openPreview(job: Job) {
  previewJob.value = job
}

function closePreview() {
  previewJob.value = null
}

function openManageCvs(job: Job) {
  managingJob.value = job
}

function closeManageCvs() {
  managingJob.value = null
}

async function onCvsChanged() {
  await load()
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <h1 class="text-lg font-semibold">Jobs</h1>

    <!-- Row 1: the title search, full width, with its icon inside the input on the left.
         `group` + `group-focus-within:` links the icon's color to the input's focus state, so
         the icon turns primary at the same moment base.css turns the border primary. -->
    <template v-if="!loading && !error && jobs.length > 0">
      <div class="group relative w-full">
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted transition-colors group-focus-within:text-primary"
        />
        <!-- pl-9! (not pl-9): base.css's shared input[type='text'] padding rule is unlayered
             plain CSS, which beats a same-or-lower-specificity Tailwind utility regardless of
             layer order — without !important the icon sat under the placeholder text. -->
        <input
          v-model="searchTitle"
          type="text"
          class="w-full pl-9!"
          placeholder="Search by title"
          aria-label="Search jobs by title"
        />
      </div>

      <!-- Row 2 sits on the page background token rather than `.card`'s surface, so it reads
           as a filter strip distinct from the job cards below it — no new token needed. -->
      <div class="flex flex-wrap items-center gap-3 rounded-md bg-bg p-3">
        <label>
          <span>Location</span>
          <input v-model="searchLocation" type="text" placeholder="Search by location" />
        </label>
        <label>
          <span>Job creation date</span>
          <input v-model="filterDate" type="date" aria-label="Job creation date" />
        </label>
        <label v-if="canFilterByApplied">
          <span>Applied</span>
          <div class="select-wrap">
            <select v-model="appliedFilter">
              <option value="all">All</option>
              <option value="applied">Applied</option>
              <option value="not_applied">Not applied</option>
            </select>
            <ChevronDown class="select-arrow size-4" />
          </div>
        </label>
        <!-- Hidden while a filter is active, same as the Pager below (Open Question 1): the
             list is unpaginated then, so a page-size choice has nothing to act on until the
             filter clears. -->
        <label v-if="!hasActiveFilter">
          <span>Rows per page</span>
          <div class="select-wrap">
            <select :value="pageSize" aria-label="Rows per page" @change="onPageSizeChange">
              <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
            </select>
            <ChevronDown class="select-arrow size-4" />
          </div>
        </label>
      </div>
    </template>

    <div v-if="loading" class="card flex items-center gap-2 text-fg-muted">
      <Loader class="size-4 animate-spin" />
      <span>Loading jobs…</span>
    </div>

    <!-- fade-in on the empty/error cards (.plan/014 item 5): the same plain fade the loaded
         cards use, so these don't pop in instantly while everything else animates. No
         stagger — only ever one of them is on screen. -->
    <div v-else-if="error" class="card fade-in flex items-center gap-2 text-danger">
      <span>{{ error }}</span>
    </div>

    <div v-else-if="jobs.length === 0" class="card fade-in flex flex-col items-center gap-3 py-12 text-center">
      <span class="dropzone-icon">
        <Inbox class="size-5" />
      </span>
      <p class="font-semibold">No jobs yet</p>
      <p class="max-w-sm text-sm text-fg-muted">Create a job to start matching CVs against it.</p>
      <RouterLink v-if="canManageJobRecord" to="/jobs/new" class="btn btn-primary mt-2">Create a job</RouterLink>
    </div>

    <!-- Distinct from "No jobs yet": jobs exist, the filters just excluded them all, so a
         "Create a job" CTA would be misleading here. -->
    <div
      v-else-if="filteredJobs.length === 0"
      class="card fade-in flex flex-col items-center gap-3 py-12 text-center"
    >
      <span class="dropzone-icon">
        <Inbox class="size-5" />
      </span>
      <p class="font-semibold">No jobs match your filters</p>
      <p class="max-w-sm text-sm text-fg-muted">Try a different title, location, or creation date.</p>
    </div>

    <ul v-else class="flex flex-col gap-3">
      <!-- :style for the stagger delay is a data-driven value, the same category as
           MatchResult's `:style="{ width: ... }"` — not the static hand-authored styling
           .claude/rules/ui-and-styling.md rules out. -->
      <li
        v-for="(job, index) in filteredJobs"
        :key="job.id"
        class="card card-enter flex flex-col gap-3"
        :style="{ animationDelay: cardEnterDelay(index) }"
      >
        <template v-if="editingId === job.id">
          <label>
            <span>Title</span>
            <input v-model="editTitle" type="text" />
          </label>
          <label>
            <span>Location (optional)</span>
            <input v-model="editLocation" type="text" placeholder="Berlin, Remote" />
          </label>
          <label>
            <span>Description</span>
            <textarea v-model="editDescription" rows="4" />
          </label>
          <div class="flex gap-2">
            <button type="button" class="btn btn-primary" :disabled="savingEdit" @click="saveEdit(job)">
              {{ savingEdit ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="btn btn-ghost" @click="cancelEdit">Cancel</button>
          </div>
        </template>

        <template v-else>
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1">
              <!-- Title and description both open the preview — the card's other click targets
                   (Edit/Duplicate/Manage CVs/Delete) stay untouched, and .stop keeps these
                   clicks from bubbling into any card-level handling (.plan/020 Q1). -->
              <p class="cursor-pointer font-semibold" @click.stop="openPreview(job)">{{ job.title }}</p>
              <p
                class="cursor-pointer text-sm text-fg-muted"
                @click.stop="openPreview(job)"
              >
                {{ descriptionSnippet(job.description) }}
              </p>
            </div>
            <span class="list-badge">
              <Briefcase class="size-3.5" />
              {{ cvCount(job.id) }} CV{{ cvCount(job.id) === 1 ? '' : 's' }}
            </span>
          </div>
          <div v-if="job.location" class="flex flex-wrap items-center gap-1.5">
            <span class="list-badge">
              <MapPin class="size-3.5" />
              {{ job.location }}
            </span>
          </div>

          <p class="text-xs text-fg-muted">Created {{ formatDate(job.created_at) }}</p>

          <div v-if="canManageJobRecord && deletingId === job.id" class="list-confirm">
            <p>
              This will detach {{ cvCount(job.id) }} CV{{ cvCount(job.id) === 1 ? '' : 's' }} from this job and
              delete their match results for it.
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-danger"
                :disabled="deleteBusy"
                @click="confirmDelete(job)"
              >
                {{ deleteBusy ? 'Deleting…' : 'Confirm delete' }}
              </button>
              <button type="button" class="btn btn-ghost" @click="cancelDelete">Cancel</button>
            </div>
          </div>
          <div v-else class="flex flex-wrap gap-2">
            <template v-if="canManageJobRecord">
              <button type="button" class="btn btn-ghost" @click="startEdit(job)">
                <Pencil class="size-4" />
                Edit
              </button>
              <button type="button" class="btn btn-ghost" @click="duplicate(job)" :disabled="duplicatingId === job.id">
                <Copy class="size-4" />
                {{ duplicatingId === job.id ? 'Duplicating…' : 'Duplicate' }}
              </button>
            </template>
            <button type="button" class="btn btn-ghost" @click="openManageCvs(job)">
              <Users class="size-4" />
              Manage CVs
            </button>
            <button v-if="canManageJobRecord" type="button" class="btn btn-ghost" @click="startDelete(job)">
              <Trash2 class="size-4" />
              Delete
            </button>
          </div>
        </template>
      </li>
    </ul>

    <!-- Hidden while a filter is active (Open Question 1): the list is unpaginated then, so a
         pager would be describing a page count that isn't what the user is looking at. -->
    <Pager
      v-if="!loading && !error && !hasActiveFilter && total > 0"
      :page="page"
      :total="total"
      :limit="limit"
      @update:page="goToPage"
    />

    <!-- Read-only job preview (.plan/020), following JobCvsModal's preview-dialog pattern:
         backdrop, centered card panel, X close button, backdrop-click-to-close via .self. -->
    <div
      v-if="previewJob"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="closePreview"
    >
      <div class="card flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-hidden">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-lg font-semibold">{{ previewJob.title }}</h2>
          <button type="button" class="btn btn-ghost" aria-label="Close preview" @click="closePreview">
            <X class="size-4" />
          </button>
        </div>

        <div v-if="previewJob.location" class="flex flex-wrap items-center gap-1.5">
          <span class="list-badge">
            <MapPin class="size-3.5" />
            {{ previewJob.location }}
          </span>
        </div>

        <!-- whitespace-pre-wrap so the line breaks an author typed into the description
             survive, the same way the CV text preview keeps its own formatting. -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <p class="text-sm whitespace-pre-wrap text-fg">{{ previewJob.description }}</p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-fg-muted">Created {{ formatDate(previewJob.created_at) }}</p>
          <span class="list-badge">
            <Briefcase class="size-3.5" />
            {{ cvCount(previewJob.id) }} CV{{ cvCount(previewJob.id) === 1 ? '' : 's' }}
          </span>
        </div>
      </div>
    </div>

    <JobCvsModal v-if="managingJob" :job="managingJob" @close="closeManageCvs" @changed="onCvsChanged" />
  </section>
</template>
