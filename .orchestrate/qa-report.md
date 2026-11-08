=== QA REPORT ===
Ticket: .plan/041-2026-11-08-no-existing-match-state.md (branch fix/no-existing-match-state)
Date: 2026-11-08
Scope: full stack (stack:full; backend/ and frontend/ both exist)
Verdict: FEATURE PASSES. No defects found. Gaps are listed under "Unverified".

Static:      backend `npx tsc --noEmit` PASS (exit 0) · frontend `npx vue-tsc --noEmit` PASS (exit 0)
             lint: not applicable, there is no lint script in frontend/package.json or backend/package.json (not run)
Backend:     `npm test`: 24 files, 436 tests passed, 0 failed (includes my new file, 7 tests)
Frontend:    `npx vitest run`: 56 files, 920 tests passed, 0 failed (includes my new file, 8 tests)
E2E:         not applicable: no frontend/e2e directory and no Playwright config exist in this repo

Counts are from my own full runs, executed after I added the tests below.

Tests added (QA only, no feature source touched):
- /frontend/tests/match-lookup-http.adversarial.test.ts (8 tests). It uses real lib/api and lib/http with only
  global fetch stubbed, and real `Response` objects.
- /backend/tests/qa-no-match-204.adversarial.test.ts (7 tests, Supertest over real HTTP).

Acceptance criteria (Validation section of the plan):
- Backend: attached pair with no match answers 204 with empty body: PASS.
  `job-resume-match.test.ts` "returns 204 with an empty body..." checks status 204, `text===''`, `body==={}`.
  Mine checks no content-type, content-length 0 or absent, and no transfer-encoding.
- Backend: unknown job, unattached pair and unknown resume still 404: PASS.
  Existing tests assert 404 plus `error.code=not_found` for each.
  Mine adds swapped ids, a blank id, a 5000-character id and `..%2F` traversal, all 404.
  Mine also adds a pair detached after having a match, which is 404 and not 204.
- Backend: Candidate asking for another candidate's resume still 403: PASS.
  The existing test is "403 ... another candidate's resume with no match yet".
  Mine checks, on the same store and URL, that the owner gets 204 and a different candidate gets 403 `forbidden`.
  Mine also checks that a null-owner resume gives a Candidate 403, and that an unauthenticated request gets 401 (never 204).
- Backend: existing match still answers 200 with the match: PASS.
  The existing "most recent match" test covers it. Mine checks the same pair goes 204 then 200 once a match is created (no stale empty state).
- Backend: error handler not reached for no-match (no error-shaped body): PASS. The 204 tests assert an empty `text`.
  `res.status(204).end()` sits before `next(error)` and nothing is thrown.
- Frontend: getMatchForPair resolves null on 204 and on 404, returns the match on 200, and a 500 rejects: PASS.
  `api.test.ts` has 4 tests in `describe('getMatchForPair')`. The 204 test asserts `json` is never called.
  Mine adds a real `new Response(null,{status:204})` giving null.
  Mine adds a real 500 with a JSON error body giving `ApiError{code:'internal_error', message:'Boom'}`.
  Mine adds a real 500 with an HTML body giving `ApiError` (no SyntaxError leak).
- Frontend: opening a CV with no match calls POST /api/match, no toast, no console.error or warn: PASS.
  The existing JobCvsModal test uses spies on console.error, console.warn and toast.error.
  Mine does it through the real api layer with a real 204 `Response` and asserts exactly one `POST /api/match` was sent.
  Mine also does it with an old-backend 404 and gets the same clean behavior.
- Frontend: opening a CV with an existing match uses it and does not create one: PASS.
  The existing "renders MatchResult with the found match id..." test covers it.
  Mine checks a real 200 sends zero `POST /api/match` and no toast.
- Frontend: lookup failure other than "no match" (500) still toasts: PASS.
  Finding (a) is confirmed. The existing test "surfaces a failed match lookup as a toast" rejects with a plain `Error`, and the modal test mocks lib/api entirely.
  I added "modal: real 500 toasts the server message and does not crash the preview". A real 500 JSON response goes through the real getMatchForPair and the modal.
  It asserts `toast.error('Boom')` and that the 'Match result' section still renders.
- Commands (backend `npm test`, `tsc`, frontend `vitest`, `vue-tsc`): PASS (see counts above).
- Manual real-browser check (204 visible in the Network tab, no red console line): UNVERIFIED (see below).

Specific checks requested:
(a) Real 500 coverage: added, passes (above). The gap in the original suite was real, and it is now closed.
(b) Rollout compatibility:
  - New frontend + old backend (404): getMatchForPair returns null, behavior is identical to before. PASS (api.test.ts and my modal test).
  - New frontend + new backend (204): null, no body read, scoring POST follows. PASS.
  - OLD frontend + new backend (204): old code only special-cased 404 and then called `response.json()`.
    My test "OLD frontend semantics on 204" confirms `new Response(null,{status:204}).json()` rejects with SyntaxError. That matches the documented Risk.
    I did NOT run the old frontend build. This is inferred from the git diff (old condition was `status === 404` only) plus that Response behavior.
    Mitigation is the plan's deploy order: frontend first, then backend. The plan's Rollout Order matches.
(c) Ownership and 404 over real HTTP via Supertest: PASS (above).
(d) 204 has no body or content-length surprises: PASS. Content-length is 0 or absent, no content-type, no transfer-encoding.
(e) Other callers: PASS. A grep of frontend/src and backend/src finds only these:
  - `stores/match.ts` wraps getMatchForPair, and its sole consumer is `JobCvsModal.vue`.
  - Docs `.doc/backend-overview.md` (~line 458) already describe the 204. `.orchestrate/api-contract.yaml` documents 200/204/401/403/404 for the route.
  - No other client calls this endpoint. `listLatestMatchesForJob` and `POST /api/match` are out of scope and untouched.

Findings:
- None blocking. No defects found in feature source.
- Observation (not a defect, known from the plan): getMatchForPair treats every 404 as "no match", so a deleted job or resume
  is masked until the scoring call reports the real error. The plan keeps this on purpose for rollout. Tighten it later.
- Observation: the existing JobCvsModal tests mock lib/api wholesale. Real-HTTP-shaped coverage of this path exists only in my new
  adversarial file, so keep it.

Unverified (explicitly NOT proven by me):
- Real-browser behavior: I did not open the app in a browser. That a 204 shows in the Network tab and produces no red console line
  (the actual goal of the task) is unverified. The plan's own Assumptions say jsdom cannot show DevTools, and this stays a manual
  step for a human. The Supertest and jsdom tests show only that the server sends 204 and the client does not log or toast.
- Lint: no lint script exists in either package, so no lint result.
- E2E: no e2e suite exists (no frontend/e2e, no Playwright config), so nothing end-to-end was run.
- Real database: backend tests use the in-memory store. The Postgres-backed store was not exercised. The route change is store-agnostic,
  but `getLatestMatchForPair` returning null/undefined on Postgres was not tested here.
- Old frontend build was not executed against the new backend, only reasoned (see (b)).
- Deployed Render/GitHub Pages behavior and CORS/proxy handling of 204 responses were not checked.

STATUS: DONE
