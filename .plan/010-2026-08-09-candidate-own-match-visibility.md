Status: done
Owner: Ilana
Last updated: 2026-08-09

## Goal
A Candidate can view (and trigger scoring for, if not already scored) the match
result of a CV **they uploaded**, against any job it's attached to. A Candidate
must not be able to view — or trigger scoring for — the match result of a CV
**someone else** uploaded. Admin keeps full, unrestricted access; Recruiter's
existing access (create/view any match) is unchanged.

## Scope
In scope:
- `backend/src/routes/match.ts`:
  - `POST /` (`requireRole('admin', 'recruiter')` today): add `'candidate'` to
    the allowed roles. After loading `resume`, if `req.user.role === 'candidate'`
    and `resume.owner_user_id !== req.user.id`, throw `ForbiddenError`.
    Admin/Recruiter keep unrestricted create access (they can score any
    candidate's resume, unchanged).
  - `GET /:id`: after loading `match`, if `req.user.role === 'candidate'`, load
    the match's resume (`store.getResume(match.resume_id)`) and throw
    `ForbiddenError` if `resume.owner_user_id !== req.user.id`. Admin/Recruiter
    unchanged (still open).
- `backend/src/routes/job.ts`: `GET /:jobId/resumes/:resumeId/match` — same
  ownership check as above (load the resume, 403 a Candidate who isn't the
  owner) before returning the match. This route is the one
  `getMatchForPair` (frontend) calls to check for an existing match before
  falling back to creating one, so it needs the same scoping as `POST /api/match`
  and `GET /api/match/:id` or the leak stays open through this door.
- `frontend/src/components/JobCvsModal.vue`: only render `<MatchResult>` in the
  preview pane when the previewed resume is visible to the current user for
  match purposes — Admin/Recruiter always, Candidate only when
  `resume.owner_user_id === user.id`. When a Candidate previews a CV they don't
  own, show a short static message instead (e.g. "Match result is only visible
  to the CV's owner.") rather than letting the component hit a 403.
- Tests: `backend/tests/authorization.test.ts` — replace the existing
  `describe('Candidate role — /api/match', ...)` block (currently asserts a
  blanket 403 on `POST /api/match` and a blanket-allow on `GET /api/match/:id`)
  with ownership-based assertions: own resume → `POST` `201`/`GET` `200`;
  someone else's or an unowned (`owner_user_id: null`) resume → both `403`.
  Add the same own/other-owner coverage for
  `GET /api/job/:jobId/resumes/:resumeId/match`.
  `frontend/tests/JobCvsModal.test.ts` — add a case for the "not visible"
  message on another candidate's CV preview, and confirm the existing
  own-CV / Admin / Recruiter preview cases still render `<MatchResult>`.

Out of scope:
- Linking the login `app_user` Candidate identity to anything beyond
  `resume.owner_user_id` (already the mechanism from `.plan/009-...md` — no new
  linkage needed here).
- Any change to Recruiter's match access (already unrestricted, per the
  Permission Matrix) or to Admin's.
- `CvsListPage.vue` — it has no match-result UI today; out of scope to add one
  here (backlog item is specifically about the existing preview-pane view in
  `JobCvsModal.vue`).
- The third backlog item (job search/filter) — separate task, not touched here.

## Assumptions
- **This task requires backend work despite the backlog not carrying a
  `stack:full` tag**, for the same reason `.plan/009-2026-08-08-candidate-cv-ownership-scoping.md`
  did: this repository already has a full Express/Postgres backend, and the
  bug is a backend authorization gap (`POST /api/match` blanket-blocks
  Candidate; `GET /api/match/:id` and the job-scoped match-lookup route
  blanket-allow any authenticated role with no ownership check). A
  frontend-only fix would either be unable to unblock scoring for a
  Candidate's own CV, or would hide the leak in the UI while leaving it open
  to a direct API call — the exact gap `.rule/security-rules.md` warns against.
  Proceeding as full-stack, flagged here rather than silently overriding the
  mechanical scope rule.
- Ownership is `resume.owner_user_id` (added by `.plan/009-...md`), not the
  freeform `candidate.name`/`email` captured at upload time. A resume with
  `owner_user_id: null` (Admin-uploaded, or uploaded before that column
  existed) is not viewable/scoreable by any Candidate — consistent with how
  `.plan/009-...md` already treats `null` for edit/delete/detach.
- The root cause of "I can't view its' match result": when a Candidate
  previews their own CV and no match has been scored yet, `JobCvsModal.vue`
  falls through to `MatchResult`'s create-on-mount path
  (`resume-id`/`job-id` props, no `match-id`), which calls `POST /api/match`
  — currently Admin/Recruiter-only, so it 403s for every Candidate regardless
  of ownership. Confirmed by the existing test asserting a blanket
  `403s on POST /api/match` for Candidate in `authorization.test.ts`.

## Open Questions
1. **Should a Candidate be able to trigger first-time scoring for their own
   CV (`POST /api/match`), or only view a match a Recruiter/Admin already
   ran?** The backlog text says "I should be able to view the match result of
   a Cv that I have uploaded" — read narrowly that's GET-only, but the actual
   reported symptom (can't view the result at all) is caused by the
   create-on-first-preview flow in `JobCvsModal.vue`, which every role
   (including Recruiter/Admin) goes through when no match exists yet.
   Restricting Candidate to GET-only would still leave them unable to ever see
   a first-time result. **Recommended: yes**, let a Candidate trigger scoring
   for their own resume/job pair, scoped by ownership — same shape as the
   attach/detach ownership scoping from `.plan/009-...md`.
2. **What should the Candidate see when previewing a CV they don't own (now
   that the backend correctly 403s)?** Leaving `MatchResult` to fail loudly
   would show a raw "Failed to score the match" error, which reads like a bug
   rather than an intentional boundary. **Recommended:** hide `MatchResult`
   entirely for a non-owned CV and show a one-line explanatory message instead
   (mirrors how Edit/Delete/Detach buttons are simply absent, not
   error-producing, for CVs a Candidate doesn't own).

Proceeding with the recommended answers on both unless told otherwise.

## Steps
1. **`backend/src/routes/match.ts`**:
   - `POST /`: change `requireRole('admin', 'recruiter')` to
     `requireRole('admin', 'recruiter', 'candidate')`. After
     `const [resume, job] = await Promise.all(...)` and the existing
     not-found checks, add: if `req.user?.role === 'candidate' &&
     resume.owner_user_id !== req.user.id`, throw `ForbiddenError`.
   - `GET /:id`: after loading `match` (and the existing not-found check), if
     `req.user?.role === 'candidate'`, load `const resume =
     await store.getResume(match.resume_id)` and throw `ForbiddenError` if
     `!resume || resume.owner_user_id !== req.user.id`.
   - Update the file's permission-matrix comment block to describe the new
     ownership-scoped behavior (mirroring the comment style in
     `resume.ts`/`job.ts`).
2. **`backend/src/routes/job.ts`**: `GET /:jobId/resumes/:resumeId/match` —
   after the existing `isResumeAttachedToJob` check, load
   `const resume = await store.getResume(resumeId)`, 404 if missing (defensive;
   `isResumeAttachedToJob` already implies it exists), then if
   `req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id`,
   throw `ForbiddenError` — before calling `store.getLatestMatchForPair`.
3. **`frontend/src/components/JobCvsModal.vue`**: add a
   `canViewMatch(resume: JobResume)` helper — `true` for Admin/Recruiter,
   `true` for Candidate only when `resume.owner_user_id === user.value?.id`.
   In the preview pane template, wrap the existing
   `previewMatchLoading` / `<MatchResult>` block: when
   `canViewMatch(previewResume)` is false, render a short message ("Match
   result is only visible to the CV's owner.") instead, and skip the
   `getMatchForPair` lookup in `loadPreviewExtras` for that case (no need to
   call a route the user isn't allowed to see the result of).
4. **Tests — backend**: rewrite `describe('Candidate role — /api/match', ...)`
   in `backend/tests/authorization.test.ts`:
   - `POST /api/match` for own resume (`owner_user_id: candidate.user.id`,
     attached to the job) → `201`.
   - `POST /api/match` for unowned resume → `403`.
   - `POST /api/match` for another candidate's resume → `403`.
   - `GET /api/match/:id` for a match on own resume → `200`.
   - `GET /api/match/:id` for a match on unowned resume → `403`.
   - `GET /api/match/:id` for a match on another candidate's resume → `403`.
   - `GET /api/job/:jobId/resumes/:resumeId/match` — own/unowned/other-owner
     resume, same 200/403/403 shape.
5. **Tests — frontend**: `frontend/tests/JobCvsModal.test.ts` — add a case
   asserting the "only visible to the CV's owner" message (and no
   `MatchResult`/scoring call) when a Candidate previews a CV they don't own,
   and confirm the existing preview flow (own CV as Candidate, any CV as
   Admin/Recruiter) still shows `MatchResult`.
6. **Docs**: update `.doc/architecture.md`'s Auth and Org Boundaries section —
   replace the line "a Candidate cannot yet view their own match result...
   deliberate, documented scope boundary" with the new ownership-scoped
   behavior, and add a Change Log entry pointing at this plan.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill, as two Candidate accounts (A and B) plus a
  Recruiter:
  - A uploads a CV, attaches it to a job. A opens the preview: sees the match
    result (scored on first preview if not already scored).
  - B opens the preview for A's CV (e.g. from a job B can also see): sees the
    "only visible to the CV's owner" message, no score, no error toast.
  - B calls `GET /api/match/:id` directly for A's match id (e.g. via
    devtools/curl with B's session cookie): gets `403`.
  - Recruiter/Admin preview A's CV: still see the match result as before.

## Risks
- The `GET /api/match/:id` ownership check adds a `store.getResume` call on
  every Candidate read — negligible cost (single lookup by id, same pattern
  already used in `resume.ts`'s ownership checks) but worth noting since this
  route previously did zero extra lookups for Candidate.
- Hiding `MatchResult` client-side for non-owned CVs is UX-only; the actual
  boundary is enforced server-side by the 403s above, so a stale frontend
  bundle can't reopen the leak.

## Rollout Order
1. Backend ticket (ownership checks on `POST /api/match`, `GET /api/match/:id`,
   `GET /api/job/:jobId/resumes/:resumeId/match`) lands first — the frontend's
   conditional rendering depends on the backend already 403ing correctly so
   there's no window where the UI promises a result the API won't give.
2. Frontend ticket applies the `canViewMatch` gating once the backend enforces
   ownership.
3. QA runs last against both, using the two-Candidate-accounts-plus-Recruiter
   check above.

## Rollback
Revert the commits touching `backend/src/routes/{match,job}.ts`,
`backend/tests/authorization.test.ts`,
`frontend/src/components/JobCvsModal.vue`, and
`frontend/tests/JobCvsModal.test.ts`. No schema/data change in this plan, so
no data-migration rollback is needed.
