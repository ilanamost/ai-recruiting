<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { ChevronDown, Download, FileText, Loader, Star, Unlink, X } from '@lucide/vue'
import { EXPERIENCE_LEVELS, skillLabel, yearsToLevel } from '../lib/experience'
// getResumeFileUrl is a pure URL builder, not a request, so it stays a direct lib/api import —
// every actual call goes through the stores below (.plan/018).
import { getResumeFileUrl, UNPAGED_LIMIT } from '../lib/api'
import { apiFetch } from '../lib/http'
import { cardEnterDelay } from '../lib/animation'
import { useAuth } from '../lib/auth'
import { TOAST } from '../lib/toastMessages'
import { useJobStore } from '../stores/job'
import { useMatchStore } from '../stores/match'
import { useResumeStore } from '../stores/resume'
import FilterTabs from './FilterTabs.vue'
import MatchResult from './MatchResult.vue'
import type { ExperienceLevel, Job, JobResume, Match, Resume } from '../types'

const props = defineProps<{ job: Job }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const { user } = useAuth()
// Per .plan/009-2026-08-08-candidate-cv-ownership-scoping.md: attach/detach stay unavailable to
// Recruiter (read-only everywhere on CVs: view attached CVs, preview, download, but no
// attach/detach). Admin is unrestricted. Candidate is scoped to CVs they own
// (resume.owner_user_id === their own user id) for both attaching and detaching.
const canAttachAnyCv = computed(() => user.value?.role === 'admin' || user.value?.role === 'candidate')

function canAttach(resume: Resume) {
  if (user.value?.role === 'admin') {
    return true
  }
  return user.value?.role === 'candidate' && resume.owner_user_id === user.value?.id
}

function canDetach(resume: JobResume) {
  if (user.value?.role === 'admin') {
    return true
  }
  return user.value?.role === 'candidate' && resume.owner_user_id === user.value?.id
}

// Per .plan/010-2026-08-09-candidate-own-match-visibility.md: match results are
// ownership-scoped for Candidate (their own CV only), unrestricted for Admin/Recruiter.
function canViewMatch(resume: JobResume) {
  if (user.value?.role === 'admin' || user.value?.role === 'recruiter') {
    return true
  }
  return user.value?.role === 'candidate' && resume.owner_user_id === user.value?.id
}

// Per .plan/021-2026-08-11-best-match-star.md: the best-match star is Admin/Recruiter only, and
// GET /api/job/:jobId/matches 403s for Candidate — so the same flag gates both the fetch and the
// icon, and a Candidate never attempts the request at all.
const canSeeBestMatch = computed(() => user.value?.role === 'admin' || user.value?.role === 'recruiter')

// Per .plan/029: the filter row reuses canSeeBestMatch's exact Admin/Recruiter condition rather
// than restating it. A Candidate reaches this dialog seeing only their own CVs already
// (backend/src/routes/job.ts list-narrows for them, per .plan/011), so a filter over a one-row
// list would be pure noise.
const canFilterCvs = computed(() => canSeeBestMatch.value)

const jobStore = useJobStore()
const resumeStore = useResumeStore()
const matchStore = useMatchStore()

// Attachments are scoped to the job this modal was opened for, so they stay local; the
// "all CVs" list backing the attach dropdown is app-wide server data and comes from the store.
const attachedResumes = ref<JobResume[]>([])
const allResumes = computed<Resume[]>(() => resumeStore.resumes)
// One entry per resume ever scored for this job, each its latest match. Empty for Candidate
// (never fetched) and whenever the fetch fails — both cases simply render no star.
const latestMatches = ref<Match[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const selectedAttachId = ref('')
const attaching = ref(false)

const detachingId = ref<string | null>(null)
const detachBusy = ref(false)

const previewResume = ref<JobResume | null>(null)
// The PDF file-existence HEAD check behind the preview iframe: 'error' also covers a resume
// carrying a legacy non-PDF mime_type, which has no previewable form left (.plan/030).
const previewFileStatus = ref<'checking' | 'ok' | 'error'>('ok')
const previewMatchLoading = ref(false)
const previewMatchId = ref<string | undefined>(undefined)

const unattachedResumes = computed(() =>
  allResumes.value
    .filter((resume) => !attachedResumes.value.some((attached) => attached.id === resume.id))
    .filter((resume) => canAttach(resume))
)

// Filter state (.plan/029). Client-side by design, and correct here specifically because
// `attachedResumes` is one job's complete, unpaginated attachment list — unlike the paginated
// GET /api/resume, there is no second page for a filter to silently miss.
const levelFilter = ref<ExperienceLevel | 'all'>('all')
const selectedSkills = ref<string[]>([])

const levelOptions = computed<{ value: ExperienceLevel | 'all'; label: string }[]>(() => [
  { value: 'all', label: 'All' },
  ...EXPERIENCE_LEVELS
])

// The skills picker offers the union of skills across THIS job's attached CVs, not a global
// list — there is deliberately no endpoint for the latter (.plan/029 Scope). This is the better
// option regardless of cost: a recruiter filtering one job's applicants should never be offered
// a skill that matches zero rows in the dialog they are standing in.
const availableSkills = computed(() => {
  const skills = new Set<string>()
  for (const resume of attachedResumes.value) {
    // `skills` is contractually never null, but a stale cached response predating the backend
    // change would be — and that must not take the whole dialog down.
    for (const skill of resume.skills ?? []) {
      skills.add(skill)
    }
  }
  return [...skills].sort()
})

const hasActiveFilter = computed(() => levelFilter.value !== 'all' || selectedSkills.value.length > 0)

// Level and skills combine with AND, and multiple skills AND with each other (Open Question 6) —
// consistent with JobsListPage's "all filters combine with AND". A CV with a null
// years_experience is unclassified: it belongs to no level, so it survives only under "All".
const filteredResumes = computed(() => {
  if (!canFilterCvs.value) {
    return attachedResumes.value
  }
  return attachedResumes.value.filter((resume) => {
    if (levelFilter.value !== 'all' && yearsToLevel(resume.years_experience) !== levelFilter.value) {
      return false
    }
    const skills = resume.skills ?? []
    return selectedSkills.value.every((selected) => skills.includes(selected))
  })
})

function toggleSkill(skill: string) {
  selectedSkills.value = selectedSkills.value.includes(skill)
    ? selectedSkills.value.filter((selected) => selected !== skill)
    : [...selectedSkills.value, skill]
}

function clearFilters() {
  levelFilter.value = 'all'
  selectedSkills.value = []
}

// Detaching the last CV carrying a selected skill removes that skill from the picker, which
// would otherwise strand the list on a permanently-empty filter with no chip left to untoggle.
// Dropping the now-offerable-nowhere skill keeps the picker and the selection in agreement.
watch(availableSkills, (skills) => {
  const stillOffered = selectedSkills.value.filter((selected) => skills.includes(selected))
  if (stillOffered.length !== selectedSkills.value.length) {
    selectedSkills.value = stillOffered
  }
})

// How many star tiers the scale has, and the star count the top tier earns — the same number,
// because the scale is one star per tier below the top (5/4/3/2/1).
const TOP_MATCH_COUNT = 5

// Graduated match rating: the best-scoring attached CV shows 5 stars, the next-best distinct
// score 4, down to the 5th distinct score at 1 star; anything below shows none. Supersedes
// .plan/029 Open Question 2's binary "top five all star equally" (post-QA design change,
// 2026-09-07; tie rule confirmed by the user on the second pass).
//
// Open Question 3 still holds, and is still the one thing here that must not be "simplified":
// this ranks over `latestMatches` — every scored CV attached to the job — and deliberately has
// NO dependency on `levelFilter`, `selectedSkills`, or `filteredResumes`. A CV's star count is a
// property of the CV and the job, not of whatever the recruiter is currently looking at.
// Recomputing within the filtered set would silently change what the rating MEANS as tabs are
// clicked: filter to Senior and the best Senior would show 5 stars identically to the job's
// actual best match, and a CV's rating would move purely by toggling a filter, which reads as a
// bug. The accepted consequence is that a filtered view can show fewer stars overall, or none.
//
// TIED CVs SHARE A STAR COUNT. This is DENSE ranking over distinct SCORE VALUES, not over CV
// positions: the tiers are the top five distinct scores, and every CV holding one of those
// scores gets that tier's count. Two CVs tied for best both show 5 stars — the same spirit as
// .plan/029's original "everyone at the cutoff stars", extended to a graduated scale. Two
// consequences, both correct and both covered by tests:
//   * MORE than five CVs can show a star (three CVs tied for best all show 5, using one tier).
//   * FEWER than five tiers can be in use even with five or more scored CVs (three distinct
//     scores among eight CVs means only 5/4/3 ever appear — nothing shows 2 or 1).
// Ranking by position instead would show two identical scores as 5 and 4, which reads as
// arbitrary to a recruiter who can see the two scores are the same.
const starCountsByResumeId = computed(() => {
  // One score per resume, highest wins. The backend guarantees one row per resume, but a
  // duplicate row must never introduce a phantom score value that shifts every tier below it.
  const bestByResume = new Map<string, number>()
  for (const match of latestMatches.value) {
    const current = bestByResume.get(match.resume_id)
    if (current === undefined || match.score > current) {
      bestByResume.set(match.resume_id, match.score)
    }
  }

  // The tiers: the top five DISTINCT scores, best first. Fewer than five distinct scores simply
  // means fewer tiers exist, not that lower tiers get backfilled from further down the list.
  const tiers = [...new Set(bestByResume.values())].sort((a, b) => b - a).slice(0, TOP_MATCH_COUNT)
  const starsByScore = new Map(tiers.map((score, index) => [score, TOP_MATCH_COUNT - index]))

  const counts = new Map<string, number>()
  for (const [resumeId, score] of bestByResume) {
    const stars = starsByScore.get(score)
    if (stars !== undefined) {
      counts.set(resumeId, stars)
    }
  }
  return counts
})

// 0 for a CV outside the top five, for an unscored CV, and for every CV when the score lookup
// failed or was never attempted (Candidate) — the template renders no stars at 0.
function starCountFor(resumeId: string) {
  return starCountsByResumeId.value.get(resumeId) ?? 0
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Deliberately isolated from load()'s own error/loading state: the star is a secondary signal, so
// a failure here must leave the attached CVs, previews, and the rest of the modal rendering
// normally — it just costs the star. The toast is this call site's own (.plan/023): the match
// store no longer raises one, and without it this failure would be completely silent.
async function loadLatestMatches() {
  if (!canSeeBestMatch.value) {
    latestMatches.value = []
    return
  }
  try {
    latestMatches.value = await matchStore.listLatestMatchesForJob(props.job.id)
  } catch (err) {
    latestMatches.value = []
    toast.error(err instanceof Error ? err.message : TOAST.error.matchLoadFailed)
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [jobResumes] = await Promise.all([
      jobStore.listJobResumes(props.job.id),
      // The attach dropdown offers every CV not already on this job, so it needs the whole
      // list, not one page of it (.plan/028) — hence UNPAGED_LIMIT, the server's own `limit`
      // cap, rather than a locally-chosen large number.
      resumeStore.listResumes(1, UNPAGED_LIMIT, { silent: true }),
      loadLatestMatches()
    ])
    attachedResumes.value = jobResumes
    if (previewResume.value && !jobResumes.some((resume) => resume.id === previewResume.value?.id)) {
      closePreview()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load CVs for this job'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function closePreview() {
  previewResume.value = null
  previewFileStatus.value = 'ok'
  previewMatchLoading.value = false
  previewMatchId.value = undefined
}

async function loadPreviewExtras(resume: JobResume) {
  // CVs are PDF-only (.plan/030). A resume still stored with a non-PDF mime_type is legacy data —
  // no migration was in scope — and the HTML-preview route that used to render it is gone, so it
  // resolves straight to the same "file couldn't be loaded" state a broken PDF shows rather than
  // calling an endpoint that no longer exists.
  const isPdf = resume.mime_type === 'application/pdf'
  previewFileStatus.value = isPdf ? 'checking' : 'error'
  previewMatchLoading.value = true
  previewMatchId.value = undefined

  const stillCurrent = () => previewResume.value?.id === resume.id

  const fileCheck = isPdf
    ? apiFetch(getResumeFileUrl(resume.id), { method: 'HEAD' })
        .then((response) => {
          if (stillCurrent()) {
            previewFileStatus.value = response.ok ? 'ok' : 'error'
          }
        })
        .catch(() => {
          if (stillCurrent()) {
            previewFileStatus.value = 'error'
          }
        })
    : Promise.resolve()

  const matchLookup = canViewMatch(resume)
    ? matchStore
        .getMatchForPair(props.job.id, resume.id)
        .then((match) => {
          if (stillCurrent()) {
            previewMatchId.value = match?.id
          }
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : TOAST.error.matchLookupFailed)
        })
        .finally(() => {
          if (stillCurrent()) {
            previewMatchLoading.value = false
          }
        })
    : Promise.resolve().then(() => {
        if (stillCurrent()) {
          previewMatchLoading.value = false
        }
      })

  await Promise.all([fileCheck, matchLookup])
}

function selectPreview(resume: JobResume) {
  if (previewResume.value?.id === resume.id) {
    closePreview()
    return
  }
  previewResume.value = resume
  void loadPreviewExtras(resume)
}

async function attach() {
  if (!selectedAttachId.value) {
    return
  }
  attaching.value = true
  try {
    await jobStore.attachResumeToJob(props.job.id, selectedAttachId.value)
    selectedAttachId.value = ''
    toast.success(TOAST.success.resumeAttached)
    await load()
    emit('changed')
  } catch (err) {
    // .plan/023: the selection stays as it was, and the modal raises the toast itself.
    toast.error(err instanceof Error ? err.message : TOAST.error.resumeAttachFailed)
  } finally {
    attaching.value = false
  }
}

function startDetach(resume: JobResume) {
  detachingId.value = resume.id
}

function cancelDetach() {
  detachingId.value = null
}

async function confirmDetach(resume: JobResume) {
  detachBusy.value = true
  try {
    await jobStore.detachResumeFromJob(props.job.id, resume.id)
    if (previewResume.value?.id === resume.id) {
      closePreview()
    }
    toast.success(TOAST.success.resumeDetached)
    detachingId.value = null
    await load()
    emit('changed')
  } catch (err) {
    // .plan/023: the confirm step stays open, and the modal raises the toast itself.
    toast.error(err instanceof Error ? err.message : TOAST.error.resumeDetachFailed)
  } finally {
    detachBusy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div class="card flex max-h-[85vh] w-full max-w-4xl flex-col gap-4 overflow-hidden">
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-semibold">Manage CVs</h2>
          <p class="text-sm text-fg-muted">{{ job.title }}</p>
        </div>
        <button type="button" class="btn btn-ghost" aria-label="Close" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>

      <div v-if="loading" class="flex items-center gap-2 text-fg-muted">
        <Loader class="size-4 animate-spin" />
        <span>Loading CVs…</span>
      </div>

      <div v-else-if="error" class="flex items-center gap-2 text-danger">
        <span>{{ error }}</span>
      </div>

      <template v-else>
        <div v-if="canAttachAnyCv" class="flex flex-wrap items-center gap-2">
          <div class="select-wrap min-w-0 flex-1">
            <select v-model="selectedAttachId" :disabled="unattachedResumes.length === 0">
              <option value="" disabled>
                {{ unattachedResumes.length === 0 ? 'No unattached CVs available' : 'Select a CV to attach' }}
              </option>
              <option v-for="resume in unattachedResumes" :key="resume.id" :value="resume.id">
                {{ resume.candidate_name }} — {{ resume.file_name }}
              </option>
            </select>
            <ChevronDown class="select-arrow size-4" />
          </div>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!selectedAttachId || attaching"
            @click="attach"
          >
            {{ attaching ? 'Attaching…' : 'Attach CV' }}
          </button>
        </div>

        <!-- Same filter-strip treatment as JobsListPage's row 2 and the Pager (bg-bg +
             rounded-md + p-3), so the dialog reads as part of the same app. The dialog is
             max-h-[85vh] with the CV list as the flex-1 scroller below, so this row must not be
             allowed to grow with it — a job with many distinct skills across its attached CVs
             would otherwise push the skill chips across several lines and squeeze the list down
             to almost nothing. The level tabs and "Clear filters" stay a fixed, single-line
             height (flex-shrink-0); only the skill-chip group scrolls internally past a few
             rows, so the CV list keeps the majority of the modal's height regardless of how many
             skills are on offer. -->
        <div
          v-if="canFilterCvs && attachedResumes.length > 0"
          class="flex flex-wrap items-start gap-3 rounded-md bg-bg p-3"
        >
          <FilterTabs
            v-model="levelFilter"
            class="shrink-0"
            :options="levelOptions"
            label="Filter by experience level"
          />

          <!-- Toggle chips rather than a <select multiple>: multi-select is awkward to operate
               and, unlike a select, chips keep the recruiter's current selection visible while
               they scan the list. Not a <ul>/<li> — the attached-CV list below is the dialog's
               only list. max-h caps this at roughly three chip rows before it scrolls
               internally, so a job with many distinct skills can't starve the CV list below of
               height (the modal itself doesn't scroll as a whole — only this and the list do). -->
          <div
            v-if="availableSkills.length > 0"
            class="flex max-h-20 flex-wrap items-center gap-2 overflow-y-auto"
            role="group"
            aria-label="Filter by skill"
          >
            <button
              v-for="skill in availableSkills"
              :key="skill"
              type="button"
              class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
              :class="
                selectedSkills.includes(skill)
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-border bg-surface text-fg-muted hover:text-fg'
              "
              :aria-pressed="selectedSkills.includes(skill)"
              @click="toggleSkill(skill)"
            >
              {{ skillLabel(skill) }}
            </button>
          </div>

          <button
            v-if="hasActiveFilter"
            type="button"
            class="btn btn-ghost ml-auto shrink-0 self-center"
            @click="clearFilters"
          >
            Clear filters
          </button>
        </div>

        <div v-if="attachedResumes.length === 0" class="card flex flex-col items-center gap-2 py-8 text-center">
          <p class="font-semibold">No CVs attached yet</p>
          <p class="max-w-sm text-sm text-fg-muted">Attach an existing CV to this job using the control above.</p>
        </div>

        <!-- Distinct from "No CVs attached yet": CVs are attached, the filters just excluded
             them all, so pointing at the attach control would be misleading here. Mirrors
             JobsListPage's "No jobs match your filters". -->
        <div
          v-else-if="filteredResumes.length === 0"
          class="card flex flex-col items-center gap-2 py-8 text-center"
        >
          <p class="font-semibold">No CVs match these filters</p>
          <p class="max-w-sm text-sm text-fg-muted">Try a different experience level or fewer skills.</p>
        </div>

        <ul v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <!-- :style for the stagger delay is a data-driven value, the same category as
               MatchResult's `:style="{ width: ... }"` — not the static hand-authored styling
               .claude/rules/ui-and-styling.md rules out. -->
          <li
            v-for="(resume, index) in filteredResumes"
            :key="resume.id"
            class="card card-enter flex cursor-pointer flex-col gap-2"
            :class="{ 'border-primary': previewResume?.id === resume.id }"
            :style="{ animationDelay: cardEnterDelay(index) }"
            @click="selectPreview(resume)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-2">
                <!-- The rating is one labelled group, not N labelled icons: a screen reader
                     should hear "4 of 5 stars" once, not "star" four times. The icons
                     themselves are decorative inside it. -->
                <span
                  v-if="canSeeBestMatch && starCountFor(resume.id) > 0"
                  class="mt-0.5 flex shrink-0 items-center gap-0.5"
                  role="img"
                  :aria-label="`${starCountFor(resume.id)} of 5 stars for this job`"
                >
                  <Star
                    v-for="star in starCountFor(resume.id)"
                    :key="star"
                    class="size-3.5 fill-warning text-warning"
                    aria-hidden="true"
                  />
                </span>
                <div class="flex flex-col gap-1">
                  <p class="font-semibold">{{ resume.candidate_name }}</p>
                  <p class="text-sm text-fg-muted">{{ resume.candidate_email }}</p>
                </div>
              </div>
              <span class="list-badge">
                <FileText class="size-3.5" />
                {{ resume.file_name }}
              </span>
            </div>
            <p class="text-xs text-fg-muted">Attached {{ formatDate(resume.attached_at) }}</p>

            <div v-if="canDetach(resume) && detachingId === resume.id" class="list-confirm" @click.stop>
              <p>This will also delete its match results for this job.</p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-danger"
                  :disabled="detachBusy"
                  @click="confirmDetach(resume)"
                >
                  {{ detachBusy ? 'Detaching…' : 'Confirm detach' }}
                </button>
                <button type="button" class="btn btn-ghost" @click="cancelDetach">Cancel</button>
              </div>
            </div>
            <div v-else class="flex gap-2" @click.stop>
              <a
                :href="getResumeFileUrl(resume.id, { download: true })"
                class="btn btn-ghost"
                download
              >
                <Download class="size-4" />
                Download
              </a>
              <button v-if="canDetach(resume)" type="button" class="btn btn-ghost" @click="startDetach(resume)">
                <Unlink class="size-4" />
                Detach
              </button>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </div>

  <div
    v-if="previewResume"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
    @click.self="closePreview"
  >
    <div class="card flex max-h-[90vh] w-full max-w-5xl flex-col gap-4 overflow-hidden">
      <div class="flex items-center justify-between gap-3">
        <p class="truncate text-sm font-medium">{{ previewResume.file_name }}</p>
        <button type="button" class="btn btn-ghost" aria-label="Close preview" @click="closePreview">
          <X class="size-4" />
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <!-- One branch only: CVs are PDF-only (.plan/030). A legacy non-PDF CV never reaches the
             iframe — loadPreviewExtras resolves it straight to 'error'. -->
        <div v-if="previewFileStatus === 'checking'" class="flex items-center gap-2 text-fg-muted">
          <Loader class="size-4 animate-spin" />
          <span>Checking file…</span>
        </div>
        <div v-else-if="previewFileStatus === 'error'" class="flex items-center gap-2 text-danger">
          <span>This CV's file couldn't be loaded — replace it from the CVs page.</span>
        </div>
        <div v-else class="h-[65vh] min-h-[24rem]">
          <iframe
            :src="getResumeFileUrl(previewResume.id)"
            :title="`Preview of ${previewResume.file_name}`"
            class="h-full w-full rounded-md border border-border"
          />
        </div>

        <template v-if="canViewMatch(previewResume)">
          <div v-if="previewMatchLoading" class="flex items-center gap-2 text-fg-muted">
            <Loader class="size-4 animate-spin" />
            <span>Checking for an existing match…</span>
          </div>
          <MatchResult
            v-else
            :match-id="previewMatchId"
            :resume-id="!previewMatchId ? previewResume.id : undefined"
            :job-id="!previewMatchId ? job.id : undefined"
          />
        </template>
        <section v-else class="card flex flex-col gap-4">
          <h2 class="text-lg font-semibold">Match result</h2>
          <p class="text-sm text-fg-muted">Match result is only visible to the CV's owner.</p>
        </section>
      </div>
    </div>
  </div>
</template>
