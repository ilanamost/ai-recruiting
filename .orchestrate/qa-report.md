=== QA REPORT ===
Ticket: plan 038 (LLM_MODE=mock), branch feat/llm-mode-mock, uncommitted code
Date: 2026-11-08
Scope: full stack (almost entirely backend; frontend resilience changes)

Static:      backend tsc --noEmit PASS (exit 0) · frontend vue-tsc --noEmit PASS (exit 0) · lint: NOT RUN (no lint script in either package.json; unverified)
Unit:        backend 426 passed, 0 failed (23 files) · frontend 852 passed, 0 failed (51 files)
E2E:         not run (no Playwright suite/script in frontend/package.json; no real browser run - unverified)
Backend:     npm test run once, all green

Acceptance criteria (plan 038 Validation + revision note):
- Mock scoreMatch returns int 0-100 + non-empty explanation, never calls SDK - PASS - backend/tests/llm-mode.test.ts (scoring block, SDK not called)
- Deterministic scoring; keyword-rich resume scores above one with none - PASS - llm-mode.test.ts
- Rewritten scorer (35% tech / 65% vocabulary, piecewise curve): stemming skips known tech (kubernetes, aws) - PASS - llm-mode.test.ts (strong explanation contains 'kubernetes')
- Empty-resume explanation (no "0 of N") - PASS - llm-mode.test.ts "explains an empty resume"
- Mock analyzeResume: years int 0-60 or null, normalized skills, null (not 0) without dates, no SDK - PASS - llm-mode.test.ts + qa-llm-mode.adversarial.test.ts (absurd years / skill spam bounded)
- Live/unset behavior unchanged - PASS - full existing backend suite green
- Invalid LLM_MODE no longer stops server: logged at startup, scoreMatch/analyzeResume throw ServiceUnavailableError (503 service_unavailable) - PASS - qa-llm-mode.adversarial.test.ts (case/whitespace variants flagged invalid; rejects with status 503)
- Invalid mode: /api/health 200, upload succeeds unclassified, POST /api/match 503 code service_unavailable - PASS - llm-mode.test.ts Supertest block (lines ~182-211)
- Mock-mode integration: upload, attach, match 201 persisted - PASS - llm-mode.test.ts Supertest
- Frontend: fetch TypeError -> ApiError code network_error - PASS - http.test.ts, auth.test.ts (login rejects network_error)
- Frontend: fetchMe resolves null / serverUnreachable, LoginPage role=alert notice, redirect to /login - PASS - auth.test.ts, LoginPage.test.ts, applicationStartup.test.ts (pathname === '/login', shell revealed, no navigation failure logged)
- .env examples document LLM_MODE (example: mock, staging/production: live); docs updated - PASS - grep of backend/.env*.example, .doc/backend-overview.md:656, .doc/deployment.md:71-72 (not a test; static inspection)
- Real browser rendering of the login notice / unreachable-API flow - UNVERIFIED (jsdom only)

Judgement on the three modified existing frontend tests - all LEGITIMATE:
- applicationStartup.test.ts: old assertion expected "Initial route navigation failed" when fetch rejects; with the new design the failed session check is handled (user = signed out), so navigation succeeds. The updated test still asserts page load released, shell revealed, and now also that the user lands on /login and no navigation failure is logged. Behavior change is intended by the revised plan.
- JobCvsModal.test.ts: network failure now surfaces the shared "Can't reach the server" message instead of the generic TOAST fallback; assertion uses stringContaining, still verifies a toast.error fires.
- lib/loading.test.ts: rejection message changed from raw "Failed to fetch" to "Can't reach the server"; the test's real purpose (pendingCount/isLoading return to 0 after a network failure) is unchanged and still asserted.
None weaken coverage.

Adversarial tests: first-pass backend/tests/qa-llm-mode.adversarial.test.ts is already adapted to invalidLlmMode and passes; nothing stale to remove. No new tests added - no real defect found by this pass.

Findings:
- None blocking. Note (low): mock-scorer explanation lists at most 10 words per list (MAX_LISTED), by design.
- Gaps (unverified, not failures): no lint step exists; no e2e/real-browser run.

RESULT: feature PASSES against the plan's Validation section and revision note, on the verified scope above.

STATUS: DONE
