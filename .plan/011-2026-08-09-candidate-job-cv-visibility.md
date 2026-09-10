Status: done
Owner: Ilana
Last updated: 2026-08-09

## Goal
In a job's "Manage CVs" popup (`JobCvsModal.vue`, reached from the Jobs route), a Candidate
sees only the attached CVs **they themselves uploaded** — not other candidates' names,
emails, files, or match results attached to that same job. Admin and Recruiter keep their
existing full read access to the attached-CV list. The general `/cvs` page
(`CvsListPage.vue`) is unaffected — `.plan/009-2026-08-08-candidate-cv-ownership-scoping.md`'s
Open Question 2 already deliberately kept that page's list broad for Candidate, and this
backlog item is scoped explicitly to "the Jobs route."

## Scope
In scope:
- `backend/src/routes/job.ts`: `GET /:id/resumes` — when `req.user?.role === 'candidate'`,
  filter the result to only resumes where `resume.owner_user_id === req.user.id` before
  responding. Admin/Recruiter get the unfiltered list, unchanged. This is a list-narrowing,
  not a 403 — a Candidate is allowed to view the job's CVs endpoint, just sees fewer rows.
- `frontend/src/pages/JobsListPage.vue`: `cvCount(jobId)` currently counts every resume
  attached to a job, from the broad `GET /api/resume` list (unaffected by the backend change
  above, since that route stays broad per `.plan/009-...md`'s Q2). For a Candidate this would
  now show a count that doesn't match what `JobCvsModal.vue` actually lists (e.g. "3 CVs" badge,
  but the modal shows only their 1). Scope `cvCount` to the candidate's own resumes when
  `user.value?.role === 'candidate'` (Admin/Recruiter unchanged) so the badge and the modal
  agree — see Open Question 1.
- `frontend/src/components/JobCvsModal.vue`: no code change expected — `attachedResumes` is
  populated straight from `GET /api/job/:id/resumes`, so once the backend filters, the
  Candidate view is automatically scoped. Confirm this in testing rather than assuming.
- Tests: `backend/tests/authorization.test.ts` — a Candidate's `GET /api/job/:id/resumes`
  returns only their own resume when other candidates' resumes are also attached (currently
  the suite only asserts the route is reachable with `200`, not what it returns for a mixed
  set — see the existing `'GET /api/job/:id/resumes is allowed'` test).
  `frontend/tests/JobsListPage.test.ts` — `cvCount` badge reflects only the candidate's own
  attached CVs for a Candidate user; unchanged (full count) for Admin/Recruiter.
  `frontend/tests/JobCvsModal.test.ts` — a Candidate only sees their own resume's row in the
  attached list when the mocked API returns a mixed set.

Out of scope:
- `CvsListPage.vue` / `GET /api/resume` (the general CVs list) — deliberately left broad per
  `.plan/009-...md`'s Q2; this backlog item only names "the Jobs route."
- The attach dropdown (`unattachedResumes` in `JobCvsModal.vue`) — already scoped to
  `canAttach(resume)` (owned-only for Candidate) since `.plan/009-...md`; no change needed.
- `.plan/010-2026-08-09-candidate-own-match-visibility.md`'s `canViewMatch` gating in
  `JobCvsModal.vue` — stays as defense-in-depth even though a Candidate will now rarely (never,
  post-fix) see a non-owned row to click on; removing it isn't necessary and would weaken the
  boundary for any state where the two features interact unexpectedly.
- Recruiter's and Admin's access to the attached-CV list — unchanged, full visibility (Recruiter
  is read-only everywhere on CVs per the Permission Matrix; Admin is unrestricted).

## Assumptions
- **This task requires backend work despite the backlog not carrying a `stack:full` tag**, for
  the same reason `.plan/009-...md` and `.plan/010-...md` did: the mechanical default assumes
  no `backend/` tree, but this repo already has one, and a Candidate-visibility boundary can
  only be enforced server-side — filtering only in the Vue component would still expose every
  attached candidate's name/email/file to a direct `GET /api/job/:id/resumes` call. Proceeding
  as full-stack, flagged here per the established pattern.
- "Attached CVs of other Candidates" means the full `JobResume` row (candidate name, email,
  file, `owner_user_id`, attached date) as shown in `JobCvsModal.vue`'s list — not the numeric
  `cvCount` badge on its own. Open Question 1 below covers whether the badge should also be
  scoped for consistency.
- Ownership is `resume.owner_user_id`, per `.plan/009-...md` — a resume with a `null` owner
  (Admin-uploaded, or pre-existing the column) is excluded from a Candidate's filtered job-CV
  list, consistent with how `null` is treated as "no candidate owns this" everywhere else.

## Open Questions
1. **Should the `cvCount` badge on `JobsListPage.vue` also be scoped to the Candidate's own
   attached CVs, or left showing the true total?** Leaving it unscoped means a Candidate sees
   "3 CVs" on a job card but only 1 CV inside the modal — not a data leak (no identity is
   shown) but a confusing mismatch, and arguably still signals "other candidates applied here"
   indirectly through the number. **Recommended: yes**, scope it too, for consistency between
   the badge and the modal it summarizes — same ownership filter, applied client-side against
   the CV list, since `GET /api/resume` already stays broad and each `Resume` already carries
   `owner_user_id`.
2. **Does a Candidate still need to know a job has *some* attached CVs from other candidates
   (e.g., "2 other candidates have applied"), or should the badge silently just show their own
   count with no signal that others exist?** The backlog text says Candidates "shouldn't be
   able to view attached CVs of other Candidates," which is about visibility of the CVs
   themselves, not about hiding the fact that competition exists. **Recommended:** just show
   the Candidate's own count (Open Question 1's answer) with no additional "+N others" signal —
   simplest, matches the literal ask, and avoids re-introducing a competitive-visibility signal
   the backlog didn't request.

Proceeding with the recommended answers on both unless told otherwise.

## Steps
1. **`backend/src/routes/job.ts`**: in `GET /:id/resumes`, after
   `const resumes = await store.listResumesForJob(req.params.id)`, add: if
   `req.user?.role === 'candidate'`, reassign `resumes` to
   `resumes.filter((resume) => resume.owner_user_id === req.user!.id)` before `res.json(resumes)`.
   Update the file's top permission-matrix comment to describe this list-narrowing (distinct
   from the existing 403-on-mutation ownership checks — this route stays `200`, just filtered).
2. **`frontend/src/pages/JobsListPage.vue`**: change `cvCount(jobId)` to additionally filter by
   ownership when the current user is a Candidate:
   ```ts
   function cvCount(jobId: string) {
     return resumes.value
       .filter((resume) => resume.jobs.some((job) => job.id === jobId))
       .filter((resume) => user.value?.role !== 'candidate' || resume.owner_user_id === user.value?.id)
       .length
   }
   ```
3. **Tests — backend**: extend `backend/tests/authorization.test.ts`'s
   `describe('Candidate role — read-only job routes remain accessible', ...)` (or a new
   describe block) with a case that attaches one resume owned by the candidate and one owned by
   `otherCandidate` to the same job, then asserts `GET /api/job/:id/resumes` as the candidate
   returns exactly the one they own. Add a matching case proving Recruiter still gets both rows
   (unfiltered).
4. **Tests — frontend**: `frontend/tests/JobsListPage.test.ts` — mock a mixed-ownership resume
   list and assert the badge count for a Candidate user reflects only their own; assert it's
   unchanged (full count) for Admin/Recruiter. `frontend/tests/JobCvsModal.test.ts` — mock
   `listJobResumes` returning a mixed set (this shouldn't happen once the backend filters, but
   test the component defensively) or, more accurately, mock it returning only the Candidate's
   own resume (matching what the real filtered endpoint would return) and assert only that row
   renders.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill, as two Candidate accounts (A and B) plus a Recruiter:
  - A and B each upload a CV and attach it to the same job.
  - A opens "Manage CVs" on that job: sees only their own CV row, not B's name/email/file.
  - A's job-card CV-count badge shows `1`, not `2`.
  - Recruiter opens "Manage CVs" on that job: sees both A's and B's rows, and the job card
    shows `2` CVs (unchanged).
  - A calls `GET /api/job/:id/resumes` directly (e.g. via devtools) with A's session: response
    body contains only A's resume, not B's.

## Risks
- The `cvCount` mismatch (Open Question 1) is a UX nicety, not a security boundary — the real
  boundary is the backend filter in Step 1. Skipping Step 2 wouldn't leak any of another
  candidate's data, only show a confusing number, so it's safe to defer independently if
  needed.
- If a resume is attached to a job the Candidate doesn't own but `owner_user_id` matches (e.g.
  after an ownership transfer feature added later), this filter's behavior would need
  revisiting — not a concern today since no such feature exists.

## Rollout Order
1. Backend ticket (list-filtering on `GET /:id/resumes`) lands first — the frontend badge and
   modal both depend on either the filtered response or the already-broad `Resume.owner_user_id`
   field, neither of which requires waiting on the frontend.
2. Frontend ticket (`cvCount` scoping) applies once the backend change is in, so there's no
   window where the modal is filtered but the badge still shows the old total.
3. QA runs last against both, using the two-Candidate-accounts-plus-Recruiter check above.

## Rollback
Revert the commits touching `backend/src/routes/job.ts`, `backend/tests/authorization.test.ts`,
`frontend/src/pages/JobsListPage.vue`, `frontend/tests/JobsListPage.test.ts`, and
`frontend/tests/JobCvsModal.test.ts`. No schema/data change in this plan, so no data-migration
rollback is needed.
