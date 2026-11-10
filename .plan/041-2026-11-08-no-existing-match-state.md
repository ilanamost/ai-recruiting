Status: done
Owner: Ilana
Last updated: 2026-11-08

## Goal
"No match yet" for a job and CV pair must be a normal state, not an error. Opening a CV in Manage
CVs must not put an error line in the browser console when no match exists yet; the app then
scores the pair as it does today. Backlog task: "Job matches issue: when I click on a resume in
manage cvs, there are 2 match calls...".

## Scope
**Finding (from code, not yet reproduced in a browser):**
- Today `GET /api/job/:jobId/resumes/:resumeId/match` answers `404 not_found` when the pair is
  attached but no match exists (`backend/src/routes/job.ts`, `NotFoundError('No match found...')`).
- The frontend already handles this without throwing: `getMatchForPair` in `frontend/src/lib/api.ts`
  returns `null` on a 404, and `JobCvsModal.vue` then scores the pair. So no JavaScript error is
  thrown; the red console line is the **browser's own log of the 404 response**, which no frontend
  code can suppress. The only way to get a clean console is for the backend to stop answering with
  an error status for this state. That makes the task `stack:full` (see Open Question 1).

**Backend (`backend/`):**
- `backend/src/routes/job.ts`: when the pair is attached and viewable but has no match, answer a
  success status that means "nothing yet" (see Open Question 2) instead of `NotFoundError`.
  Genuine errors stay errors: an unknown job, an unattached pair, a missing resume (404) and a
  Candidate asking for another candidate's resume (403).
- Update the existing backend tests that assert 404 for the no-match case
  (`backend/tests/job-resume-match.test.ts`) and add the new expectations.
- `.orchestrate/api-contract.yaml`: record the new response for this route (the file is the shared
  contract; it may be stale for this route, so add or correct the entry).
- Docs: `.doc/backend-overview.md` if it describes this route's 404.

**Frontend (`frontend/`):**
- `frontend/src/lib/api.ts` `getMatchForPair`: treat the new "no match" response as `null`. Keep the
  current 404 to `null` tolerance during the rollout (see Risks).
- `frontend/src/components/JobCvsModal.vue` and `stores/match.ts`: no behavior change expected; make
  the "no match yet" state explicit in a comment/type so it is clearly a state, not an error, and
  make sure nothing logs it with `console.error` or toasts it.
- Tests in `frontend/tests/` (api, store, `JobCvsModal`).

Out of scope: the second call (`POST /api/match`, scoring) and its errors, the `GET /:jobId/matches`
list, and any new visible UI for the state.

## Assumptions
- The browser logs every non-2xx fetch response in DevTools regardless of how JavaScript handles it;
  2xx responses, including 204, produce no console line.
- The frontend (GitHub Pages) and backend (Render) deploy separately, so for a short time an old
  frontend can talk to a new backend or the reverse.
- The Candidate ownership rule on this route (403 for another candidate's resume) must not change.

## Open Questions
1. **Can this be `stack:full`?** A frontend-only change cannot remove the console line (see Scope).
   - **Option A (recommended): yes, mark the task `stack:full`** and change the backend response.
   - Option B: frontend-only. Only comments and a typed state; the browser's 404 line stays. This
     does not meet "do not display an error message in the console".
2. **What should the backend answer for "no match yet"?**
   - **Option A (recommended): `204 No Content`.** Success status with no body; semantically
     "nothing here", and no console line. The frontend maps it to `null`.
   - Option B: `200` with a JSON `null` body. Also clean, but a `null` body is unusual and a 200
     normally means a resource.
3. **Any visible UI for the state?**
   - **Recommended: no.** The existing page loader covers the short scoring wait; this task only
     changes how the state is signalled.
   - Alternative: a short "No match yet, scoring..." line while the second call runs.

**Answers (2026-11-08):** Q1 -> yes, `stack:full`. Q2 -> `204 No Content`. Q3 -> no UI change.

## Steps
1. Branch `fix/no-existing-match-state` (created from `origin/master`).
2. Backend: change the no-match branch of the route per Q2; update tests; update the contract and docs.
3. Frontend: `getMatchForPair` handles the new status; explicit "no match yet" state; tests.
4. Run `cd backend && npm test && npx tsc --noEmit` and `cd frontend && npx vitest run && npx vue-tsc --noEmit`.

## Validation
QA checklist, each item provable by a test or command:
- Backend: an attached pair with no match answers `204` with an empty body (per Q2 Option A).
- Backend: an unknown job, an unattached pair and a missing resume still answer `404`; a Candidate
  asking for another candidate's resume still gets `403`; an existing match still answers `200` with
  the match.
- Backend: the error handler is not reached for the no-match state (no error-shaped body).
- Frontend: `getMatchForPair` resolves to `null` on `204`, on `404` (rollout tolerance) and returns
  the match on `200`; a `500` still rejects.
- Frontend: opening a CV with no match calls `POST /api/match` next, shows no toast and calls
  neither `console.error` nor `console.warn` (assert with spies).
- Frontend: opening a CV with an existing match uses it and does not create a new one.
- A lookup failure other than "no match" (e.g. 500) still toasts the lookup error.
- `cd backend && npm test`, `npx tsc --noEmit`, `cd frontend && npx vitest run` and
  `npx vue-tsc --noEmit` pass.
- Manual (real browser): clicking a CV with no match shows a `204` in the Network tab and no red
  console line. jsdom cannot show DevTools, so QA lists this as unverified unless run.

## Risks
- Deploy order: a new backend (204) with an old frontend makes the old frontend call
  `response.json()` on an empty body and fail. Mitigation: deploy the frontend first (it accepts
  204 and still tolerates 404), then the backend.
- Treating every 404 as "no match" in the frontend hides a deleted job or resume as "no match", then
  the scoring call reports the real error. This is today's behavior; keeping it is the safe choice
  during rollout and can be tightened later.
- Changing a status code is an API contract change for any other client; none exists in this repo.

## Rollout Order
1. Frontend change (accepts 204 and 404).
2. Backend change.
3. QA validation, then human approval of the QA ticket.

## Rollback
Revert the branch. No data or schema change. Because the frontend accepts both 204 and 404, either
side can be rolled back independently.
