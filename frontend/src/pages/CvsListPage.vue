<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Briefcase, ChevronDown, FileText, Inbox, Loader, Pencil, RefreshCw, Trash2, Upload } from '@lucide/vue'
import { cardEnterDelay } from '../lib/animation'
import Pager from '../components/Pager.vue'
import { useAuth } from '../lib/auth'
import { TOAST } from '../lib/toastMessages'
import { useResumeStore } from '../stores/resume'
import type { Resume } from '../types'

const { user } = useAuth()
// Per .plan/009-2026-08-08-candidate-cv-ownership-scoping.md: Admin may edit/delete any CV.
// Candidate may edit/delete only CVs they own (resume.owner_user_id === their own user id).
// Recruiter stays fully read-only. Upload stays available to any Candidate regardless of
// ownership of existing CVs — a freshly uploaded CV always becomes their own.
const canUploadCvs = computed(() => user.value?.role === 'admin' || user.value?.role === 'candidate')

function canEditCv(resume: Resume) {
  if (user.value?.role === 'admin') {
    return true
  }
  return user.value?.role === 'candidate' && resume.owner_user_id === user.value?.id
}

function canDeleteCv(resume: Resume) {
  if (user.value?.role === 'admin') {
    return true
  }
  return user.value?.role === 'candidate' && resume.owner_user_id === user.value?.id
}

// Server data lives in the resume store (.plan/018); the page keeps only its own UI state
// (edit/delete toggles, the upload form's inputs) local.
const resumeStore = useResumeStore()

// Defense in depth per .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md. The real
// boundary is the backend: GET /api/resume narrows `items` and `total` to the caller's own CVs
// for a Candidate, and GET /api/resume/:id(/file) 403s on a CV they don't own. This filter only
// guarantees the rendered list can never show a non-owned row if the store or the API ever
// returned a broader set — the same belt-and-suspenders pattern JobCvsModal uses for match
// visibility (.plan/010). Admin and Recruiter keep the unfiltered list.
const resumes = computed(() => {
  const items = resumeStore.resumes
  return user.value?.role === 'candidate'
    ? items.filter((resume) => resume.owner_user_id === user.value?.id)
    : items
})
const loading = ref(true)

// Server-side pagination (.plan/028). The page number and page size are the page's own UI
// state; the store holds `total`/`limit` from the last response, which is what Pager renders
// "of Y" from. A store-driven correction (deleting the last CV on the last page steps back a
// page) flows back here, so this stays in sync with what was actually loaded.
const page = ref(1)
const pageSize = ref(10)
// Fixed choices rather than free text: every value here is comfortably under the server's
// 500-item cap (lib/api.ts's UNPAGED_LIMIT), so a selection here is never itself clamped.
const PAGE_SIZE_OPTIONS = [2, 10, 25, 50, 100] as const
const total = computed(() => resumeStore.total)
const limit = computed(() => resumeStore.limit)
// The blocking "couldn't load" card, not a toast.
const error = computed(() => resumeStore.loadError)

const editingId = ref<string | null>(null)
const editName = ref('')
const editEmail = ref('')
const savingEdit = ref(false)

const deletingId = ref<string | null>(null)
const deleteBusy = ref(false)

const replaceFileInput = ref<HTMLInputElement | null>(null)
const replaceTargetId = ref<string | null>(null)
const replacingId = ref<string | null>(null)

const showUpload = ref(false)
const uploadName = ref('')
const uploadEmail = ref('')
const uploadFile = ref<File | null>(null)
const uploading = ref(false)

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function load() {
  loading.value = true
  try {
    await resumeStore.listResumes(page.value, pageSize.value)
    // The store may have stepped back a page (an empty page after a delete), so follow it
    // rather than leaving the Pager pointing at a page nothing was loaded for.
    page.value = resumeStore.page
  } catch {
    // The store records the list failure in `loadError`, which `error` renders as a blocking
    // card — a failed list load never becomes a toast.
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function goToPage(next: number) {
  page.value = next
  await load()
}

// A limit change invalidates the current page's meaning (its row count is about to change), so
// this resets to page 1 rather than trying to keep the old page number.
async function onPageSizeChange(event: Event) {
  pageSize.value = Number((event.target as HTMLSelectElement).value)
  page.value = 1
  await load()
}

function startEdit(resume: Resume) {
  cancelDelete()
  editingId.value = resume.id
  editName.value = resume.candidate_name
  editEmail.value = resume.candidate_email
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(resume: Resume) {
  if (!editName.value.trim() || !editEmail.value.trim()) {
    toast.error(TOAST.error.resumeValidationRequired)
    return
  }
  savingEdit.value = true
  try {
    await resumeStore.updateResume(resume.id, { name: editName.value, email: editEmail.value })
    toast.success(TOAST.success.resumeUpdated)
    editingId.value = null
  } catch (err) {
    // .plan/023: the store lets the rejection through, so the page reports it and the edit
    // form stays open.
    toast.error(err instanceof Error ? err.message : TOAST.error.resumeUpdateFailed)
  } finally {
    savingEdit.value = false
  }
}

function startDelete(resume: Resume) {
  cancelEdit()
  deletingId.value = resume.id
}

function cancelDelete() {
  deletingId.value = null
}

async function confirmDelete(resume: Resume) {
  deleteBusy.value = true
  try {
    await resumeStore.deleteResume(resume.id)
    // The store re-fetched the current page (and may have stepped back one), so follow it.
    page.value = resumeStore.page
    toast.success(TOAST.success.resumeDeleted)
    deletingId.value = null
  } catch (err) {
    // .plan/023: the confirm step stays open, and the page raises the toast itself.
    toast.error(err instanceof Error ? err.message : TOAST.error.resumeDeleteFailed)
  } finally {
    deleteBusy.value = false
  }
}

function triggerReplace(resume: Resume) {
  replaceTargetId.value = resume.id
  replaceFileInput.value?.click()
}

async function onReplaceFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  target.value = ''
  const targetId = replaceTargetId.value
  replaceTargetId.value = null
  if (!file || !targetId) {
    return
  }
  replacingId.value = targetId
  try {
    await resumeStore.replaceResumeFile(targetId, file)
    toast.success(TOAST.success.resumeFileReplaced)
  } catch (err) {
    // .plan/023: the existing file stays in place, and the page raises the toast itself.
    toast.error(err instanceof Error ? err.message : TOAST.error.resumeFileReplaceFailed)
  } finally {
    replacingId.value = null
  }
}

function onUploadFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  uploadFile.value = target.files?.[0] ?? null
}

function cancelUpload() {
  showUpload.value = false
  uploadName.value = ''
  uploadEmail.value = ''
  uploadFile.value = null
}

async function submitUpload() {
  if (!uploadName.value.trim() || !uploadEmail.value.trim()) {
    toast.error(TOAST.error.resumeValidationRequired)
    return
  }
  if (!uploadFile.value) {
    toast.error(TOAST.error.resumeFileRequired)
    return
  }
  uploading.value = true
  try {
    await resumeStore.uploadResume({ name: uploadName.value, email: uploadEmail.value, file: uploadFile.value })
    page.value = resumeStore.page
    toast.success(TOAST.success.resumeUploaded)
    cancelUpload()
  } catch (err) {
    // .plan/023: the page raises the toast itself, and the upload form stays open with its
    // values, so the candidate can retry without re-entering everything.
    toast.error(err instanceof Error ? err.message : TOAST.error.resumeUploadFailed)
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-lg font-semibold">CVs</h1>
      <button v-if="canUploadCvs" type="button" class="btn btn-ghost" @click="showUpload = !showUpload">
        <Upload class="size-4" />
        {{ showUpload ? 'Cancel upload' : 'Upload CV' }}
      </button>
    </div>

    <!-- Same filter-strip treatment as JobsListPage's row 2 (bg-bg + rounded-md + p-3) — this
         page has no search/filter controls of its own, but the rows-per-page control still
         belongs grouped with "other filters and selects" rather than bolted onto the Pager. -->
    <div v-if="!loading && !error && resumes.length > 0" class="flex flex-wrap items-center gap-3 rounded-md bg-bg p-3">
      <label>
        <span>Rows per page</span>
        <div class="select-wrap">
          <select :value="pageSize" aria-label="Rows per page" @change="onPageSizeChange">
            <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
          </select>
          <ChevronDown class="select-arrow size-4" />
        </div>
      </label>
    </div>

    <form v-if="showUpload && canUploadCvs" class="card flex flex-col gap-4" @submit.prevent="submitUpload">
        <p class="text-sm text-fg-muted">Upload a CV without attaching it to a job yet. Attach it later from a job's Manage CVs popup.</p>
        <label>
          <span>Name</span>
          <input v-model="uploadName" type="text" placeholder="Jane Doe" />
        </label>
        <label>
          <span>Email</span>
          <input v-model="uploadEmail" type="email" placeholder="jane@example.com" />
        </label>
        <label>
          <span>CV (PDF)</span>
          <input type="file" accept=".pdf" @change="onUploadFileChange" />
        </label>
        <button type="submit" class="btn btn-primary self-start" :disabled="uploading">
          {{ uploading ? 'Uploading…' : 'Upload CV' }}
        </button>
      </form>

      <input ref="replaceFileInput" type="file" accept=".pdf" class="hidden" @change="onReplaceFileChange" />

      <div v-if="loading" class="card flex items-center gap-2 text-fg-muted">
        <Loader class="size-4 animate-spin" />
        <span>Loading CVs…</span>
      </div>

      <!-- fade-in on the empty/error cards (.plan/014 item 5): the same plain fade the loaded
           cards use, so these don't pop in instantly while everything else animates. No
           stagger — only ever one of them is on screen. -->
      <div v-else-if="error" class="card fade-in flex items-center gap-2 text-danger">
        <span>{{ error }}</span>
      </div>

      <div v-else-if="resumes.length === 0" class="card fade-in flex flex-col items-center gap-3 py-12 text-center">
        <span class="dropzone-icon">
          <Inbox class="size-5" />
        </span>
        <p class="font-semibold">No CVs yet</p>
        <p class="max-w-sm text-sm text-fg-muted">Upload a CV from a job, or use "Upload CV" above.</p>
      </div>

      <ul v-else class="flex flex-col gap-3">
        <!-- :style for the stagger delay is a data-driven value, the same category as
             MatchResult's `:style="{ width: ... }"` — not the static hand-authored styling
             .claude/rules/ui-and-styling.md rules out. -->
        <li
          v-for="(resume, index) in resumes"
          :key="resume.id"
          class="card card-enter flex flex-col gap-3"
          :style="{ animationDelay: cardEnterDelay(index) }"
        >
          <template v-if="canEditCv(resume) && editingId === resume.id">
            <label>
              <span>Name</span>
              <input v-model="editName" type="text" />
            </label>
            <label>
              <span>Email</span>
              <input v-model="editEmail" type="email" />
            </label>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary" :disabled="savingEdit" @click="saveEdit(resume)">
                {{ savingEdit ? 'Saving…' : 'Save' }}
              </button>
              <button type="button" class="btn btn-ghost" @click="cancelEdit">Cancel</button>
            </div>
          </template>

          <template v-else>
            <div class="flex items-start justify-between gap-3">
              <div class="flex flex-col gap-1">
                <p class="font-semibold">{{ resume.candidate_name }}</p>
                <p class="text-sm text-fg-muted">{{ resume.candidate_email }}</p>
              </div>
              <span class="list-badge">
                <FileText class="size-3.5" />
                {{ resume.file_name }}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <span v-for="job in resume.jobs" :key="job.id" class="list-badge">
                <Briefcase class="size-3.5" />
                {{ job.title }}
              </span>
              <span v-if="resume.jobs.length === 0" class="text-xs text-fg-muted">Not attached to any job</span>
            </div>

            <p class="text-xs text-fg-muted">Uploaded {{ formatDate(resume.created_at) }}</p>

            <div v-if="canDeleteCv(resume) && deletingId === resume.id" class="list-confirm">
              <p>This will also delete its match results.</p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-danger"
                  :disabled="deleteBusy"
                  @click="confirmDelete(resume)"
                >
                  {{ deleteBusy ? 'Deleting…' : 'Confirm delete' }}
                </button>
                <button type="button" class="btn btn-ghost" @click="cancelDelete">Cancel</button>
              </div>
            </div>
            <div v-else-if="canEditCv(resume) || canDeleteCv(resume)" class="flex flex-wrap gap-2">
              <template v-if="canEditCv(resume)">
                <button type="button" class="btn btn-ghost" @click="startEdit(resume)">
                  <Pencil class="size-4" />
                  Edit
                </button>
                <button
                  type="button"
                  class="btn btn-ghost"
                  :disabled="replacingId === resume.id"
                  @click="triggerReplace(resume)"
                >
                  <RefreshCw class="size-4" />
                  {{ replacingId === resume.id ? 'Replacing…' : 'Replace file' }}
                </button>
              </template>
              <button v-if="canDeleteCv(resume)" type="button" class="btn btn-ghost" @click="startDelete(resume)">
                <Trash2 class="size-4" />
                Delete
              </button>
            </div>
          </template>
        </li>
      </ul>

      <!-- `total > 0` rather than `resumes.length > 0`: the count comes from the server and
           covers every page, so the pager survives a page that came back empty and can still
           navigate back to one that isn't. -->
      <Pager
        v-if="!loading && !error && total > 0"
        :page="page"
        :total="total"
        :limit="limit"
        @update:page="goToPage"
      />
  </section>
</template>
