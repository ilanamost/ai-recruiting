Status: done
Owner: Ilana
Last updated: 2026-09-10

## Goal
A Candidate viewing the CVs route (`/cvs`, `CvsListPage.vue`) sees **only the CVs they
themselves uploaded** — not other candidates' names, emails, files, years/skills, or match
data. Admin keeps full, unrestricted visibility; Recruiter keeps its existing full read
access (Recruiters read CVs through a job's "Manage CVs" popup, per
`.plan/015-2026-08-10-hide-cvs-route-recruiter.md`, which is unaffected here).

This reverses the explicit, deliberate decision recorded in
`.plan/009-2026-08-08-candidate-cv-ownership-scoping.md`'s Open Question 2 ("leave `GET`
routes as-is... Candidate still sees every CV in the list") and reaffirmed by
`.plan/011-2026-08-09-candidate-job-cv-visibility.md`'s Out of Scope note. That call is
superseded by this plan for the reason the new backlog item gives directly: a candidate
should not be able to view other candidates' CVs at all, on this route.

## Scope
In scope:
- `backend/src/store/types.ts`: extend `Store.listResumes`'s params with an optional
  `owner_user_id` filter (`listResumes(params: PageParams & { owner_user_id?: string })`),
  documented as narrowing both `items` and `total` to that owner when present.
- `backend/src/store/memory-store.ts` and `pg-store.ts`: `listResumes` filters to
  `resume.owner_user_id === owner_user_id` (memory) / `where resume.owner_user_id = $n`
  (pg) — applied before pagination slicing/`limit`/`offset`, and reflected in `total`, so
  pagination math (`.plan/028-2026-09-06-pagination-cvs-jobs.md`) stays correct per-owner.
  Untouched (no filter clause) when `owner_user_id` is omitted.
- `backend/src/routes/resume.ts`:
  - `GET /`: pass `owner_user_id: req.user?.role === 'candidate' ? req.user.id : undefined`
    into `store.listResumes`. Admin/Recruiter get the unfiltered list, unchanged.
  - `GET /:id` and `GET /:id/file`: add the same ownership check already used on the
    mutating routes in this file (`PATCH /:id`, `PUT /:id/file`, `DELETE /:id`) — if
    `req.user?.role === 'candidate'` and `resume.owner_user_id !== req.user.id`, throw
    `ForbiddenError`. Without this, a Candidate who already has (or guesses) another CV's
    id can still view its details or download its file directly, bypassing the list filter
    entirely — the same "closed on the list, open through a direct-id door" gap
    `.plan/010-2026-08-09-candidate-own-match-visibility.md` closed for match results. See
    Open Question 1.
  - Update the file's top permission-matrix comment: Candidate can now view/download only
    a CV whose `owner_user_id` equals their own user id (previously: "can view any CV").
- `frontend/src/pages/CvsListPage.vue`: add a defense-in-depth filter so the rendered list
  itself never shows a non-owned row for a Candidate, even if some future change to the
  store or an API bug ever returned a broader set — mirrors the same belt-and-suspenders
  pattern already used for match-result visibility in `JobCvsModal.vue`
  (`.plan/010-...md`). The real boundary is the backend filter above.
- `.plan/009-...md`: add a short addendum note pointing at this plan, recording that its
  Open Question 2 answer is superseded here.
- Tests:
  - `backend/tests/authorization.test.ts` — candidate sees only their own resume when
    another candidate's and a null-owner resume also exist (`GET /api/resume`, asserting
    both `items` and `total`); candidate `GET /api/resume/:id` and `GET /api/resume/:id/file`
    on another candidate's resume → `403`; same on a null-owner resume → `403`; Admin and
    Recruiter still get the full unfiltered list and unrestricted `GET /:id`/`:id/file`.
  - `backend/tests/resume.test.ts` — no change expected (its `setup()` always authenticates
    as Admin, which stays unfiltered); confirm after the change rather than assume.
  - `frontend/tests/CvsListPage.test.ts` — the existing
    `describe("candidate role, another candidate's CV (ownership-scoped, .plan/009-...)")`
    block currently asserts that a mixed-ownership API response renders the other
    candidate's row (with Edit/Delete hidden). That scenario is now the exact one this plan
    forbids: update it to assert the non-owned row does **not** render at all for a
    Candidate, keeping the existing Admin/Recruiter-sees-everything coverage in the same
    file unchanged.

Out of scope:
- `frontend/src/pages/JobsListPage.vue`'s `cvCount` and `JobCvsModal.vue`'s attached-CV
  list — both already ownership-scoped for Candidate (`.plan/011-...md`), independent of
  the general `/cvs` list; no change needed, and the backend filter above doesn't touch
  `listResumesForJob`.
- `POST /api/resume` (upload), `PATCH /:id`, `PUT /:id/file`, `DELETE /:id` — already
  ownership-scoped since `.plan/009-...md`; unchanged here.
- Backfilling or changing behavior for CVs with `owner_user_id: null` beyond what
  `.plan/009-...md` already established (Admin-only to manage; now also Admin/Recruiter-only
  to view under this plan, per Open Question 1).
- Any change to Recruiter's access — still full read access to every CV, unchanged.

## Assumptions
- **This task requires backend work despite the backlog item carrying no `stack:full`
  tag**, for the same reason `.plan/009`, `.plan/010`, and `.plan/011` all gave: this repo
  has a real Express/Postgres backend (not a mock layer), and a visibility boundary can
  only be enforced server-side. Filtering only in `CvsListPage.vue` would still expose
  every other candidate's name/email/file to a direct `GET /api/resume` (or `/:id`,
  `/:id/file`) call — the exact gap `.rule/security-rules.md` and this repo's product
  definition (PII handling) warn against. Proceeding as full-stack, flagged here per the
  established pattern rather than silently overriding the mechanical scope rule.
- Ownership is `resume.owner_user_id` (`.plan/009-...md`), set at upload time from the
  authenticated uploader — not the freeform `candidate.name`/`email` captured on the
  record, consistent with every prior ownership-scoping plan in this series.
- The backlog text names "the Cvs route" specifically (matching `.plan/011-...md`'s
  precedent of scoping one surface at a time); the Jobs-route CV visibility
  (`.plan/011-...md`) and match-result visibility (`.plan/010-...md`) are already handled
  and are not reopened here.

## Open Questions
1. **Should direct-by-id access (`GET /api/resume/:id`, `GET /api/resume/:id/file`) also
   become ownership-scoped for Candidate, or should only the list (`GET /api/resume`)
   narrow, leaving direct-id access open as `.plan/009-...md`'s Open Question 2 originally
   decided?** Scoping only the list would hide other candidates' CVs from browsing but
   leave them fully viewable/downloadable by anyone who already has (or can guess) a CV's
   id — not a real fix for the underlying privacy concern the backlog item raises, just a
   UI-level hide. **Recommended: yes, scope both** — a Candidate's ownership boundary
   should hold everywhere a CV's contents leave the server, not just in the list endpoint,
   matching how `.plan/010-...md` closed the equivalent gap for match results (list +
   direct-id + the job-scoped lookaside route, not just one of the three).
2. **What happens to a CV with `owner_user_id: null` (Admin-uploaded, or pre-existing the
   column) — is it visible to a Candidate in the list or by direct id?**
   **Recommended:** no, treat `null` the same as "owned by someone else" for a Candidate —
   excluded from their list, `403` on direct-id access — consistent with how `null` is
   already treated as "no candidate owns this" for every mutating route since
   `.plan/009-...md`.

Proceeding with the recommended answers on both unless told otherwise.

## Steps
1. **Store types** (`backend/src/store/types.ts`): change `listResumes(params:
   PageParams): Promise<Page<ResumeWithCandidate>>` to `listResumes(params: PageParams &
   { owner_user_id?: string }): Promise<Page<ResumeWithCandidate>>`; update its doc comment
   (currently "No org/ownership filtering") to describe the new optional filter.
2. **`memory-store.ts`**: in `listResumes`, after mapping to `ResumeWithCandidate[]` and
   before the `offset`/`slice` pagination step, add
   `.filter((resume) => params.owner_user_id === undefined || resume.owner_user_id === params.owner_user_id)`
   so `total` reflects the filtered count.
3. **`pg-store.ts`**: in `listResumes`, when `params.owner_user_id` is present, add
   `where resume.owner_user_id = $3` to both the paged `select` and the `count(*)` query
   (parameterized, not string-interpolated); omit the clause entirely when absent.
4. **`routes/resume.ts`**:
   - `GET /`: `const resumes = await store.listResumes({ page, limit, owner_user_id:
     req.user?.role === 'candidate' ? req.user.id : undefined })`.
   - `GET /:id`: after loading `resume` and the existing not-found check, if
     `req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id`, throw
     `ForbiddenError`.
   - `GET /:id/file`: same check, using `store.getResumeFile`'s result (or load via
     `store.getResume` first if `getResumeFile`'s return shape doesn't carry
     `owner_user_id` — check its type before assuming).
   - Update the top-of-file permission-matrix comment.
5. **`frontend/src/pages/CvsListPage.vue`**: change the `resumes` computed to filter
   defensively for Candidate:
   ```ts
   const resumes = computed(() => {
     const items = resumeStore.resumes
     return user.value?.role === 'candidate'
       ? items.filter((resume) => resume.owner_user_id === user.value?.id)
       : items
   })
   ```
6. **`.plan/009-2026-08-08-candidate-cv-ownership-scoping.md`**: add a short addendum note
   under its Open Question 2 pointing here — "superseded by `.plan/032-...md`: `GET
   /api/resume` and direct-id CV access are now ownership-scoped for Candidate."
7. **Tests — backend** (`authorization.test.ts`): in the existing `describe('Candidate
   role — /api/resume routes ...')` block, replace/extend the `'allows GET /api/resume'`
   test to seed the candidate's own resume plus another candidate's and a null-owner
   resume, and assert the response `items`/`total` contain only the candidate's own; add
   `'403s on GET /api/resume/:id for another candidate's resume'` and the `/:id/file`
   equivalent, plus the null-owner equivalents (Open Question 2); add matching
   Admin/Recruiter cases proving both stay unfiltered/unrestricted.
8. **Tests — frontend** (`CvsListPage.test.ts`): update the `"candidate role, another
   candidate's CV"` describe block so the mocked mixed-ownership response results in only
   the owned row rendering for a Candidate; keep the Admin/Recruiter-sees-everything tests
   unchanged.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill, as two Candidate accounts (A and B) plus a Recruiter:
  - A and B each upload a CV.
  - A opens the CVs route: sees only their own CV, not B's name/email/file.
  - A calls `GET /api/resume` directly (devtools/curl) with A's session: response `items`
    contains only A's resume, `total` is `1` (assuming no other CVs of A's).
  - A calls `GET /api/resume/<B's resume id>` and `GET /api/resume/<B's id>/file` directly:
    both `403`.
  - Recruiter opens the Jobs route's "Manage CVs" popup: still sees every attached CV
    (unaffected — different route, `.plan/011-...md`'s scope).
  - Admin opens the CVs route: still sees every CV, including B's and any null-owner CV.

## Risks
- `GET /:id` and `/:id/file` becoming ownership-scoped (Open Question 1) is a behavior
  change beyond the literal backlog text ("in the Cvs route"), touching any other code path
  that calls these by id for a Candidate. Checked: `JobCvsModal.vue`'s preview pane for a
  Candidate only ever previews resumes already returned by the (already owner-filtered,
  per `.plan/011-...md`) `GET /api/job/:id/resumes`, so no legitimate Candidate flow hits
  the new `403`. Worth a manual pass through `JobCvsModal.vue`'s preview during QA to
  confirm.
- Filtering inside `listResumes` couples an owner filter into a method also called
  unfiltered for Admin/Recruiter — low risk since the parameter is optional and every
  other caller (Admin/Recruiter paths) simply omits it, but worth double-checking no other
  call site passes `owner_user_id` unintentionally.

## Rollout Order
1. Backend ticket (store filter + route ownership checks on `GET /`, `GET /:id`, `GET
   /:id/file`) lands first — the frontend's defensive filter is redundant without it, and
   pagination `total` needs the server-side filter to be correct.
2. Frontend ticket (defensive list filter) applies once the backend is scoped, so there's
   no window where the API is still broad but the UI already implies it's narrowed.
3. QA runs last against both, using the two-Candidate-accounts-plus-Recruiter check above.

## Rollback
Revert the commits touching `backend/src/store/{types,memory-store,pg-store}.ts`,
`backend/src/routes/resume.ts`, `backend/tests/authorization.test.ts`,
`frontend/src/pages/CvsListPage.vue`, `frontend/tests/CvsListPage.test.ts`, and the
addendum note in `.plan/009-...md`. No schema/data change in this plan, so no
data-migration rollback is needed.
