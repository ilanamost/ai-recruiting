# Plan: Job Duplication, CV Attach/Detach, Download, Replace & Preview

Status: draft
Owner: Ilana
Last updated: 2026-07-30

## Goal
Let a recruiter duplicate a Job, and manage which CVs (Resumes) are linked to a Job independently
of where the CV was originally uploaded: attach an existing CV to a Job, detach it again without
deleting the CV itself, view/download a Job's attached CVs from a popup, and preview a CV's file
from that popup. Let a CV's underlying file be removed or replaced from the `/cvs` route, with a
replacement propagating to every Job the CV is attached to.

## Scope
- In scope:
  - `POST /jobs/:id/duplicate` (frontend action) — duplicate a Job (title, description, and its
    current CV attachments) as a new Job.
  - Attach an existing CV to a Job, and detach a CV from a Job, from a popup opened on the Jobs
    route.
  - The same popup lists every CV attached to that Job (candidate, file name, attached date) with a
    Download action per CV.
  - Preview a CV's file from that popup (see Open Question 4 for hover vs. click).
  - On the CVs route: remove a CV's uploaded file (existing delete-resume flow) or replace it with a
    new file. Replacing keeps the same CV identity, so every Job it's attached to sees the new file
    immediately — this requires decoupling a CV from a single owning Job (see Open Question 1).
  - Data model change: Resume ↔ Job becomes many-to-many via a new `job_resume` join table,
    replacing the `resume.job_id NOT NULL` column added in
    `.plan/004-2026-07-30-job-cv-management.md`.
  - Persist each CV's raw uploaded file bytes (not just extracted text) so download/preview/replace
    have something to serve — nothing today stores the original file (see Assumptions).
  - New/changed backend endpoints (final shape owned by the Frontend ticket's contract update, per
    `.agents/frontend/AGENT.md` Step 4):
    - `POST /api/job/:id/duplicate`
    - `GET /api/job/:id/resumes`, `POST /api/job/:id/resumes` (attach), `DELETE
      /api/job/:id/resumes/:resumeId` (detach)
    - `GET /api/resume/:id/file` (download/preview raw bytes), `PUT /api/resume/:id/file` (replace)
    - `POST /api/resume` — `job_id` becomes optional (a CV may now be uploaded without attaching it
      to a Job yet)
  - Tests for all new/changed routes/components per `.rule/testing-rules.md`.
- Out of scope (this plan):
  - Any change to the scoring/match flow itself beyond what detach requires (see Open Question 3).
  - Rich DOCX rendering (see Open Question 5) — text-only preview for DOCX is accepted for this
    plan.
  - Candidate accounts, auth, multi-org switching (unchanged — still single `demo-org`).
  - Bulk attach (attach one CV to many Jobs in one action) — attach stays one Job × one CV per
    action.

## Assumptions
- **Linear MCP is not authorized in this session** (unchanged from `.plan/004-*`). Tickets are
  written as local markdown files under `.orchestration/tickets/`, per that plan's precedent.
- No raw file bytes are persisted today — `backend/src/routes/resume.ts` extracts text via
  `extractText` and discards the original `Buffer`. Download, replace, and file preview all need
  the original bytes, so this plan adds a `resume.file_data bytea not null` column. This is a
  bigger storage footprint per row than today but keeps the bootstrap script (`schema.sql`)
  self-contained instead of introducing an external object store, consistent with this project's
  current local/dev-only scope.
- This app is pre-production with no real users yet (per `.doc/product-definition.md` and the same
  reasoning `.plan/004-*` used for its breaking schema change), so `resume.job_id` can be dropped
  outright rather than migrated/backfilled, and `schema.sql` stays a bootstrap-only script per
  `.rule/database-rules.md`.
- The existing per-job upload flow (`/jobs/:jobId/resume`) keeps working unchanged from the
  recruiter's point of view: uploading from inside a Job's page still auto-attaches the new CV to
  that Job. What changes is that the CV is no longer *locked* to that one Job afterward.

## Open Questions
*(Recommended answers below will be used if none are given; answer inline to override before
APPROVED.)*

1. **Resume ↔ Job cardinality: many-to-many (join table) instead of the one-to-many
   `resume.job_id` from `.plan/004-*`?**
   Recommended: **Yes, many-to-many.** Requirement 4 ("remove or replace \[a CV's file], which will
   change it for all the Jobs it was added to as well") only makes sense if one CV can belong to
   more than one Job. Add `job_resume(job_id, resume_id)` as the join table; drop
   `resume.job_id`. Trade-off: this reverses part of `.plan/004-*`'s data model just one day after
   it shipped — acceptable pre-production, but worth flagging explicitly since it touches the same
   tables that plan just changed.

2. **Does duplicating a Job also duplicate its CV attachments?**
   Recommended: **Yes.** The new Job starts attached to the same CVs as the original (copy
   `job_resume` rows only — not the CVs themselves, not any Matches). Matches are not duplicated;
   the new Job starts with no match history, since a score against the old Job's description
   shouldn't be presented as valid for a possibly-different Job. Duplicating a job does not copy
   its Matches — score the duplicate's CVs fresh if needed.

3. **What happens to a Job's existing Matches for a CV that gets detached from that Job?**
   Recommended: **Cascade-delete those Matches on detach** (deleted at the application layer inside
   the detach route/store method, since `match` doesn't have a direct FK to `job_resume`). A Match
   scored against a Job the CV is no longer attached to is stale and shouldn't be shown as current.
   This mirrors the delete-cascade reasoning already accepted in `.plan/004-*`.

4. **CV file preview in the popup: on hover or on click?**
   Recommended: **Click.** Hover previews are cheap for a quick glance but don't work on touch
   devices, can flicker/mis-trigger while scanning a list, and aren't keyboard-accessible. Click
   (e.g., selecting a row shows the preview in a side pane within the same popup) works the same
   way across input methods and only fetches the file when the recruiter actually wants to see it.

5. **DOCX preview: render it, or fall back to something simpler?**
   Recommended: **PDF gets a real inline preview** (`<iframe>`/`<embed>` pointing at
   `GET /api/resume/:id/file`, which browsers render natively). **DOCX shows the already-extracted
   plain-text `content`** as a labeled "text preview" instead of rendered formatting — pulling in a
   DOCX-to-HTML conversion library is disproportionate to this plan's scope and can be a follow-up.

6. **Can a CV be uploaded from `/cvs` without attaching it to any Job yet?**
   Recommended: **Yes.** Now that a CV isn't locked to one Job, `/cvs` gains its own upload action
   for a Job-less CV, attached later via the Jobs-route popup. This is additive UI; the existing
   per-job upload path is unchanged.

## Data Model Changes
- `resume` table:
  - Drop `job_id` column (and `resume_job_id_idx`) — replaced by `job_resume`.
  - Add `file_data bytea not null` — the original uploaded file bytes, used by download/preview/
    replace.
- New `job_resume` table (join table, many-to-many):
  ```sql
  create table if not exists job_resume (
    job_id uuid not null references job(id) on delete cascade,
    resume_id uuid not null references resume(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (job_id, resume_id)
  );
  create index if not exists job_resume_resume_id_idx on job_resume(resume_id);
  ```
- `match` table: unchanged shape (`resume_id`, `job_id`, both `on delete cascade` already, per
  `.plan/004-*`). Creating a Match now additionally requires the `(resume_id, job_id)` pair to have
  a matching `job_resume` row — validated in the route, not a DB constraint, to avoid a composite-FK
  dependency on a junction table.
- `Store` interface (`backend/src/store/types.ts`) changes:
  - `createResume` input: `job_id` becomes optional; add `file_data: Buffer`.
  - `duplicateJob(id): Promise<Job | null>` — new Job row + copies that Job's `job_resume` rows.
  - `attachResumeToJob(job_id, resume_id): Promise<void>` — idempotent insert.
  - `detachResumeFromJob(job_id, resume_id): Promise<boolean>` — deletes the `job_resume` row and
    any `match` rows for that pair.
  - `listResumesForJob(job_id): Promise<ResumeWithCandidate[]>` — replaces the old
    `listResumes({ job_id })` filter semantics (now a join through `job_resume`).
  - `listResumes()` (no filter, for `/cvs`) — each item gains `jobs: { id: string; title: string
    }[]` (which Jobs it's currently attached to), via a join through `job_resume`.
  - `getResumeFile(id): Promise<{ file_name; mime_type; file_data: Buffer } | null>` — for the
    download/preview route.
  - `replaceResumeFile(id, input: { file_name; mime_type; content; file_data }):
    Promise<ResumeWithCandidate | null>`.
  - `memory-store.ts` and `pg-store.ts` implement all of the above identically, per that file's
    existing sync requirement.

## API Surface (additions/changes to `.orchestration/api-contract.yaml`)
- `POST /api/job/:id/duplicate` — duplicate a Job and its current CV attachments; `201` with the
  new Job.
- `GET /api/job/:id/resumes` — list CVs attached to a Job (candidate name/email, file name, attached
  date).
- `POST /api/job/:id/resumes` — body `{ resume_id }`; attach an existing CV to the Job; idempotent
  `200`.
- `DELETE /api/job/:id/resumes/:resumeId` — detach a CV from the Job (and cascade its Matches for
  that pair, per Open Question 3); `204`.
- `POST /api/resume` — `job_id` becomes optional in the multipart body; when present, behaves as
  before (create + auto-attach).
- `GET /api/resume/:id/file` — streams the raw file with its original `mime_type`; `?download=1`
  sets `Content-Disposition: attachment`, otherwise `inline` (for preview).
- `PUT /api/resume/:id/file` — multipart, replaces the file (re-extracts `content`, updates
  `file_name`/`mime_type`/`file_data`); visible immediately to every attached Job.
- `GET /api/resume` (list, no `job_id` filter) — each item gains a `jobs: { id, title }[]` field.
- The Frontend Agent owns the actual contract file update, per `.agents/frontend/AGENT.md` Step 4;
  this section is the spec for that update.

## Frontend Changes
- `pages/JobsListPage.vue`: add a **Duplicate** action per row (calls duplicate, refreshes list) and
  a **Manage CVs** action opening the new popup.
- New `components/JobCvsModal.vue` — popup for a single Job:
  - Lists attached CVs (candidate, file name, attached date) with **Detach** and **Download**
    actions per row.
  - An **Attach CV** control (select from CVs not yet attached to this Job) at the top.
  - Clicking a CV row shows a preview pane in the same popup (PDF inline via `<iframe>`/`<embed>`;
    DOCX shows the extracted `content` as text) — per Open Questions 4 and 5.
- `pages/CvsListPage.vue`: replace the single "belongs to Job" column with a list of attached-Job
  badges (now many-to-many); add a **Replace file** action (file input, re-uploads in place) next to
  the existing Delete/Remove action.
- `lib/api.ts`: add `duplicateJob`, `listJobResumes`, `attachResumeToJob`, `detachResumeFromJob`,
  `getResumeFileUrl(id, { download })`, `replaceResumeFile`.
- `types/index.ts`: `Resume`/`ResumeWithCandidate` — drop `job_id`, add `jobs: { id: string; title:
  string }[]`.
- Tests for `JobCvsModal.vue` (list, attach, detach, preview-on-click, download link) and the
  `CvsListPage.vue`/`lib/api.ts` changes, per `.rule/testing-rules.md`.

## Backend Changes
- `schema.sql`: drop `resume.job_id`/its index, add `resume.file_data bytea not null`, add
  `job_resume` table + index (as above).
- `routes/job.ts`: add `POST /:id/duplicate`, `GET /:id/resumes`, `POST /:id/resumes`, `DELETE
  /:id/resumes/:resumeId`.
- `routes/resume.ts`: make `job_id` optional on `POST /`; add `GET /:id/file`, `PUT /:id/file`;
  extend list/get responses with `jobs`.
- `routes/match.ts`: validate the `(resume_id, job_id)` pair has a `job_resume` row before scoring;
  `400`/`404` per `.rule/error-handling-rules.md` if not attached.
- `store/types.ts`, `store/memory-store.ts`, `store/pg-store.ts`: the additions listed above.
- Tests per `.rule/testing-rules.md`: happy path + validation failure (attach a nonexistent CV,
  detach something not attached → `404`, download/replace on a missing resume → `404`, match
  attempted on an unattached pair → `400`) for every new/changed route.

## Tickets
Linear is unavailable this session (see Assumptions), so tickets are written as local files:
- `.orchestration/tickets/frontend-job-cv-attach-preview.md`
- `.orchestration/tickets/backend-job-cv-attach-preview.md`

## Steps
1. Backend: schema migration (`job_resume` table, `resume.job_id` drop, `resume.file_data` add) →
   store interface + both implementations → routes (duplicate, attach/detach, file
   download/replace, optional `job_id` on upload, match-pair validation) → tests.
2. Frontend: `api.ts` + `types/index.ts` changes → `JobCvsModal.vue` → wire Duplicate/Manage CVs
   into `JobsListPage.vue` → Replace-file + attached-Job badges in `CvsListPage.vue` → tests.
3. `.orchestration/api-contract.yaml` updated to match (frontend agent, per its Step 4).
4. QA pass across both, plus a manual smoke test (see Validation).

## Validation
- `npm test` and `npm run typecheck` pass in both `backend/` and `frontend/`.
- Manual smoke test: create a Job A, upload CV X to it → duplicate Job A into Job B, confirm CV X
  shows attached to both → open Job B's "Manage CVs" popup, attach an existing CV Y (uploaded
  Job-less from `/cvs`), download X from the popup, click to preview X (PDF renders inline; if X is
  DOCX, text preview shows) → detach CV X from Job A, confirm Job A no longer lists it and its
  Job A Matches are gone, while Job B still has it → on `/cvs`, replace CV Y's file, confirm the new
  file downloads correctly from any Job Y is still attached to → remove CV Y entirely, confirm it
  disappears from every Job's popup.

## Risks
- **Reversing `.plan/004-*`'s one-to-many model one day later** touches the same tables twice in
  quick succession. Mitigated by this being pre-production (no real data to migrate) and by stating
  the reversal explicitly in Open Question 1 rather than silently overwriting it.
- **Storing raw file bytes in Postgres (`bytea`)** grows row size and has no size cap beyond the
  existing 5MB upload limit in `routes/resume.ts`. Acceptable at current scale; revisit with
  object storage (e.g., S3) if upload volume grows.
- **Detach cascading Matches is destructive and silent once confirmed.** Mitigated the same way
  `.plan/004-*` mitigated Job/CV delete: the frontend names what will be removed before the detach
  call fires.
- **Match-pair validation is app-level, not a DB constraint** — a future direct-DB write could create
  an orphaned Match. Acceptable since all current writes go through the API layer; flagged for
  awareness, not blocking.

## Rollout Order
1. Backend (schema → store → routes → tests) — additive/replacing, no frontend breakage since
   nothing calls the new endpoints yet and old `job_id`-filtered reads are being replaced together
   with their only caller.
2. Frontend (contract update → api.ts → `JobCvsModal.vue` → page wiring → tests).
3. QA pass over the full flow.

## Rollback
- All work lands as normal commits on the current branch (`feat/recruiting-platform`), consistent
  with `.plan/003-*` and `.plan/004-*`'s precedent. `git revert` on the relevant commit(s) recovers
  prior behavior if any step needs to be undone.
