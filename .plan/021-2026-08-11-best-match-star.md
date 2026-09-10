Status: done
Owner: Ilana
Last updated: 2026-08-11

## Goal
In the "Manage CVs" popup's attached-CV list, Admin and Recruiter see a yellow star to the left
of whichever attached CV (or CVs, on a tie) has the highest match score for that job — a quick
visual shortlist signal. Candidate does not see the star.

## Scope
In scope:
- `backend/src/store/types.ts`: add `listLatestMatchesForJob(job_id: string): Promise<Match[]>`
  to the `Store` interface — one row per resume attached to the job, its most recent match with
  that job (resumes never scored for this job are simply absent, not a null entry).
- `backend/src/store/pg-store.ts` / `memory-store.ts`: implement it — Postgres via
  `distinct on (resume_id) ... order by resume_id, created_at desc`, memory-store via a
  keep-latest-per-resume_id reduction, mirroring `getLatestMatchForPair`'s existing "most
  recent wins" convention.
- `backend/src/routes/job.ts`: new `GET /:jobId/matches`, `requireRole('admin', 'recruiter')`
  — matches exactly who the star is shown to (see Open Question 1 for why Candidate must be
  excluded at the API layer, not just hidden from client-side).
- `frontend/src/stores/match.ts`: `listLatestMatchesForJob(jobId: string)` wrapping the new
  route, toasting on failure the same way this store's sibling `getMatchForPair` already does
  (`'Failed to look up an existing match'` → new fallback text for this call) — a failure here
  should not block the rest of the modal from rendering, just skip the star.
- `frontend/src/lib/api.ts`: `listLatestMatchesForJob(jobId: string): Promise<Match[]>` thin
  wrapper, alongside the existing `getMatchForPair`.
- `frontend/src/components/JobCvsModal.vue`: when `user.value?.role === 'admin' ||
  user.value?.role === 'recruiter'`, fetch the job's latest matches alongside the existing
  `listJobResumes`/`listResumes` calls in `load()`; compute the maximum score among them; a
  resume's row gets a yellow `Star` icon (left of its existing content) when its latest match's
  score equals that maximum (ties all get a star; no scored matches at all means no star
  renders for anyone).
- Tests: `backend/tests/job-resume-match.test.ts` (or a new file, implementer's call) —
  `GET /:jobId/matches` returns the latest match per resume, excludes unscored resumes,
  excludes a resume's older/superseded match, 403s for Candidate, 200s for Admin/Recruiter.
  `frontend/tests/JobCvsModal.test.ts` — the highest-scoring attached CV gets the star for both
  Admin and Recruiter; a tie gives the star to both CVs; no star for Candidate even with the
  same underlying data; no star when nothing has been scored yet; a failed fetch doesn't block
  the rest of the list from rendering.

Out of scope:
- Any change to how a match is created or scored — this only reads existing match data.
- Showing the star anywhere other than the attached-CV list inside `JobCvsModal.vue` (not on
  `CvsListPage.vue`, not in the job card's CV-count badge).
- Persisting "is this the best match" anywhere — it's computed client-side from the fetched
  scores each time the modal opens, not a stored flag.

## Assumptions
- **Full-stack, despite no `stack:full` tag** — same override pattern as every match-domain
  task this session: there is no existing endpoint that returns every match for a job in one
  call (only `getLatestMatchForPair`, one resume at a time), and determining "the best match
  among N attached CVs" without one would mean N sequential per-resume requests, which is both
  inefficient and, per Open Question 1, an authorization footgun to add generically.
- A resume can have more than one match row for the same job over time (re-scoring); "best
  match" compares each resume's *latest* match, matching how the rest of the app already
  treats "the match" for a resume/job pair (`getLatestMatchForPair`, `getMatch` after a fresh
  `createMatch`) — never an older superseded score.

## Open Questions
1. **Should `GET /:jobId/matches` be restricted to Admin/Recruiter?** This route returns
   *every* attached resume's score for a job in one response — if a Candidate could call it,
   they'd see other candidates' scores by job, directly violating the ownership boundary
   `.plan/010-2026-08-09-candidate-own-match-visibility.md` established (a Candidate may only
   ever see a match for a resume they own). **Recommended: yes**, `requireRole('admin',
   'recruiter')` at the route — Candidate must be excluded entirely at the API layer, not just
   have the frontend hide the star for them. (Per direct instruction, the star itself is shown
   to both Admin and Recruiter, not Recruiter-only, so the route's role list and the UI's
   role gate now match exactly.)
2. **Which token/color for "yellow"?** This app already has `--warning` (`--warning-600` light /
   `--warning-500` dark), an amber/yellow tone already used for the score-mid band. A raw
   Tailwind `text-yellow-400`/`fill-yellow-400` would introduce a color outside this app's
   token system. **Recommended:** `text-warning fill-warning` (or the equivalent arbitrary-value
   binding to `var(--warning)` if this app's Tailwind config doesn't already expose a `warning`
   color utility — confirm `--color-warning` in `tokens.css`'s `@theme` block, which it already
   has), reusing the existing token rather than a one-off hardcoded yellow.

Proceeding with the recommended answers on both unless told otherwise.

## Steps
1. **`backend/src/store/types.ts`**: add `listLatestMatchesForJob(job_id: string):
   Promise<Match[]>` to `Store`.
2. **`pg-store.ts`**: implement via
   `select distinct on (resume_id) * from match where job_id = $1 order by resume_id, created_at desc`.
3. **`memory-store.ts`**: implement by filtering matches to `job_id`, grouping by `resume_id`,
   keeping the one with the latest `created_at` per group.
4. **`backend/src/routes/job.ts`**: `router.get('/:jobId/matches', requireRole('admin',
   'recruiter'), async (req, res, next) => { ... })` — 404 if the job doesn't exist (mirroring
   this file's other job-scoped routes), otherwise `res.json(await
   store.listLatestMatchesForJob(req.params.jobId))`.
5. **`frontend/src/lib/api.ts`**: `listLatestMatchesForJob(jobId)` thin wrapper.
6. **`frontend/src/stores/match.ts`**: action wrapping it, toast-on-failure per Scope.
7. **`JobCvsModal.vue`**: in `load()`, when `user.value?.role === 'admin' ||
   user.value?.role === 'recruiter'`, also call `matchStore.listLatestMatchesForJob(props.job.id)`;
   store the result; compute `bestScore = Math.max(...matches.map(m => m.score))` (guard the
   empty-array case — no star rendering when there are no matches at all); a resume's row shows
   the star when `matches.find(m => m.resume_id === resume.id)?.score === bestScore`. Add the
   `Star` icon (from `@lucide/vue`) to the left of the existing per-row content in the
   attached-list `<li>`, `v-if` gated on the role check and the score match.
8. **Tests**: per Scope's Tests bullet above.
9. **Docs**: add the new route and store method to `.doc/architecture.md`'s Backend component
   list, and a Change Log entry.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill, as a Recruiter: attach three CVs to a job, score two of them
  (different scores), open "Manage CVs" — the higher-scoring CV shows a yellow star, the lower-
  scoring and unscored CVs don't. Confirm the same is true logged in as Admin. Log in as
  Candidate and open the same modal — no star appears, even though the same underlying data
  exists (and the Candidate's own CV, if attached and among the highest scores, still doesn't
  show a star — the route itself is unreachable for that role).

## Risks
- `distinct on` is Postgres-specific syntax — already consistent with this codebase's existing
  `pg-store.ts` (which is Postgres-only by design; `memory-store.ts` is the portable
  implementation used in tests), so this isn't introducing a new constraint.
- If a job has many attached resumes, this is one query instead of N — the efficiency concern
  that ruled out reusing `getLatestMatchForPair` in a loop is exactly what this new endpoint
  avoids.

## Rollout Order
1. Backend ticket (store method, route, tests) lands first — the frontend fetch depends on the
   route existing.
2. Frontend ticket (store action, `JobCvsModal.vue` star rendering) applies once the backend
   route is in place.
3. QA runs last, focused specifically on the authorization boundary (Candidate must never reach
   `GET /:jobId/matches`) and the tie/empty/failure edge cases.

## Rollback
Revert the commits touching `backend/src/store/**`, `backend/src/routes/job.ts`,
`backend/tests/**`, `frontend/src/lib/api.ts`, `frontend/src/stores/match.ts`,
`frontend/src/components/JobCvsModal.vue`, and their test files. No schema change in this plan
(reads existing `match` rows only), so no data-migration rollback is needed.
