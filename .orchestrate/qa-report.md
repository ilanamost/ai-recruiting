=== QA REPORT ===
Ticket: .plan/035-2026-11-01-global-api-loader.md (Linear skipped per plan Q5)
Scope: frontend-only
Verdict: PASS (feature meets every Validation item that can run; findings below are low severity / follow-ups)

Static:      tsc PASS (`npx vue-tsc --noEmit`, exit 0) · lint N/A (no `lint` script, no linter installed; style rules verified by grep below)
Unit:        790 passed, 0 failed (47 files) — 782 from the implementation + 8 new QA adversarial tests
E2E:         not applicable (no Playwright config in frontend/)
Backend:     not applicable, frontend-only task

Plan Validation checklist:
- `npm test` passes — PASS — 47 files / 790 tests passed
- `npx vue-tsc --noEmit` passes — PASS — exit 0 (run before and after adding QA tests)
- `npm run lint` passes — N/A — script does not exist in frontend/package.json; substituted grep checks:
  - No trailing semicolons in changed/new TS/Vue — PASS — `git diff -U0 frontend/src | grep '^+.*;\s*$'` finds no added
    code lines with a trailing `;`; new files loading.ts, AppLoader.vue, AppLoader.test.ts, lib/loading.test.ts have none.
    The only hit in changed test files is a comment (tests/JobCvsModal.test.ts:250).
  - No inline `style=` added — PASS — `git diff -U0 frontend/src | grep '^+.*style='` returns nothing. The existing `:style`
    bindings (JobCvsModal.vue:515, MatchResult.vue:83, CvsListPage.vue:309, JobsListPage.vue:406) predate this change.
    AppLoader test "uses no inline styles" passes.
  - No new plain `.css` file — PASS — only src/main.css and src/styles/setup/tokens.css exist (both pre-existing); new
    shared styles are in src/styles/cmps/loader.scss, imported from cmps/index.scss.
- pendingCount 1 during pending apiFetch, 0 after resolve AND reject — PASS — tests/lib/loading.test.ts
  "counts a pending apiFetch and releases it once the response resolves", "releases the count when the request rejects"
- Two concurrent calls keep isLoading true until both settle — PASS — "keeps isLoading true until every concurrent call has settled"
- 401 -> refresh -> retry keeps isLoading true throughout — PASS — "keeps isLoading true through a 401 → refresh → retry sequence"
- AppLoader renders role="status" only while loading, spinner aria-hidden — PASS — tests/AppLoader.test.ts (5 tests:
  nothing rendered when idle, aria-live="polite", bar and spinner aria-hidden="true", status removed after loading)
- Grep proves removal — PASS — `grep -rnE "InitialLoader|initialLoader|app-loader" frontend/ --exclude-dir=node_modules --exclude-dir=dist`
  returns nothing (exit 1). InitialLoader.vue, lib/initialLoader.ts, their tests and `#app-loader` in index.html are deleted.
  No "Loading CVs/jobs", "Checking file", "Checking for an existing match" or "Scoring the match" text remains in src/.
- Anti-flicker constants named in lib/ (Q3) — PASS — LOADER_SHOW_DELAY_MS=150, LOADER_MIN_VISIBLE_MS=300; 5 fake-timer tests in lib/loading.test.ts
- Startup covered without pre-mount loader — PASS — tests/applicationStartup.test.ts (both the success and the navigation-failure
  paths release the page load and reveal the shell)

Acceptance criteria (.doc/product-definition.md) relevant to this task:
- Reliability: all unit tests pass — PASS — 790/790
- Reliability: linting passes — N/A — no linter configured; style-rule greps above all PASS
- Styled per repo rules (Tailwind by default, shared SCSS, no trailing semicolons) — PASS — grep evidence above; loader.scss uses tokens
  (var(--primary), var(--surface), var(--radius-full), var(--shadow-card-md))
- No other product criterion (scoring, org scoping, LLM key isolation) is touched by this frontend-only change.

QA adversarial tests (frontend/tests/loading.adversarial.test.ts, 8/8 pass):
- 60 rapid concurrent apiFetch calls mixing 200 / 401-with-failed-refresh / network error -> counter returns to 0
- 3 concurrent 401s coalesce into a single /api/auth/refresh; failed refresh releases every call
- refresh fetch itself throwing -> caller gets the 401, counter 0
- login with wrong password -> counted during fetch (1), rejects with ApiError, counter 0
- logout network failure -> resolves, counter 0
- 20 rapid start/stop cycles shorter than the show delay -> top bar never shows
- a 60 s hung page load keeps the spinner visible, then hides once it settles
- GAP (documents current behaviour): counter is 0 while the caller is still reading the response body

Findings:
- frontend/src/lib/http.ts:47-61 — expected: the top bar to stay up until the caller has its data; actual: trackRequest settles when
  the Response headers arrive, so pendingCount drops to 0 before `response.json()` finishes (proved by the GAP test). Impact is low:
  page-level loads wrap the whole store call with trackPageLoad, so only the non-blocking top bar can hide early on a slow body.
  Optional fix: track at the store/API layer (wrap fetch + body parse) or accept and document it.
- frontend/src/components/AppLoader.vue:12 — the role="status" live region is created by the same `v-if` that adds its content.
  Several screen readers only announce changes to a live region that already exists in the DOM, so "Loading…" may not be
  announced. This meets the plan's literal wording ("renders role=status only while loading"). Optional fix: keep the status
  wrapper always mounted and toggle only the inner content.
- Plan Step 7 not done — .doc/architecture.md has no description of the loader mechanism. The frontend role cannot write .doc/,
  so the orchestrator or a human should add it.
- frontend/package.json — plan Validation lists `npm run lint`, but no lint script or linter exists. Either add one or drop that
  line from future plans.
- Not verified (needs a browser, no e2e harness): no signed-out NavBar flash at startup, the z-[70] spinner sitting above the
  Manage CVs modal and preview, and visual reduced-motion behaviour. The logic for each is unit-tested; the rendering is not.

STATUS: DONE
