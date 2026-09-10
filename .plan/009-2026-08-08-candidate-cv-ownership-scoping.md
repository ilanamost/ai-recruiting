Status: done
Owner: Ilana
Last updated: 2026-08-08

## Goal
A Candidate should only be able to edit, delete, and detach-from-a-job the CVs
*they themselves uploaded* — not CVs uploaded by other candidates. This is the
deferred item from `.plan/008-2026-08-03-authentication-authorization.md`'s
"Addendum — 2026-08-04 #2", which gave Candidates broad edit/replace/attach/
detach access to *every* CV as a deliberate, temporary simplification and
explicitly flagged ownership scoping as a follow-up requiring a new
`resume.owner_user_id` column.

## Scope
In scope:
- `backend/schema.sql`: add nullable `resume.owner_user_id` (references
  `app_user(id)`), set on upload for a Candidate uploader, left `null` for
  Admin uploads (Admin isn't "a candidate" who can own a CV).
- Backend store (`store/types.ts`, `memory-store.ts`, `pg-store.ts`): thread
  `owner_user_id` through `createResume`, `getResume`, `listResumes`,
  `updateResume`, `replaceResumeFile`, `listResumesForJob`.
- Backend routes (`routes/resume.ts`, `routes/job.ts`): a Candidate may
  `PATCH`/`PUT .../file` a resume, `DELETE` a resume, or `POST`/`DELETE
  /api/job/:id/resumes*` (attach/detach) only when `resume.owner_user_id`
  equals their own user id — `403` otherwise. Admin keeps unrestricted access
  on all of these. `GET` routes are unchanged (still open to Candidate per the
  existing addendum — see Open Question 2).
- `DELETE /api/resume/:id`: currently Admin-only. Opens to Candidate, scoped
  to their own resumes (Admin unrestricted, per the backlog request "he should
  be able to delete the Cvs he attached as well").
- Frontend (`CvsListPage.vue`, `JobCvsModal.vue`): Edit/Replace/Delete/Detach
  controls become per-row, gated by `resume.owner_user_id === user.id` for a
  Candidate (Admin sees them on every row, Recruiter sees none, unchanged).
  The "attach a CV to this job" dropdown, for a Candidate, only lists CVs they
  own (see Open Question 1).
- `frontend/src/types.ts`: add `owner_user_id: string | null` to `Resume` /
  `JobResume`.
- Tests: `backend/tests/authorization.test.ts` (ownership-based 403s/200s
  replacing the current blanket-allow assertions for Candidate),
  `frontend/tests/{CvsListPage,JobCvsModal}.test.ts`.
- This plan's own addendum note added to `.plan/008-...md` pointing here once
  done (008 stays `Status: done`; it is extended, not superseded).

Out of scope:
- Linking the pre-existing anonymous `candidate` table (name/email captured at
  upload time) to `app_user` — `owner_user_id` points straight at `app_user`
  and is independent of that table, per `.plan/008-...md` Open Question 4
  (still unresolved, still not needed here).
- Backfilling `owner_user_id` for CVs already uploaded before this change —
  they stay unowned (`null`) and become Admin-only to edit/delete/detach, same
  as an Admin-uploaded CV. No historical data to migrate in dev.
- Any change to Recruiter's (still read-only) or Admin's (still unrestricted)
  permissions.

## Assumptions
- **This task requires backend work despite the backlog not carrying a
  `stack:full` tag.** The `writing-plans` skill and `dev-loop.prompt.md` both
  default to "frontend-only, no `backend/` tree" absent that tag — but this
  repository already has a full Express/Postgres backend (built across
  `.plan/002` through `.plan/008`), and this exact feature was already
  identified, in `.plan/008-...md`'s own addendum, as needing a new backend
  column and route-level ownership checks. Enforcing "edit only your own CV"
  purely in the frontend would be a client-side-only permission check with no
  server backing — anyone could bypass it with a direct API call, which is
  the kind of gap `.rule/security-rules.md` calls out. Proceeding as
  full-stack (schema + backend + frontend), flagged here rather than silently
  overriding the mechanical scope rule.
- A Candidate's own resumes are identified by `resume.owner_user_id`, set at
  upload time from `req.user.id` (the authenticated `app_user`), not from the
  freeform `name`/`email` fields on the resume (those remain the separate,
  unauthenticated `candidate` record per Open Question 4 above).

## Open Questions
1. **Should a Candidate's "attach CV to a job" dropdown, and the attach route
   itself, be limited to CVs they own?** The backlog text only says "detach
   them from a job" explicitly, but leaving attach unscoped would let a
   Candidate attach another candidate's CV to a job while being blocked from
   detaching it again — an inconsistent, confusing permission shape.
   **Recommended: yes**, scope both attach and detach to owned resumes for
   Candidate (Admin stays unrestricted on both).
2. **Should `GET /api/resume` (the CVs list) stay broad for Candidate, or
   narrow to only their own CVs?** The backlog text is about edit/delete/
   detach, not viewing, and the existing addendum already made a deliberate
   call to let Candidates browse the full list. Narrowing it now is a bigger
   privacy-shaped change (other candidates' names/emails/files) than what was
   asked. **Recommended: leave `GET` routes as-is** (Candidate still sees
   every CV in the list and can preview/download any of them); only the
   mutating routes (edit/replace/delete/attach/detach) become ownership-
   scoped. Edit/Delete/Detach controls simply won't render on rows the
   Candidate doesn't own.

   > **Addendum (2026-09-10) — superseded by
   > `.plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md`:** `GET
   > /api/resume` and direct-id CV access are now ownership-scoped for
   > Candidate. The list returns only the Candidate's own CVs (both `items`
   > and `total`), and `GET /api/resume/:id` and `GET /api/resume/:id/file`
   > return `403` for another candidate's CV or a null-owner CV. Admin and
   > Recruiter stay unfiltered and unrestricted.
3. **What happens to a CV uploaded before this change (`owner_user_id` is
   `null`)?** **Recommended:** treat `null` as "no candidate owns this" —
   only Admin can edit/delete/detach it, same as if an Admin had uploaded it.
   No backfill; there's no production data yet.

Proceeding with the recommended answers on all three unless you say otherwise.

## Steps
1. **Schema**: add `resume.owner_user_id uuid null references app_user(id)`
   to `backend/schema.sql` (`create table if not exists` won't retroactively
   alter a running dev DB — apply the same `alter table` directly against it
   too, per `.rule/database-rules.md`).
2. **Store types**: add `owner_user_id: string | null` to `Resume` /
   `ResumeWithCandidate` / `JobResume`; add `owner_user_id?: string | null` to
   `CreateResumeInput`.
3. **Store implementations**: `memory-store.ts` and `pg-store.ts` —
   `createResume` persists `owner_user_id`; every read path that returns a
   resume shape (`getResume`, `listResumes`, `updateResume`,
   `replaceResumeFile`, `listResumesForJob`) includes it.
4. **`routes/resume.ts`**:
   - `POST /`: set `owner_user_id = req.user.role === 'candidate' ? req.user.id : undefined`.
   - `PATCH /:id`, `PUT /:id/file`: after loading the resume, if
     `req.user.role === 'candidate'` and `resume.owner_user_id !== req.user.id`,
     throw `ForbiddenError`.
   - `DELETE /:id`: change `requireRole('admin')` to
     `requireRole('admin', 'candidate')`; same ownership check as above before
     deleting.
5. **`routes/job.ts`**: `POST /:id/resumes` (attach) and
   `DELETE /:id/resumes/:resumeId` (detach) — after loading the resume, same
   ownership check for `role === 'candidate'`.
6. **Frontend types**: add `owner_user_id: string | null` to `Resume`/
   `JobResume` in `frontend/src/types.ts`.
7. **`CvsListPage.vue`**: replace the flat `canEditCvs`/`canDeleteCvs` computed
   flags with a per-resume helper, e.g. `canManage(resume)` — `true` for
   Admin, `true` for Candidate only when `resume.owner_user_id === user.id`,
   `false` for Recruiter. Upload stays available to any Candidate (a new
   upload always becomes their own CV).
8. **`JobCvsModal.vue`**: split `canManageAttachments` into `canAttach(resume)`
   (used to filter the attach dropdown's options for Candidate) and
   `canDetach(resume)` (gates the Detach button per row) — both `true`
   unconditionally for Admin, ownership-checked for Candidate, `false` for
   Recruiter.
9. **Tests**: update `backend/tests/authorization.test.ts` so the Candidate
   describe blocks assert ownership-based `200`/`403` (own resume → allowed,
   someone else's resume → `403`) instead of blanket-allow; update
   `frontend/tests/CvsListPage.test.ts` and `frontend/tests/JobCvsModal.test.ts`
   for the per-row gating.
10. **Docs**: add a short addendum note to `.plan/008-...md` pointing at this
    plan for the ownership-scoping follow-up it deferred.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Live-database check (per `.rule/database-rules.md`): confirm
  `resume.owner_user_id` exists in the actual local Postgres dev database.
- Manual check via the `run` skill, as two Candidate accounts (A and B):
  A uploads a CV → A can edit/replace/delete it and attach/detach it from a
  job; B cannot see Edit/Delete/Detach controls on A's CV and gets `403` if
  they call those routes directly against A's resume id; Admin can still
  edit/delete/detach any CV regardless of owner.

## Risks
- Any CV uploaded before this change has `owner_user_id = null` and becomes
  effectively Admin-only to manage — acceptable per Open Question 3, but
  worth confirming no dev-database CVs anyone was relying on editing as a
  Candidate become unexpectedly locked.
- Splitting the frontend's single `canManageAttachments`/`canEditCvs` flags
  into per-row checks touches every call site in two components already
  covered by existing tests — regressions there would most likely show up as
  wrongly-hidden or wrongly-shown buttons, caught by the updated test suites.

## Rollout Order
1. Backend ticket (schema + store + route ownership checks) lands first —
   the frontend's per-row gating depends on `owner_user_id` actually being
   present in API responses.
2. Frontend ticket applies the per-row gating once the backend returns
   `owner_user_id`.
3. QA runs last against both, using the two-Candidate-accounts check above.

## Rollback
Revert the commits touching `backend/schema.sql` (drop
`resume.owner_user_id`), `backend/src/store/**`, `backend/src/routes/{resume,job}.ts`,
and `frontend/src/{pages/CvsListPage.vue,components/JobCvsModal.vue,types.ts}`.
Drop the `resume.owner_user_id` column if already applied to a dev database.
No production data exists yet, so no data-migration rollback is needed.
