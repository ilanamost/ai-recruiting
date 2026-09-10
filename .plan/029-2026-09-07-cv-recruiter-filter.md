Status: done
Owner: orchestrator
Last updated: 2026-09-07

# Recruiter CV filters — experience level, skills, and a top-5 best-match star

> **Revised 2026-09-07 after approval-gate feedback.** The first draft put the experience and
> skills filters on the standalone CVs page (`CvsListPage.vue`) and proposed reversing
> `.plan/015-2026-08-10-hide-cvs-route-recruiter.md` so recruiters could reach it. That was
> rejected: the CVs page stays hidden from recruiters, `.plan/015` stands untouched, and all
> filtering happens inside the "Manage CVs" dialog (`JobCvsModal.vue`) instead — the same place
> the best-match star already lives. See Open Question 1 for the recorded decision, and the
> Scope note on what that removed from the backend.
>
> **Amended 2026-09-07, post-QA/post-merge, after live use in the browser.** Two changes made
> after this plan shipped and QA passed:
> 1. A CSS cascade-layer bug (unrelated to this plan's logic — a pre-existing global `button`
>    reset in `frontend/src/styles/setup/reset.scss` was unlayered and so beat the
>    `@layer utilities`-scoped Tailwind classes this plan's `FilterTabs.vue`/skill chips
>    introduced, the first place in the app either sat directly on a `<button>`) made the
>    selected filter tab and skill chip invisible despite working correctly underneath. Fixed by
>    wrapping the reset in `@layer base`.
> 2. **Open Question 2's binary star rule is superseded.** Using the feature surfaced that a
>    single star for all of the top 5 wasn't useful enough — the best-match star is now
>    **graduated**: the top-scoring attached CV shows 5 stars, 2nd-best 4, 3rd 3, 4th 2, 5th 1,
>    6th-and-below none. **Ranked by distinct score value (dense ranking), not by CV position**
>    — tied CVs share a star count, matching the spirit of the old "everyone at the cutoff stars"
>    binary rule: dedup one score per resume, take the distinct scores descending, and the top
>    five distinct values become tiers 5/4/3/2/1; every resume holding one of those scores gets
>    that tier's count. Two consequences, both intentional: more than five CVs can be rated when
>    scores tie (e.g. six CVs tied for best all show 5 stars), and fewer than five tiers can be in
>    use when there are fewer than five distinct scores overall (tiers are distinct-score slots,
>    not backfilled to always use all five). Open Question 3's invariant (the star must rank over
>    ALL attached CVs, never the filtered set) is unchanged and still holds, now asserted at the
>    level of exact star count rather than set membership. Implemented in
>    `frontend/src/components/JobCvsModal.vue` (`starCountsByResumeId`/`starCountFor`), tests in
>    `frontend/tests/JobCvsModal.test.ts` and `JobCvsModal.adversarial.test.ts`. See
>    `.orchestrate/frontend-agent-report.md`'s post-QA section for full detail, including two
>    dedup tests the rework found had gone toothless under dense ranking (fixed and verified by
>    mutation testing).

## Goal
Make CV screening useful to a recruiter, per the backlog item "Make the applocation more usefull
for recruiters" (`.plan/000-backlog.md`). Three related capabilities, all inside a job's "Manage
CVs" dialog:

1. **Experience-level filter** — a clickable Junior / Mid / Senior tab strip that narrows the
   job's attached CVs to applicants at that level, where the level is derived from the number of
   years the applicant has worked in the industry.
2. **Top-5 best-match stars** — the yellow star introduced by
   `.plan/021-2026-08-11-best-match-star.md` currently marks only the single highest-scoring CV
   for a job. It should mark the five most compatible CVs instead.
3. **Skills filter** — narrow the list to applicants who have the skills a recruiter is looking
   for.

The skills and years-of-experience data is derived from the applicants' own CVs, so this plan
also introduces the step that produces it. `.doc/glossary.md` already reserves a canonical name
for that step — **analysis** ("extracts structured signal (skills, experience, education) from a
`resume`'s extracted text, ahead of scoring"), distinct from **extraction** (the mechanical
file-to-text step). This plan implements the analysis step that the glossary and
`.doc/product-definition.md`'s "structured criteria breakdown (skills matched/missing,
experience gap) may be added once the basic loop is validated" both already anticipate. No new
domain vocabulary is invented.

## Scope

### The scope call: still full stack, but for two reasons now, not three
`stack:full` is absent from the backlog entry, so the mechanical default in `AGENTS.md` and the
`writing-plans` skill would be frontend-only. **Overriding that, explicitly**, in the manner
`.plan/009-2026-08-08-candidate-cv-ownership-scoping.md` established and `.plan/013` and
`.plan/021` followed. The first draft gave three reasons; scoping the filter to the modal
retires one of them, and it is worth being precise about which:

- **The data does not exist. (Still holds — this alone forces backend work.)**
  `backend/src/store/types.ts`'s `Resume` has `id`, `candidate_id`, `file_name`, `mime_type`,
  `content`, `created_at`, `owner_user_id` — no skills, no years of experience, no level.
  `backend/schema.sql` has no such columns, and `backend/src/` contains no code that derives
  structured signal from resume text: the only LLM call in the repository is
  `backend/src/scoring/index.ts`'s `scoreMatch`, which returns `{ score, explanation }` and
  nothing else. A filter over data that does not exist cannot be built frontend-only.
- **Deriving the data per read is not viable. (Still holds — this forces persistence, not just
  an endpoint.)** Reading years-of-experience and skills out of resume text is an LLM call (that
  is what `analysis` means in the glossary). Doing it whenever the dialog opens would mean N
  Claude calls per open, at real cost and multi-second latency, with results that could drift
  between two opens of the same dialog — directly against `.doc/product-definition.md`'s "Score
  consistency" and "Cost per screen" success metrics. So the analysis is computed once on write
  and stored.
- **~~The list is already paginated server-side.~~ (No longer applies.)** That reason was about
  `GET /api/resume`, which `.plan/028-2026-09-06-pagination-cvs-jobs.md` moved to a
  `{ items, total, page, limit }` envelope — filtering that client-side would filter one page
  and make `total` lie. The modal does not use that endpoint. It reads
  `jobStore.listJobResumes(job.id)` → `GET /api/job/:id/resumes` →
  `store.listResumesForJob(job_id)`, which returns **one job's attachments, unpaginated, in
  full**, and the dialog has no pager. So the set being filtered is already complete in the
  browser, and filtering it client-side is both correct and simplest.

**What that removes from the backend.** Because the filter no longer runs against a paginated
query, the backend does **not** need `level`/`skill` query params on `GET /api/resume`, a
`ResumeFilter` type, a filtered `listResumes` signature, or a `count(*)` that agrees with a
filtered page. Those are all dropped from the first draft. The backend's remaining job is to
*produce and return* the data; the modal does the filtering. Concretely dropped: `ResumeFilter`,
`listResumes(params, filter)`, `Store.listSkills()`, the `GET /api/resume/skill` route, and
`backend/src/lib/experience.ts` (no backend code translates a level to a years range any more,
so that module would have had no caller — the band boundaries live on the frontend only, and are
documented in `.doc/glossary.md` so the definition stays discoverable).

**Where the skill picker's options come from.** With no `GET /api/resume/skill` route, the
picker is populated from the union of skills across the CVs attached to *this* job, computed in
the modal. This is not merely the cheaper option — it is the better one: a recruiter filtering
one job's applicants should only be offered skills that actually appear among those applicants.
A global skill list would offer options that match zero rows in the dialog they are standing in.

In scope:

**Backend — schema**
- `backend/schema.sql`: `resume.years_experience integer null` plus a `resume_skill` table
  (`resume_id uuid references resume(id) on delete cascade`, `skill text not null`, primary key
  `(resume_id, skill)`), each with the standalone `alter table if exists` / `create table if not
  exists` treatment the file already uses for `job.location` and `resume.owner_user_id`, per the
  `database-schema` skill. Index: `resume_skill_skill_idx on resume_skill(skill)`. (The first
  draft's `resume(years_experience)` index is dropped — nothing queries on that column any more;
  filtering is client-side.)
- **`experience_level` is deliberately not a column.** `years_experience` is the fact; the
  Junior/Mid/Senior band is a presentation rule over it. Persisting the band as well would mean
  a data migration every time the boundaries are tuned (Open Question 4), and would let the two
  drift out of sync.

**Backend — analysis** *(unchanged from the first draft)*
- `backend/src/analysis/index.ts` (new, sibling of `scoring/` and `extraction/`):
  `analyzeResume(resumeText: string): Promise<ResumeAnalysis>` where `ResumeAnalysis` is
  `{ years_experience: number | null; skills: string[] }`. One Claude call, following the exact
  house pattern already in `backend/src/scoring/index.ts` — `messages.create` with
  `output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA }, effort: 'low' }`,
  a `stop_reason === 'refusal'` guard, `JSON.parse` of the text block, and a defensive
  shape/range check before returning. Model from `process.env.ANALYSIS_MODEL ?? 'claude-sonnet-5'`,
  mirroring `SCORING_MODEL`'s shape. **Do not pass `budget_tokens`** — it is rejected with a 400
  on this model generation; `effort` is the control.
- Skills are normalized before persisting: trimmed, lowercased, de-duplicated, and capped
  (Open Question 5). `years_experience` is clamped to a sane range and rounded.
- **A failed analysis must never fail the upload.** Per the `error-handling` skill, the
  `analyzeResume` call is wrapped so an `UpstreamError` (or any failure) leaves
  `years_experience` null and skills empty, logs the failure without the resume text (PII — see
  `.rule/security-rules.md`), and lets the upload succeed. An unanalyzed CV is "unclassified",
  not a broken upload.

**Backend — store and routes**
- `backend/src/store/types.ts`: `years_experience: number | null` and `skills: string[]` on
  `Resume`; `years_experience`/`skills` on `CreateResumeInput`. Because `ResumeWithCandidate
  extends Resume` and `JobResume extends ResumeWithCandidate`, putting the fields on `Resume`
  gives the modal's `listResumesForJob` path what it needs without a second, divergent resume
  shape — the alternative (fields only on `JobResume`) would mean two resume types that disagree
  about what a resume is. No `ResumeFilter`, no signature change to `listResumes`, no
  `listSkills`.
- `memory-store.ts` / `pg-store.ts`: persist skills/years on create, replace them on file
  replace, and include both on every read path that returns a resume shape. In `pg-store.ts` the
  skills come from an aggregated `array_agg` subquery in the shared resume-shaping query, so
  `listResumesForJob` and `listResumes` stay one query each rather than N+1.
- `backend/src/routes/resume.ts`: wire analysis into `POST /` and `PUT /:id/file`, wrapped so a
  failure degrades to unclassified rather than failing the request. No new routes, no new query
  params.
- `backend/src/routes/job.ts`: **no change.** `GET /:id/resumes` already returns
  `listResumesForJob`'s rows and already list-narrows for Candidate at lines 166–167
  (`.plan/011-2026-08-09-candidate-job-cv-visibility.md`); the new fields ride along on the
  existing shape.

**Frontend**
- `frontend/src/types.ts`: `years_experience: number | null` and `skills: string[]` on `Resume`;
  an `ExperienceLevel` type.
- `frontend/src/lib/experience.ts` (new): the Junior/Mid/Senior labels and boundaries, plus
  `yearsToLevel(years)`. The single source of truth for the bands.
- **No change to `frontend/src/lib/api.ts` or `frontend/src/stores/{resume,job}.ts`** — no new
  routes, no new request params. The new fields arrive on the existing `GET /api/job/:id/resumes`
  response and flow through the existing store untouched once the type is updated. (This is the
  clearest signal that scoping the filter to the modal was the smaller change.)
- `frontend/src/components/FilterTabs.vue` (new): a presentational, `v-model`-style tab strip —
  `role="tablist"`, one `role="tab"` button per option with `aria-selected`, styled with
  Tailwind utilities and existing tokens. Still worth its own component even with a single call
  site: `JobCvsModal.vue` is already 456 lines with a nested preview overlay, and this keeps the
  filter UI independently unit-testable rather than only reachable through the modal's full
  mount. Same reasoning that gave `.plan/028` its `Pager.vue`. This is the first tab pattern in
  the app — `grep` for `role="tab"` across `frontend/src` returns nothing, so there is no
  existing pattern to match.
- `frontend/src/components/JobCvsModal.vue`:
  - A compact filter row between the attach control and the attached-CV list: the `FilterTabs`
    strip (All / Junior / Mid / Senior) and a skills picker, in the same `bg-bg rounded-md p-3`
    filter-strip treatment `CvsListPage.vue` and `JobsListPage.vue` already use, so the dialog
    reads as part of the same app. Kept to one row — the dialog is `max-w-4xl` with a
    `max-h-[85vh]` scrolling list, so vertical space spent on filters is space taken from the
    list.
  - Gated to Admin and Recruiter, reusing the same condition as the existing `canSeeBestMatch`.
    A Candidate already sees only their own CVs here (`backend/src/routes/job.ts:166-167`, per
    `.plan/011`), so a filter over a one-row list would be noise.
  - A `filteredResumes` computed over `attachedResumes`; the list renders from it. Level and
    skills combine with AND (Open Question 6), and both AND with each other.
  - A distinct "no CVs match these filters" empty state, separate from the existing "No CVs
    attached yet", mirroring `JobsListPage.vue`'s "No jobs match your filters".
  - `bestMatchResumeIds` changes from "resumes tied at the single top score" to "the top five"
    (Open Question 2), computed over **all** attached resumes regardless of the active filter
    (Open Question 3).

**Docs**
- `.doc/glossary.md`: add **skill** and **experience level** (including the band boundaries)
  under Domain Entities, and note that **analysis** is now implemented (it is currently defined
  but unbuilt).
- `.doc/architecture.md`: the `analysis` module, the schema additions, the new response fields,
  and a Change Log entry.
- `.doc/product-definition.md`: its Product Scope currently lists "Ranking or comparing
  candidates against each other" as out of scope "until that is explicitly extended". A top-5
  shortlist is exactly that extension, and this backlog item is the explicit request — so that
  line needs updating rather than quietly contradicting.

Out of scope:
- **Any change to `CvsListPage.vue`, `frontend/src/router/index.ts`, or `NavBar.vue`.**
  `.plan/015-2026-08-10-hide-cvs-route-recruiter.md` stands exactly as-is: recruiters keep no
  CVs nav link and keep the `/cvs` → `/jobs` redirect. Per the approval-gate decision recorded
  in Open Question 1.
- Moving `JobsListPage.vue`'s title/location/date filters server-side, or adding filters to the
  paginated `GET /api/resume` list. `.plan/028` Open Question 1 parked the former; the latter is
  no longer needed by anything.
- Re-analyzing existing CVs on read, or a background re-analysis queue (Open Question 7 covers a
  one-off backfill instead).
- Editing an applicant's skills or years by hand. The backlog says the data "will come from the
  applicants Cvs'" — a manual override is a different feature.
- Education, seniority-by-title, or any other structured signal the glossary's `analysis` entry
  mentions. Only what these three sub-requirements need.

## Assumptions
- **Full stack despite the missing `stack:full` tag**, for the two reasons set out in Scope
  above (the data exists nowhere in schema, types, or code; and per-read LLM derivation is too
  slow, too costly, and too inconsistent, which forces write-time persistence). Flagged
  explicitly rather than silently planned, per the precedent set in
  `.plan/009-2026-08-08-candidate-cv-ownership-scoping.md`'s Assumptions and repeated in
  `.plan/013` and `.plan/021`. The third reason from the first draft (server-side pagination) no
  longer applies and has been struck rather than left in place.
- **"5 most compatible users cvs" means the existing per-job star, widened from 1 to 5.** The
  backlog's "currently there is only one" pins this: the only star in the app today is
  `JobCvsModal.vue`'s, which marks the top-scoring CV attached to one job (`.plan/021`).
  "Compatible" is `match.score`, the app's only compatibility measure.
- **Analysis runs once, at upload time** (and again on file replace), persisted to the database.
  This is what makes the data stable and cheap to read. It also matches
  `.doc/product-definition.md`'s stated assumption that a single job is matched against many
  resumes far more often than the reverse — read-heavy data should be computed on write.
- **Years of industry experience is what the CV says it is.** The analysis step reads the
  applicant's own work history. A CV that states no dated work history yields `null`, which
  means "unclassified", not zero — a career-changer with an undated CV must not be silently
  labelled Junior.
- Skills matching is exact-match on normalized (trimmed, lowercased) strings. "React" and
  "react" are the same skill; "React" and "React.js" are not. Same limitation `.plan/013`
  accepted for job location, and acceptable for the same reason — a synonym model is a larger,
  unrequested feature.

## Open Questions

1. **Where do the filters live?** — **Resolved at the 2026-09-07 approval gate.** The first
   draft recommended putting them on the CVs page and reversing `.plan/015` so recruiters could
   reach it. **Rejected:** "Cvs page should remain hidden from recruiters. I want the filtering
   to be done in the manage cvs' dialog." So the filters go in `JobCvsModal.vue`, scoped to one
   job's attached CVs, and `.plan/015` is untouched — no router change, no nav-link change, no
   addendum to that plan. Recorded here rather than deleted, because it explains why this plan's
   backend surface is much smaller than a "filter the CVs list" feature would suggest, and why
   `.plan/015` should not be re-litigated by a future task.
2. **How is "top 5" chosen, and what about ties?** `JobCvsModal.vue` already holds the complete
   set it ranks over — `matchStore.listLatestMatchesForJob(job.id)`, which `.plan/021` built
   precisely so every attached resume's latest score for that job arrives in one response — so
   no resume's rank depends on data the browser has not fetched. **Recommended:** sort by score
   descending, take the fifth-highest score, and star every resume scoring at or above it. Ties
   at the boundary all star, so six CVs tied on the 5th-place score all get one (possibly more
   than five stars) — consistent with `.plan/021`'s existing tie rule, and better than
   arbitrarily dropping one of two identical scores. Fewer than five scored resumes means every
   scored resume stars; zero scored means no star, unchanged.
3. **Does the top-5 star recompute within the filtered set?** New question, created by putting
   the filter and the star in the same list. If a recruiter filters to "Senior", should the star
   mark the top 5 Seniors, or stay on whichever of the job's overall top 5 happen to be Senior?
   **Recommended: rank over all attached resumes, then render the star on whichever rows survive
   the filter.** "This CV is one of the five best matches for this job" is a property of the CV
   and the job, not of whatever the recruiter is currently looking at. Recomputing per filter
   would silently change what the star *means* as tabs are clicked — filter to Senior and the
   5th-best Senior (perhaps a mediocre match overall) would light up identically to the job's
   actual best match. It would also mean a CV gains and loses its star purely by toggling a
   filter, which reads as a bug. Consequence to accept: a filtered view can show fewer than five
   stars, or none — correct, and less misleading than a star that re-ranks under the recruiter's
   feet.
4. **Where are the Junior / Mid / Senior boundaries?** The backlog says to decide the level "by
   the amount of years he/she is working on the industry" but gives no bands.
   **Recommended:** Junior 0–2 years, Mid 3–5, Senior 6+ — the most common industry reading, and
   the boundaries live in one module (`frontend/src/lib/experience.ts`) precisely so this is
   cheap to re-tune. A CV with `years_experience === null` matches no level tab and appears only
   under "All" (see Open Question 7).
5. **How many skills should analysis keep per CV, and how are they normalized?** Unbounded,
   unnormalized output would make the picker unusable. **Recommended:** cap at 30 per CV,
   trimmed, lowercased, de-duplicated, each at most 50 characters, with the prompt asking for
   concrete technical and professional skills rather than soft-skill filler. Displayed
   capitalized in the UI.
6. **Do multiple selected skills combine with AND or OR?** A recruiter picking "react" and
   "typescript" is almost always looking for someone with both. **Recommended: AND** —
   consistent with how `JobsListPage.vue`'s existing filters combine ("All filters combine with
   AND"), and with the level filter, which also ANDs with the skills filter.
7. **What happens to CVs uploaded before this change?** They have no analysis, so
   `years_experience` is null and they have no skill rows — they would silently vanish from
   every filtered view. **Recommended:** treat null as "unclassified" (shows under "All", never
   under a specific level tab), *and* ship a one-off backfill script,
   `backend/scripts/backfill-resume-analysis.ts`, that analyzes existing resumes from their
   already-stored `content` (no re-upload needed, since extraction already ran). Run it once
   against the dev database after the migration. Same spirit as `.plan/009` Open Question 3's
   null-means-not-set handling, but with a backfill available here because, unlike ownership,
   the data is recoverable from what is already stored.

Question 1 is resolved. Proceeding with the recommended answers on 2–7 unless told otherwise;
Question 3 is the one that is genuinely new since the last review.

## Steps

**Backend**
1. **`backend/schema.sql`**: add `years_experience integer null` to `resume`'s `create table`
   plus a standalone `alter table if exists resume add column if not exists years_experience
   integer`; add the `resume_skill` table and its index, each `if not exists`, following the
   `database-schema` skill and the commenting style the `job.location` and `resume.owner_user_id`
   blocks already use.
2. **`backend/src/analysis/index.ts`** (new): `analyzeResume(resumeText)` per Scope — house
   pattern from `scoring/index.ts`, `output_config.format` json_schema, `effort: 'low'`, no
   `budget_tokens`, refusal guard, defensive parse, normalization and caps from Open Question 5.
3. **`backend/src/store/types.ts`**: `years_experience`/`skills` on `Resume`, and on
   `CreateResumeInput`. Nothing else — no `ResumeFilter`, no `listResumes` signature change, no
   `listSkills`.
4. **`backend/src/store/memory-store.ts`**: persist skills/years on create, replace them on file
   replace, and include both on every resume read path (`toResumeWithCandidate` is the single
   place that shapes them, so this is one change, not many).
5. **`backend/src/store/pg-store.ts`**: same, in SQL. `createResume` inserts the `resume_skill`
   rows in the same transaction as the resume; `replaceResumeFile` deletes and re-inserts them.
   Every resume read path picks up skills via an aggregated `array_agg` subquery in the shared
   shaping query — one query, not N+1.
6. **`backend/src/routes/resume.ts`**: call analysis in `POST /` and `PUT /:id/file`, wrapped so
   a failure degrades to unclassified (null years, no skills) rather than failing the request,
   and logs without the resume text.
7. **`backend/scripts/backfill-resume-analysis.ts`** (new): analyze every resume with no
   analysis yet, from its stored `content`. Idempotent, safe to re-run.
8. **Backend tests** (`writing-tests` skill): analysis normalization and caps; a refused/failed
   analysis still yields a 201 upload with null years and no skills, and logs no resume text;
   `GET /api/job/:id/resumes` returns `years_experience` and `skills` on each row; replace-file
   re-analyzes and drops the old skills; a resume with no skills returns `[]`, not null;
   deleting a resume cascades its `resume_skill` rows. Mock the Claude call — no test may hit
   the live API.

**Frontend**
9. **`frontend/src/types.ts`** and **`frontend/src/lib/experience.ts`** (new): the type
   additions, the band labels/boundaries, and `yearsToLevel`.
10. **`frontend/src/components/FilterTabs.vue`** (new): the presentational tab strip per Scope.
11. **`frontend/src/components/JobCvsModal.vue`**: the filter row (tabs + skills picker) gated to
    Admin/Recruiter; the skills picker's options computed as the union of skills across
    `attachedResumes`; a `filteredResumes` computed (level AND skills) that the list renders
    from; the filtered-empty state; and `bestMatchResumeIds` → the top-5 rule from Open
    Question 2, computed over all attached resumes rather than the filtered set per Open
    Question 3. Update the star's `aria-label` ("Best match for this job" → wording that fits
    five, e.g. "Top match for this job").
12. **Frontend tests**: `FilterTabs.test.ts` (selection, emitted value, `aria-selected`,
    keyboard focus); `JobCvsModal.test.ts` — filter behavior (a level tab narrows the list; the
    skills picker ANDs; level and skills AND together; the filtered-empty state renders; the
    picker offers only skills present among this job's attached CVs; Candidate sees no filter
    row) and star behavior (exactly five stars from six scored resumes; ties at 5th place all
    star; fewer than five scored stars all of them; zero scored stars none; **a starred CV keeps
    its star when a filter is applied, and the star does not move to a newly-top-ranked row
    within the filtered set** — the regression test for Open Question 3; Candidate still sees no
    star).
13. **`.orchestrate/api-contract.yaml`**: record the `years_experience`/`skills` response fields
    on the resume schema. No new routes or params to record. Authored by the Frontend Agent,
    which owns this file per `.claude/agents/frontend.md`; the Backend Agent reads it.
14. **Docs**: the `.doc/glossary.md`, `.doc/architecture.md`, and `.doc/product-definition.md`
    updates listed in Scope. **No `.plan/015` addendum** — that plan is untouched.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Live-database check, per the `database-schema` skill: `resume.years_experience` and the
  `resume_skill` table and index exist in the local Postgres dev database.
- **Level bands**, as Recruiter in a job's Manage CVs dialog with CVs spanning all three levels:
  a CV analyzed at 1 year appears under Junior only, 4 years under Mid only, 9 years under
  Senior only, and an unanalyzable CV appears only under "All".
- **Skills**: selecting two skills shows only CVs having both (AND, per Open Question 6);
  clearing the picker restores the full attached list; the picker's options are exactly the
  skills present among this job's attached CVs, with no duplicates and none that match zero rows.
- **Level AND skills combine**: selecting "Senior" plus a skill shows only Senior CVs with that
  skill.
- **Filtered-empty state**: a filter combination matching nothing shows "no CVs match these
  filters", distinct from the "No CVs attached yet" state seen when the job has no attachments.
- **Top-5 star**: attach six CVs to a job and score them with distinct scores — exactly the top
  five star, the sixth does not. Re-score so two CVs tie at the fifth-highest score — both star
  (six stars). Score only three — all three star. Score none — no star.
- **Star vs filter (Open Question 3)**: with the six-CV setup above, note which CVs are starred
  unfiltered, then apply a level filter — the surviving rows keep exactly the stars they had,
  and no unstarred row gains one. A filtered view showing fewer than five stars is correct.
- **Recruiter access is unchanged**: logged in as Recruiter, there is still no CVs nav link and
  `/cvs` still redirects to `/jobs` — `.plan/015`'s behavior is intact. The filters are reachable
  only through a job's Manage CVs dialog.
- **Candidate unchanged**: the dialog shows only the Candidate's own CVs, with no filter row and
  no star.
- **Upload resilience**: with the Claude API key unset or the analysis call forced to fail, an
  upload still succeeds (201), the CV appears as unclassified, and no resume text appears in the
  logs.
- **Backfill**: after running `backfill-resume-analysis.ts` against a database of pre-change
  CVs, those CVs carry skills and years and appear under the right tabs; a second run changes
  nothing.

## Risks
- **Analysis quality is not guaranteed.** An LLM reading years-of-experience out of free-text
  work history will sometimes be wrong — a gap year, an undated CV, contract work listed in
  parallel. A misfiled applicant is invisible to a recruiter filtering by level, which is a
  worse failure than a slightly-off match score. Mitigated by treating null as unclassified
  rather than guessing, and by the "All" tab always showing everyone. Worth a spot-check against
  real CVs during QA rather than trusting the schema alone.
- **Cost and latency move onto the upload path.** Every upload now makes a second Claude call.
  It is a small `effort: 'low'` call on the cheaper model tier, but uploads get slower and each
  costs marginally more — relevant to `.doc/product-definition.md`'s "Cost per screen" metric.
- **`JobCvsModal.vue` is getting large.** It is already 456 lines and owns the attach control,
  the attached list, the star, a nested preview overlay, and now a filter row. Extracting
  `FilterTabs.vue` helps; if review finds the file unwieldy, extracting the filter row wholesale
  (tabs + picker + the `filteredResumes` computed) into one `CvFilterBar.vue` is the natural next
  cut. Flagged rather than pre-emptively done, since one more small component may be the wrong
  trade for a single call site.
- **Every resume read path grows a skills join**, including the unpaged `limit=500` request the
  attach dropdown makes. Step 5 specifies an aggregated subquery to keep it one query; the
  payload growth is bounded by Open Question 5's 30-skill cap, but it is worth confirming in
  review rather than assuming.
- **Filtering is client-side and the dialog's list is unpaginated.** Correct today — one job's
  attachments are a small set — and it inherits the same demo-scale ceiling `.plan/028` Open
  Question 3 already documented for the 500-row cap. A job with hundreds of attached CVs would
  want this server-side; nothing in this plan makes that harder.
- **PII.** Skills and years are derived personal data, and the analysis call sends resume text to
  Anthropic — the same exposure the existing scoring call already has, but now on the upload
  path too. Log neither the text nor the extracted skills, per `.rule/security-rules.md`.

## Rollout Order
1. **Frontend Agent** updates `.orchestrate/api-contract.yaml` (Step 13) first with the two new
   resume response fields — it owns that file, and the Backend Agent only reads it. Same
   sequencing `.plan/028` used.
2. **Backend Agent** implements Steps 1–8 (schema → analysis → store types → memory-store →
   pg-store → routes → backfill → tests). This lands first: the filter UI cannot be built
   against fields the API does not return.
3. **Frontend Agent** implements Steps 9–12 once `GET /api/job/:id/resumes` returns
   `years_experience` and `skills`.
4. **QA** runs last, against the Validation checklist — with particular attention to the
   star-vs-filter interaction (Open Question 3), the tie behavior at 5th place, and the
   confirmation that `.plan/015`'s Recruiter behavior is still intact.
5. On merge, apply the Step 14 doc updates and run the backfill script once against the dev
   database.

## Rollback
- Frontend and backend ship on one branch (`feat/cv-recruiter-filters`); revert the PR to roll
  back fully.
- Schema: drop the `resume_skill` table and the `resume.years_experience` column. No production
  data exists yet, so there is no data-migration rollback — and the analysis is reproducible from
  each resume's stored `content` by re-running the backfill script, so nothing is permanently
  lost by dropping it.
- Partial rollback: because analysis failures already degrade to "unclassified", the feature can
  be neutered without a revert by having `routes/resume.ts` skip the analysis call — uploads
  continue, CVs arrive unclassified, and the filter row simply matches everything under "All".
- The filter UI and the top-5 star are independent changes in the same file: either can be
  reverted alone (the star rule is one computed property, the filters are the filter row plus
  `filteredResumes`) if one proves problematic while the other is fine.
- **Nothing to roll back in the routing layer** — unlike the first draft, this plan does not
  touch `frontend/src/router/index.ts` or `NavBar.vue`, so `.plan/015`'s Recruiter behavior
  cannot be disturbed by this work.
