# Plan: CV Preview Fix, Route Removal (Upload CV / Match Result), In-Modal Match Display

Status: draft
Owner: Ilana
Last updated: 2026-08-01

## Goal
Fix the "Failed to load PDF document" error in the Jobs route's "Manage CVs" preview. Remove the
standalone Upload CV route and the standalone Match Result route entirely (both superseded by the
many-to-many job↔CV attach flow from `.plan/005-*`), while preserving and reusing the underlying
match-scoring capability by surfacing it inside the CV preview pane in `JobCvsModal.vue`. Add an
explicit way to exit preview mode in that modal.

## Scope
- In scope:
  1. **CV/PDF preview bug** (`JobCvsModal.vue`, `GET /api/resume/:id/file`): stop silently serving
     an empty body with a real `Content-Type` when `resume.file_data` is missing/null; fail with a
     clear error instead, and show that error in the preview pane rather than a broken iframe.
  2. **Remove the Upload CV route** (`/jobs/:jobId/resume`, `ResumePage.vue`, `ResumeUpload.vue`)
     and all code that exists only for it. It is redundant now that CVs are attached to jobs from
     the CVs list (`.plan/005-*`), and per explicit instruction its current internal-error bug is
     not being fixed — it's being deleted.
  3. **Remove the Match Result route** (`/jobs/:jobId/matches/:matchId?`, `MatchPage.vue`) and all
     code that exists only for that standalone page/nav entry. The underlying match
     creation/lookup capability (`backend/src/scoring`, `routes/match.ts`, `MatchResult.vue`,
     `createMatch`/`getMatch`) is **not** deleted — it's reused, wired into `JobCvsModal.vue` so a
     CV's match result displays alongside its file preview when clicked from the Jobs route.
  4. **Exit preview mode in `JobCvsModal.vue`**: an explicit close control on the preview pane, and
     the attached-CVs list goes back to a plain full-width list (not a split view with an idle
     placeholder pane) when nothing is being previewed.
- Out of scope:
  - Any change to the scoring algorithm/prompt itself.
  - Rich DOCX rendering (unchanged from `.plan/005-*` — still text-only).
  - Auth, multi-org switching.
  - Object storage for uploaded files (still Postgres `bytea`, per `.plan/005-*`).

## Assumptions
- **Linear MCP is not authorized in this session.** Tickets are local files under
  `.orchestration/tickets/`, per `.plan/004-*`/`.plan/005-*` precedent.
- This is pre-production with no real users (per `.doc/product-definition.md`), so a CV whose raw
  file bytes were never captured (uploaded before `.plan/005-*` added `resume.file_data`, or whose
  local dev DB never got that column backfilled) does not need a data-recovery path — the bytes
  were never stored, so there's nothing to recover. The fix is to fail clearly instead of silently,
  and let the recruiter re-upload/replace the file.
- Per `.rule/database-rules.md`, `schema.sql` uses `create table if not exists`, so it does **not**
  retroactively add `resume.file_data` to a `resume` table that already existed before
  `.plan/005-*`. This is the leading hypothesis for the reported "Failed to load PDF document": a
  resume row with `file_data IS NULL` gets served as `res.send(undefined)` with
  `Content-Type: application/pdf` still set — a technically-200, zero-byte response with a PDF
  content type, which is exactly what makes a browser's native PDF viewer show that specific error.
  This must be confirmed against the actual live dev database (not assumed) before being called
  fixed, per that same rule's verification requirement.
- Grepped confirmation: `frontend/src/lib/session.ts` (`{ jobId, jobTitle, resumeId, matchId }`) has
  exactly four importers today — `NavBar.vue`, `ResumePage.vue`, `MatchPage.vue`, `JobPage.vue`.
  Once the Upload CV and Match Result routes are removed and `JobPage.vue`/`NavBar.vue` stop using
  it (this plan), nothing imports it anymore — it becomes genuinely dead code, not a "maybe still
  used" module, so it's deleted rather than left in place.
- Grepped confirmation: `MatchResult.vue`'s only importer is `MatchPage.vue`; `scoring/index.ts`'s
  only caller is `routes/match.ts`; `createMatch`/`getMatch` in `lib/api.ts` have no callers outside
  `MatchResult.vue`. All of this is reused as-is by the new in-modal wiring (Item 3), not rewritten.

## Open Questions
*(Recommended answers below will be used if none are given; answer inline to override before
APPROVED.)*

1. **Where does creating a new job (`JobPage.vue`) navigate to now, since `/jobs/:jobId/resume` is
   gone?**
   Recommended: **`/jobs`** (the Jobs list) — "Manage CVs" on the new job is one click away, and
   this matches the item-2 instruction that attaching CVs from the list is now the primary flow.

2. **Does opening a CV's preview in `JobCvsModal.vue` auto-create a match if none exists yet for
   that (job, CV) pair, or require an explicit "Run match" click?**
   Recommended: **auto-create**, same behavior `MatchResult.vue` already has today (it creates a
   match automatically when given `resumeId`+`jobId` and no `matchId`). To avoid re-scoring (and
   re-billing the Claude API) every time the same CV is previewed again, add a lookup
   (`GET /api/job/:jobId/resumes/:resumeId/match`) that returns the most recent existing match for
   that pair if one exists; `JobCvsModal.vue` passes that as `matchId` when found, or falls back to
   `resumeId`+`jobId` (triggering create) when not. This reuses `MatchResult.vue` completely
   unchanged.

3. **What happens when `GET /api/resume/:id/file` is requested for a resume with no stored file
   bytes (`file_data IS NULL`)?**
   Recommended: **404**, via the existing `NotFoundError` (`backend/src/lib/errors.ts`), with a
   message identifying it as a missing file rather than a missing resume (e.g. "Resume file not
   available — re-upload or replace this CV's file"). The preview pane and the Download link both
   surface that message instead of a broken iframe / corrupt download.

4. **Delete `frontend/src/lib/session.ts` outright, or leave it in place unused?**
   Recommended: **delete it**, along with `frontend/tests/session.test.ts`. It has no importers
   left after this plan (see Assumptions) — keeping unused state-management code around is exactly
   the kind of dead code `.rule/coding-rules.md`-style hygiene argues against, and it's cheap to
   restore from git history if a future plan needs session state again.

## Data Model Changes
- No schema changes. `match` already has `match_job_id_idx` and `match_resume_id_idx`
  (`backend/schema.sql:64-65`), sufficient for the new `(job_id, resume_id)` lookup query at this
  scale — no composite index needed.
- `Store` interface (`backend/src/store/types.ts`) addition:
  - `getLatestMatchForPair(job_id: string, resume_id: string): Promise<Match | null>` — most recent
    `match` row for that exact pair, or `null`. Implemented identically in `memory-store.ts` and
    `pg-store.ts`, per that file's existing sync requirement.
- **Live database verification** (per `.rule/database-rules.md`, not optional): before calling the
  preview-bug fix done, confirm against the actual local Postgres instance —
  - `resume.file_data` column exists (`information_schema.columns`).
  - Whether any existing `resume` rows have `file_data IS NULL`; if so, this confirms the bug's root
    cause and those specific rows are expected to keep 404ing on `/file` until replaced — this is
    correct post-fix behavior, not a regression to chase further.

## API Surface (additions/removals to `.orchestration/api-contract.yaml`)
- **Add:** `GET /api/job/:jobId/resumes/:resumeId/match` — returns the most recent `Match` for that
  pair; `404` if none exists yet or the pair isn't attached.
- **Change:** `GET /api/resume/:id/file` — now `404`s (instead of `200` with an empty body) when
  `file_data` is null.
- **Remove nothing** from `/api/match` — `POST /api/match` and `GET /api/match/:id` are unchanged
  and still used (now only via `JobCvsModal.vue` instead of `MatchPage.vue`).
- The Frontend Agent owns the actual contract file update, per `.agents/frontend/AGENT.md` Step 4.

## Frontend Changes
- **Delete entirely:**
  - `frontend/src/pages/ResumePage.vue`, `frontend/src/components/ResumeUpload.vue`,
    `frontend/tests/ResumeUpload.test.ts` (Item 2).
  - `frontend/src/pages/MatchPage.vue`, `frontend/tests/MatchPage.test.ts` (Item 3 — route only;
    `MatchResult.vue`/`MatchResult.test.ts` are kept and reused, not deleted).
  - `frontend/src/lib/session.ts`, `frontend/tests/session.test.ts` (Open Question 4).
- **`frontend/src/router/index.ts`:** remove the `ResumePage`/`MatchPage` imports and their two
  route entries (`/jobs/:jobId/resume`, `/jobs/:jobId/matches/:matchId?`).
- **`frontend/src/components/NavBar.vue`:** remove `resumeTarget`/`matchTarget` computeds and the
  "Upload CV"/"Match result" `RouterLink`s (and now-unused `FileUp`/`Target` icon imports). Update
  `frontend/tests/NavBar.test.ts` for the resulting 3-link nav.
- **`frontend/src/pages/JobPage.vue`:** on `@created`, `router.push('/jobs')` instead of
  `/jobs/${job.id}/resume`; drop the `useSession`/`setJob` call entirely (Open Question 1).
- **`frontend/src/lib/api.ts`:**
  - Add `getMatchForPair(jobId: string, resumeId: string): Promise<Match | null>` — like the other
    wrappers but returns `null` on a `404` response instead of throwing (a "no match yet" state is
    expected/normal here, not an error condition).
  - `createMatch`/`getMatch` stay as-is (now called only from `MatchResult.vue` via
    `JobCvsModal.vue`'s usage instead of `MatchPage.vue`'s).
  - `uploadResume` stays as-is (still used by `CvsListPage.vue`'s job-less upload form).
- **`frontend/src/components/JobCvsModal.vue`** (Items 1, 3, 4):
  - Preview pane restructure: render the two-column grid only when `previewResume` is set; with
    nothing selected, the attached-CVs list renders full-width (single column) instead of showing
    an idle "Click a CV to preview it here" pane (Item 4).
  - Add an explicit close control (small `X` button) in the preview pane's header, alongside the
    previewed file's name, so a recruiter can exit preview mode without re-clicking the same row
    (Item 4).
  - On selecting a CV to preview, also call `getMatchForPair(job.id, resume.id)`; render
    `<MatchResult>` in the preview pane (below the file/text preview) with `:match-id` set if a
    match was found, otherwise `:resume-id`/`:job-id` (which makes `MatchResult` create one) — this
    is the only new usage of `MatchResult.vue`, unmodified (Item 3).
  - File-load failure handling: before rendering the PDF `<iframe>`, verify the file is actually
    fetchable (e.g. a `fetch()`/`HEAD` check against `getResumeFileUrl(id)`); on failure, show an
    inline "This CV's file couldn't be loaded — replace it from the CVs page" message instead of an
    iframe that silently fails in-browser (Item 1).
- **Tests:** update `frontend/tests/JobCvsModal.test.ts` for the restructured preview pane, the
  close control, the in-modal match display (mock `getMatchForPair`), and the file-load-failure
  state. Update `frontend/tests/NavBar.test.ts`, remove `ResumeUpload.test.ts`/`MatchPage.test.ts`/
  `session.test.ts`, per `.rule/testing-rules.md`.

## Backend Changes
- **`backend/src/routes/resume.ts`:** `GET /:id/file` — after `store.getResumeFile(id)`, if
  `file.file_data` is null/missing, `throw new NotFoundError('Resume file not available — re-upload
  or replace this CV\'s file')` instead of proceeding to `res.send`. (Item 1)
- **`backend/src/routes/job.ts`:** add `GET /:jobId/resumes/:resumeId/match` — validates the pair is
  attached (`store.isResumeAttachedToJob`), then `store.getLatestMatchForPair`; `404` if not
  attached or no match yet, `200` with the `Match` otherwise. (Item 3)
- **`backend/src/store/types.ts`, `memory-store.ts`, `pg-store.ts`:** add `getLatestMatchForPair` as
  specified in Data Model Changes.
- **Live DB verification** (see Data Model Changes) — confirm the actual root cause of Item 1 against
  the real local Postgres instance before marking it fixed, per `.rule/database-rules.md`.
- **Tests:** `backend/tests/resume.test.ts` — add a case for `GET /:id/file` on a resume with null
  `file_data` → `404`. `backend/tests/job.test.ts` (or a new `job-resume-match.test.ts`) — happy path
  and `404` cases for the new match-lookup route, per `.rule/testing-rules.md`.

## Tickets
Linear is unavailable this session (see Assumptions), so tickets are local files:
- `.orchestration/tickets/frontend-cv-preview-route-cleanup.md`
- `.orchestration/tickets/backend-cv-preview-route-cleanup.md`

## Steps
1. Backend: `getResumeFile` null-check fix → `getLatestMatchForPair` (store + both implementations)
   → `GET /:jobId/resumes/:resumeId/match` route → tests → live-DB verification per
   `.rule/database-rules.md`.
2. Frontend: delete Upload CV route files, delete Match Result route files (keep `MatchResult.vue`),
   delete `session.ts`, update `router/index.ts` + `NavBar.vue` + `JobPage.vue` → `api.ts` additions
   → `JobCvsModal.vue` rework (preview restructure, close control, in-modal match, file-load-failure
   state) → tests.
3. `.orchestration/api-contract.yaml` updated to match (frontend agent, per its Step 4).
4. QA pass across both, plus the manual smoke test below.

## Validation
- `npm test` and `npm run typecheck` pass in both `backend/` and `frontend/`.
- Manual smoke test: open a job's "Manage CVs" → click an attached PDF CV → preview renders inline
  (not "Failed to load PDF document") and a match score/explanation appears below it → click the
  same CV again (or the new close button) → returns to the plain, full-width attached-CVs list →
  click a CV whose file predates this fix (if any exist in the local dev DB) → preview pane shows
  the clear "file not available" message instead of a broken iframe → confirm `/jobs/:jobId/resume`
  and `/jobs/:jobId/matches` no longer exist (redirect to `/`) → confirm nav bar shows only New job /
  Jobs / CVs → create a new job → lands on `/jobs` → previewing the same CV against the same job a
  second time does not trigger a second Claude API call (reuses the looked-up match).

## Risks
- **Root-causing the PDF bug from code alone, without confirming against the live dev DB, could
  miss the actual cause** (e.g. a CORS/env mismatch instead of/in addition to null `file_data`).
  Mitigated by the explicit live-DB verification step (`.rule/database-rules.md`) before this item
  is marked done — the null-`file_data` fail-fast fix is correct regardless, but it must be
  confirmed as *the* cause, not just *a* plausible one.
- **Removing `frontend/src/lib/session.ts` is a one-way cut** if some other unnoticed code still
  depends on it. Mitigated by the grep-confirmed 4-importer count in Assumptions, all touched by
  this same plan, and by `git revert` being available if something surfaces later.
- **Auto-creating a match on first preview (Open Question 2) still costs one Claude API call per
  (job, CV) pair the first time it's previewed.** Mitigated by the new lookup avoiding repeat calls
  on subsequent previews of the same pair — same cost profile as the old Match Result page, not
  worse.

## Rollout Order
1. Backend (null-`file_data` fix → match-lookup addition → tests → live-DB check) — additive/fixing,
   no frontend breakage since the frontend doesn't call the new endpoint yet.
2. Frontend (route/file deletions → nav/router updates → `JobCvsModal.vue` rework → tests).
3. QA pass over the full flow.

## Rollback
- All work lands as normal commits on the current branch (`feat/recruiting-platform`), consistent
  with `.plan/003-*`/`.plan/004-*`/`.plan/005-*` precedent. `git revert` on the relevant commit(s)
  recovers the prior routes/behavior if any step needs to be undone.
