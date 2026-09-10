Status: done
Owner: Ilana
Last updated: 2026-08-10

## Goal
A Recruiter can no longer reach the standalone `/cvs` page (nav link removed, direct
navigation redirected) — they keep exactly the same CV read access they have today, just
through a job's "Manage CVs" popup only, removing the redundant, read-only-anyway `/cvs` route
as its own destination for this role.

## Scope
In scope:
- `frontend/src/router/index.ts`: the `beforeEach` guard gains a Recruiter-specific redirect —
  `user.value?.role === 'recruiter' && to.path === '/cvs'` → `/jobs`, mirroring the existing
  Candidate-away-from-`/` redirect immediately above it.
- `frontend/src/components/NavBar.vue`: the "CVs" nav link becomes `v-if="user?.role !==
  'recruiter'"` (Admin and Candidate keep seeing it, unchanged).
- Tests: `frontend/tests/router.test.ts` — a Recruiter navigating to `/cvs` is redirected to
  `/jobs`; Admin/Candidate navigating to `/cvs` are unaffected. `frontend/tests/NavBar.test.ts`
  — the CVs link is absent for Recruiter, present for Admin/Candidate.

Out of scope:
- Any backend change. `GET /api/resume` and the CV-related routes stay exactly as they are —
  this is a navigation/UX simplification, not a data-access tightening. Recruiter already has
  full read access to CV data via a job's "Manage CVs" popup (which calls the same underlying
  data), so no new exposure is being closed and none needs to be; removing the redundant
  standalone route doesn't change what data Recruiter can see, only how many ways they can get
  to it.
- `CvsListPage.vue`'s internal role logic (`canUploadCvs`, `canEditCv`, `canDeleteCv`) —
  already evaluates to "read-only" for Recruiter and stays that way; not touched, since Admin
  and Candidate still render this same component unchanged and a Recruiter can no longer reach
  it to exercise that dead branch anyway.
- Admin's or Candidate's access to `/cvs` — unaffected, this task is Recruiter-only per the
  backlog text.

## Assumptions
- This is frontend-only, no `stack:full` override needed — unlike every other task this
  session, there's no new authorization boundary to enforce server-side, because Recruiter's
  actual data access isn't changing, only which frontend routes lead to it. A route guard and
  a hidden nav link are enough; a backend change here would be solving a problem (data
  exposure) this task doesn't actually have.
- "Hide the route completely" means both the nav link (so it isn't discoverable) and a direct
  URL guard (so typing `/cvs` or a bookmarked link doesn't work either) — hiding only the nav
  link would leave the route reachable by URL, which doesn't match "completely."

## Open Questions
None — this task is small and unambiguous: redirect plus hide the link, exactly what the
backlog asks, reusing the existing guard pattern already in this file for Candidate.

## Steps
1. **`frontend/src/router/index.ts`**: add, right after the existing Candidate `/` redirect in
   `beforeEach`:
   ```ts
   if (user.value?.role === 'recruiter' && to.path === '/cvs') {
     return '/jobs'
   }
   ```
2. **`NavBar.vue`**: change the "CVs" `RouterLink` to `v-if="user?.role !== 'recruiter'"`,
   matching the existing `v-if="user?.role !== 'candidate'"` pattern already used on the "New
   job" link a few lines above it.
3. **Tests**: per Scope's Tests bullet above.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: log in as Recruiter — confirm no "CVs" link in the nav bar,
  and confirm typing `/cvs` directly in the address bar redirects to `/jobs`. Log in as Admin
  and as Candidate — confirm both still see the "CVs" link and can open `/cvs` normally.

## Risks
- None of note — this is a small, additive guard change with no data-access implications and
  an existing pattern to follow exactly.

## Rollout Order
Single frontend ticket — no backend involved, no cross-service dependency.

## Rollback
Revert the commits touching `frontend/src/router/index.ts` and
`frontend/src/components/NavBar.vue` (plus their test files). No schema/data change in this
plan, so no data-migration rollback is needed.
