Status: done
Owner: Ilana
Last updated: 2026-08-10

## Addendum — 2026-08-10 (post-QA revision)
Two QA findings (UTC/local date divergence, filter bar visible during loading/error) were
fixed directly. After that, the human reviewer requested a UI revision to the filter bar
itself, before approving:
- Collapse the two date-range inputs (`dateFrom`/`dateTo`) into a single "Job creation date"
  filter — exact-day match against `job.created_at`'s local calendar date
  (`localDateKey`), not a range.
- Drop the `.card` wrapper around the whole bar. New layout: a full-width search input (title
  search) with a left-aligned search icon as its own row, and a second row below it —
  Location, Job creation date, and (Candidate-only) Applied — styled with a background color
  distinguishable from the card list below it.
- The search input's border and its icon both change color on focus (the global `input:focus`
  border-color rule in `base.css` already does this for the input; the icon needs a matching
  focus-linked color change, e.g. via a `group`/`group-focus-within` wrapper).
This addendum is implementation detail, not a scope change — see Steps 3 and 8 as revised
below.

## Goal
On the Jobs route (`JobsListPage.vue`), any user can search jobs by title and location and
filter by posting date, and a Candidate can additionally filter to "jobs I've applied to" /
"jobs I haven't" — where "applied to" means the Candidate has at least one of their own CVs
attached to that job. The search/filter bar sits directly below the "Jobs" heading and matches
the app's existing Tailwind card/utility styling.

## Scope
In scope:
- **Schema**: `job` has no `location` column today (only `title`, `description`,
  `created_at`) — add `job.location text null` (see Open Question 1 for required-vs-optional
  and the backfill story for existing jobs).
- `backend/schema.sql`: add the column (`create table` definition plus a standalone
  `alter table if exists job add column if not exists location text` for an already-running
  dev database, per `.rule/database-rules.md` — same pattern `resume.owner_user_id` used).
- `backend/src/store/types.ts`: add `location: string | null` to `Job`; add
  `location?: string | null` to `CreateJobInput`; add `location?: string | null` to
  `UpdateJobInput`.
- `backend/src/store/{memory-store,pg-store}.ts`: thread `location` through `createJob`,
  `updateJob`, `duplicateJob` (a duplicate carries over the source job's location, same as
  title/description do today).
- `backend/src/routes/job.ts`: `POST /` and `PATCH /:id` accept an optional `location` string
  in the body (empty-string treated as `null`, not rejected — see Open Question 1).
- No new search/filter query parameters on `GET /api/job` — the full org's job list is already
  loaded client-side today (`JobsListPage.vue`'s `load()`), and search/filter is applied over
  that already-fetched list, matching how `cvCount`/ownership filtering already work
  client-side in this file. See Open Question 2 for why this doesn't scale-guard against a
  large org, and why that's fine for now.
- `frontend/src/types/index.ts`: add `location: string | null` to `Job`.
- `frontend/src/components/JobForm.vue`: add an optional "Location" text input alongside
  Title/Description, sent as part of `createJob`.
- `frontend/src/pages/JobsListPage.vue`:
  - Edit form: add the same optional Location input, sent as part of `updateJob`.
  - Job card: show the location (when set) alongside the existing title/description/CV-count/
    created-date display.
  - New search/filter bar directly below the `<h1>Jobs</h1>` heading: a text input for
    title search, a text input for location search, a from/to date-range pair for posting
    date, and (Candidate role only) an Applied/Not applied/All three-way filter. All filters
    combine with AND; all are client-side over the already-loaded `jobs`/`resumes` refs.
- Tests: `backend/tests/job.test.ts` — `location` persists through create/update/duplicate,
  and is `null` when omitted. `frontend/tests/JobForm.test.ts` — the Location field submits
  correctly (and correctly omits/nulls when left blank). `frontend/tests/JobsListPage.test.ts`
  — title search, location search, date-range filter, and (mocked as Candidate) the
  applied/not-applied filter, each narrowing the rendered job list as expected; combining two
  filters narrows further (AND, not OR).

Out of scope:
- Server-side/paginated search — see Open Question 2.
- A structured location model (city/state/country/remote flag, geocoding, `lat`/`lng` per
  `.doc/glossary.md`'s naming convention) — the backlog text just says "search... by...
  location," which a free-text field with substring matching satisfies; a structured model is
  a bigger, unrequested feature.
- Any change to how a Candidate "applies" to a job — this repo has no application/apply action
  today; "applied to" is defined here purely as "has a CV of mine attached to this job," reusing
  the existing attach relationship and `.plan/011-2026-08-09-candidate-job-cv-visibility.md`'s
  already-ownership-scoped `cvCount` logic. No new domain concept is introduced.
- Recruiter/Admin seeing an "applied" filter — doesn't apply to a role that doesn't own CVs in
  the personal sense a Candidate does; see Open Question 3.

## Assumptions
- **This task requires backend work despite the backlog not carrying a `stack:full` tag**,
  same reason as every prior task this session: `location` doesn't exist anywhere in the
  schema/types/routes today, and a search bar that only pretends to filter by location without
  the data existing isn't the feature that was asked for. Proceeding as full-stack, flagged
  per the established pattern.
- "Date" in "search for jobs by name, location and date" means the job's posting date
  (`created_at`) — the only date-shaped field a job has. There's no separate "deadline" or
  "start date" concept anywhere in this domain.
- "Jobs he has applied to" reuses the attach relationship (`job_resume`) scoped to the
  Candidate's own resumes (`resume.owner_user_id`), not a new "application" entity — consistent
  with this product's actual domain model, where a CV attached to a job *is* the candidacy
  signal.

## Open Questions
1. **Is `location` required on job creation, or optional?** Making it required would force a
   value onto every new job and orphan the "location" field on every job created before this
   change (`null`, with no backfill — no production data exists yet, so nothing to migrate).
   **Recommended:** optional/nullable, same treatment as `resume.owner_user_id`'s null-means-
   "not set" pattern — a job card simply omits the location line when it's `null`, and an
   empty search term matches everything (doesn't exclude jobs with no location).
2. **Client-side filtering only, no backend query params — is that acceptable long-term?**
   `JobsListPage.vue` already loads the entire org's job list unpaginated (`listJobs(org_id)`
   with no limit), so client-side filtering doesn't add a new scaling ceiling — it's already
   there. **Recommended:** yes, keep it client-side; adding `GET /api/job?search=&location=`
   query params would be premature optimization for a demo-scale org with no pagination
   anywhere else in the app yet, and would need to be built and tested twice (server-side
   filter logic plus client-side still needed for offline/instant feedback as the user types).
3. **Should the Applied/Not-applied filter render for Recruiter and Admin too, just always
   showing "All" since they didn't personally attach anything?** The backlog text says "filter
   for jobs he has applied to" — "he" reads as the Candidate specifically ("the User" earlier
   in the same sentence is a generic "the user of the app," but "applied to" only makes sense
   for someone who can own a CV). **Recommended:** show the Applied/Not-applied control only
   for Candidate role; Admin/Recruiter get the title/location/date filters only, no confusing
   "applied" toggle for a concept that doesn't describe them.

Proceeding with the recommended answers on all three unless told otherwise.

## Steps
1. **Schema**: add `location text null` to `job`'s `create table` definition in
   `backend/schema.sql`, plus `alter table if exists job add column if not exists location text`
   immediately after (mirroring the existing `resume.owner_user_id` alter-table line).
2. **Store types**: add `location: string | null` to `Job`; `location?: string | null` to
   `CreateJobInput` and `UpdateJobInput` in `backend/src/store/types.ts`.
3. **`memory-store.ts`**: `createJob` includes `location: input.location ?? null`; `updateJob`
   applies `location` the same conditional-spread way `title`/`description` already are;
   `duplicateJob` copies `job.location` onto the new row.
4. **`pg-store.ts`**: `createJob`'s insert adds `location` as a fourth column/parameter;
   `updateJob`'s dynamic `fields`/`values` builder adds a `location` branch identical in shape
   to the existing `title`/`description` branches; `duplicateJob`'s insert copies `job.location`.
5. **`backend/src/routes/job.ts`**: `POST /` and `PATCH /:id` — accept `location` from the
   body; treat `undefined` as "not provided" (existing value / `null` on create) and an empty
   string as `null` (don't store `''` — normalize to `null` before passing to the store), no
   `ValidationError` for a missing/empty location since it's optional.
6. **Frontend types**: add `location: string | null` to `Job` in `frontend/src/types/index.ts`.
7. **`JobForm.vue`**: add a `location` ref and an optional "Location" `<input>` between Title
   and Description (or after Description — match whichever reads better in the existing card
   layout), included in the `createJob` call.
8. **`JobsListPage.vue`**:
   - Edit form: add the same Location input, included in `saveEdit`'s `updateJob` call.
   - Job card display: below the title/description line, show location when set (e.g. a small
     `list-badge`-styled span, consistent with the existing CV-count badge's styling).
   - New search/filter bar: a `<div class="card flex flex-wrap items-center gap-3">` (or
     similar, matching existing card styling) directly below the `<h1>Jobs</h1>` heading,
     containing: a title-search `<input>`, a location-search `<input>`, two `<input type="date">`
     for a from/to posting-date range, and — `v-if="user?.role === 'candidate'"` — a three-way
     Applied/Not applied/All control (e.g. a `<select>` or a small button group, matching
     existing control styling elsewhere in this file).
   - Computed filtering: a `filteredJobs` computed wrapping the existing `jobs` ref — title
     match is case-insensitive substring on `job.title`; location match is case-insensitive
     substring on `job.location` (jobs with `location: null` never match a non-empty location
     search term); date-range match is `job.created_at`'s date falling within
     `[dateFrom, dateTo]` inclusive when either bound is set; applied/not-applied uses
     `cvCount(job.id) > 0` (already ownership-scoped for Candidate per `.plan/011-...md`).
     Render the existing `<ul>` over `filteredJobs` instead of `jobs`.
9. **Tests**: per Scope's Tests bullet above.
10. **Docs**: add `location` to `.doc/architecture.md`'s `Job`/`job` mentions (the ASCII
    diagram's data flow doesn't need touching; the schema/type mentions do) and a Change Log
    entry.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: create three jobs with different titles, locations, and
  (implicitly, by creation order) dates; as Recruiter/Admin, confirm title search, location
  search, and date-range filters each narrow the list correctly and combine with AND. As a
  Candidate who has attached a CV to exactly one of the three jobs, confirm the Applied filter
  shows only that job and Not-applied shows the other two; confirm Recruiter/Admin never see
  the Applied/Not-applied control.

## Risks
- Free-text location search only does substring matching — "NYC" won't match a job whose
  location is "New York City." Acceptable for this scope (Open Question 2's structured-model
  alternative was explicitly deferred); a future task could add normalization if this proves
  annoying in practice.
- The `PATCH /:id` empty-string-normalizes-to-`null` behavior for `location` needs a test,
  since it's a small, easy-to-miss branch (unlike `title`/`description`, which reject an empty
  string outright today).

## Rollout Order
1. Backend ticket (schema, store, route) lands first — the frontend form fields and filter
   logic depend on `location` actually existing in API responses.
2. Frontend ticket (forms, job card, search/filter bar) applies once the backend returns
   `location`.
3. QA runs last, covering both the new field's CRUD path and the filter-combination logic.

## Rollback
Revert the commits touching `backend/schema.sql`, `backend/src/store/**`,
`backend/src/routes/job.ts`, `frontend/src/types/index.ts`,
`frontend/src/components/JobForm.vue`, and `frontend/src/pages/JobsListPage.vue`. Drop the
`job.location` column if already applied to a dev database. No production data exists yet, so
no data-migration rollback is needed.
