# Plan: Job & CV Management — List, Edit, Delete, Multi-CV per Job

Status: draft
Owner: Ilana
Last updated: 2026-07-30

## Goal
Let a recruiter see everything they've already created: a list of all Jobs and a list of all CVs
(resumes) uploaded. Let them edit and delete both Jobs and CVs. Let a single Job hold many uploaded
CVs (one-to-many), matching the existing per-job upload flow (`/jobs/:jobId/resume`).

## Scope
- In scope:
  - `GET /jobs` (frontend route) — list all Jobs (title, snippet of description, created date, CV
    count), with Edit/Delete actions.
  - `GET /cvs` (frontend route) — list all CVs across all Jobs (candidate name/email, file name, the
    Job it belongs to, uploaded date), with Edit/Delete actions.
  - Edit Job (title/description) and Edit CV (candidate name/email — see Open Question 3).
  - Delete Job and Delete CV, each behind a confirmation prompt.
  - Data model change: `resume` gets a required `job_id`, making one Job → many Resumes explicit
    (see Open Question 1). Upload already happens inside a job's URL scope
    (`ResumePage.vue` reads `jobId` from the route) — this makes that implicit scoping real in the
    data model instead of only living in the `match` table.
  - New backend endpoints: `GET /api/job`, `PATCH /api/job/:id`, `DELETE /api/job/:id`,
    `GET /api/resume` (optionally filtered by `job_id`), `PATCH /api/resume/:id`,
    `DELETE /api/resume/:id`. `POST /api/resume` gains a required `job_id`.
  - Nav bar links to the two new list pages.
  - Tests for all new routes/components per `.rule/testing-rules.md`.
- Out of scope (this plan):
  - Deleting/editing Matches directly (matches stay a derived, read-only-from-UI artifact).
  - Candidate accounts, auth, multi-org switching (unchanged — still single `demo-org`).
  - Re-uploading/replacing a CV's file on edit (see Open Question 3).
  - Any change to the scoring/match flow itself.

## Assumptions
- Single org (`demo-org`), no auth — unchanged from the current app (`JobForm.vue` hardcodes
  `org_id`).
- **Linear MCP is not authorized in this session** (confirmed unavailable — OAuth requires an
  interactive session). Per the orchestrator workflow's ticket step, tickets are written as local
  markdown files under `.orchestration/tickets/` instead of real Linear issues, following this
  repo's existing numbered-plan-file convention. If Linear is connected later, these can be copied in.
- Existing `job`/`candidate`/`resume`/`match` tables and the `Store` interface
  (`backend/src/store/types.ts`) are the extension point — both `memory-store.ts` (used in tests)
  and `pg-store.ts` (production) must be updated together, per that file's own comment about staying
  in sync.

## Open Questions
*(Recommended answers below will be used if none are given; answer inline to override before
APPROVED.)*

1. **Does a Resume belong to exactly one Job (one-to-many), or stay Job-agnostic and only linked via
   `match`?**
   Recommended: **Resume belongs to exactly one Job.** Add `resume.job_id uuid not null references
   job(id)`. This matches the existing UX — CVs are already uploaded from inside a job's URL
   (`/jobs/:jobId/resume`) — and is what "upload several CVs for a single Job" describes. Trade-off:
   a candidate's CV can no longer be reused across multiple job postings without a separate upload;
   that's consistent with the product's current single-job-at-a-time scope
   (`.doc/product-definition.md`).

2. **What happens to a Job's CVs (and their Matches) when the Job is deleted? Same question for a
   CV's Matches when the CV is deleted.**
   Recommended: **Cascade delete.** `resume.job_id` and `match.resume_id`/`match.job_id` get
   `ON DELETE CASCADE`. Deleting a Job removes its Resumes and any Matches referencing them; deleting
   a Resume removes its Matches. The frontend shows a confirmation dialog naming what will be removed
   (e.g., "This will also delete 3 CVs and their match results") before calling delete, so the
   destructive scope is visible before the user confirms it.

3. **What does "Edit" mean for a CV — metadata only, or replacing the uploaded file?**
   Recommended: **Metadata only** — candidate name and email (`PATCH /api/resume/:id` with
   `{ name, email }`, resolved server-side through `resume.candidate_id` to the `candidate` row).
   Replacing the actual file/extracted content is a delete + re-upload, not an edit — re-extracting
   text and re-running any existing matches on edit is a much bigger behavior change than this plan's
   scope.

4. **Frontend route names for the two new list pages.**
   Recommended: `/jobs` (Jobs list) and `/cvs` (CVs list) — short, matches how the user described them.

## Data Model Changes
- `resume` table: add `job_id uuid not null references job(id) on delete cascade`, plus
  `resume_job_id_idx` index. (Migration note: existing rows have no job — this only matters for
  already-seeded local/dev data, not production, since the product hasn't shipped; `schema.sql` is
  the bootstrap source of truth per `.rule/database-rules.md`, updated in place.)
- `match` table: `resume_id` and `job_id` foreign keys become `on delete cascade` (currently plain
  `references`, no cascade behavior defined).
- `Store` interface (`backend/src/store/types.ts`) additions:
  - `listJobs(org_id): Promise<Job[]>`
  - `updateJob(id, input: { title?, description? }): Promise<Job | null>`
  - `deleteJob(id): Promise<boolean>`
  - `listResumes(filter?: { job_id?: string }): Promise<ResumeWithCandidate[]>` and
    `getResume` extended to return the same joined shape (candidate name/email included — the list
    and detail views both need it, avoids a second round-trip from the frontend)
  - `updateResume(id, input: { name?, email? }): Promise<ResumeWithCandidate | null>` (updates the
    linked `candidate` row)
  - `deleteResume(id): Promise<boolean>`
  - Both `memory-store.ts` and `pg-store.ts` implement all of the above identically to the existing
    pattern.

## API Surface (additions/changes to `.orchestration/api-contract.yaml`)
- `GET /api/job?org_id=` — list Jobs for an org.
- `PATCH /api/job/:id` — update `title`/`description`.
- `DELETE /api/job/:id` — delete a Job (cascades per Open Question 2); `204` on success.
- `POST /api/resume` — add required `job_id` field to the multipart body.
- `GET /api/resume?job_id=` — list Resumes, optionally filtered by Job; each item includes
  `candidate_name`/`candidate_email`/`job_id`.
- `PATCH /api/resume/:id` — update candidate `name`/`email`.
- `DELETE /api/resume/:id` — delete a Resume (cascades its Matches); `204` on success.
- The Frontend Agent owns the actual contract file update (per `.agents/frontend/AGENT.md` Step 4);
  this section is the spec for that update.

## Frontend Changes
- New pages: `pages/JobsListPage.vue` (`/jobs`), `pages/CvsListPage.vue` (`/cvs`), each with an
  Edit affordance (inline form or modal) and a Delete button behind a confirm dialog.
- `router/index.ts`: add the two routes.
- `components/NavBar.vue`: add links to `/jobs` and `/cvs`.
- `lib/api.ts`: add `listJobs`, `updateJob`, `deleteJob`, `listResumes`, `updateResume`,
  `deleteResume`; extend `uploadResume`'s input with `job_id`.
- `types/index.ts`: extend `Resume` with `job_id`, `candidate_name`, `candidate_email`.
- `components/ResumeUpload.vue` / `pages/ResumePage.vue`: pass the route's `jobId` through to
  `uploadResume` (the id is already in scope there — just wasn't sent before).
- Tests for both new pages (list rendering, edit, delete-with-confirm) and the updated
  `ResumeUpload`/`api.ts` per `.rule/testing-rules.md`.

## Backend Changes
- `schema.sql`: `resume.job_id` column + index; cascade FKs on `resume` and `match`.
- `routes/job.ts`: add `GET /`, `PATCH /:id`, `DELETE /:id`.
- `routes/resume.ts`: add `GET /`, `PATCH /:id`, `DELETE /:id`; require `job_id` on `POST /`.
- `store/types.ts`, `store/memory-store.ts`, `store/pg-store.ts`: the additions listed above.
- Tests per `.rule/testing-rules.md`: happy path + validation failure (missing `job_id` on upload,
  editing/deleting a non-existent id → `404`) for every new/changed route.

## Tickets
Linear is unavailable this session (see Assumptions), so tickets are written as local files instead
of real Linear issues:
- `.orchestration/tickets/frontend-job-cv-management.md`
- `.orchestration/tickets/backend-job-cv-management.md`

## Steps
1. Backend: schema migration (`resume.job_id`, cascade FKs) → store interface + both
   implementations → routes (`GET`/`PATCH`/`DELETE` for job and resume) → tests.
2. Frontend: `api.ts` + `types/index.ts` additions → `JobsListPage.vue` / `CvsListPage.vue` →
   nav links → wire `job_id` through the existing upload flow → tests.
3. `.orchestration/api-contract.yaml` updated to match (frontend agent, per its Step 4).
4. QA pass across both, plus a manual smoke test (see Validation).

## Validation
- `npm test` and `npm run typecheck` pass in both `backend/` and `frontend/`.
- Manual smoke test: create a Job → upload two CVs against it → `/jobs` shows the Job with a CV
  count of 2 → `/cvs` shows both CVs linked to that Job → edit a CV's name → edit the Job's title →
  delete one CV (confirm dialog names it) → `/cvs` reflects one remaining → delete the Job (confirm
  dialog warns about the remaining CV and its matches) → `/jobs` and `/cvs` both reflect the deletion.

## Risks
- **Cascade deletes are destructive and silent once confirmed.** Mitigated by a confirmation dialog
  that states exactly what will be removed (counts), per Open Question 2.
- **`resume.job_id` becoming required is a breaking data-model change** for any existing local/dev
  rows without one. Mitigated by this being pre-production (no real users yet, per
  `.doc/product-definition.md`); `schema.sql` is a bootstrap script, not a live migration, per
  `.rule/database-rules.md`.
- **Two new list endpoints without org/auth scoping could leak cross-org data later** if multi-org
  auth is added without revisiting these routes. Mitigated by keeping `org_id` filtering on
  `GET /api/job` from day one, consistent with `.doc/architecture.md`'s Auth and Org Boundaries note.

## Rollout Order
1. Backend (schema → store → routes → tests) — additive, no frontend breakage since nothing calls
   the new endpoints yet.
2. Frontend (contract update → api.ts → pages → nav → tests).
3. QA pass over the full flow.

## Rollback
- All work lands as normal commits on the current branch (`feat/recruiting-platform`), consistent
  with `.plan/003-*`'s precedent for this branch. `git revert` on the relevant commit(s) recovers
  prior behavior if any step needs to be undone.
