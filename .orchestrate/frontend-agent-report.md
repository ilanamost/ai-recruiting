=== FRONTEND AGENT REPORT ===
Ticket: .plan/035-2026-11-01-global-api-loader.md (Linear skipped per plan Q5)
Branch: feat/initial-load-loader (not committed)

Files changed:
- frontend/src/lib/loading.ts (new): pendingCount / pagePendingCount, isLoading / isPageLoading,
  anti-flicker isLoaderVisible / isPageLoaderVisible, trackRequest, trackPageLoad, isAppReady /
  markAppReady, LOADER_SHOW_DELAY_MS = 150, LOADER_MIN_VISIBLE_MS = 300
- frontend/src/lib/http.ts: apiFetch wrapped in trackRequest (covers 401 -> refresh -> retry)
- frontend/src/lib/auth.ts: raw login/signup/logout fetches wrapped in trackRequest
- frontend/src/components/AppLoader.vue (new): top bar + centered spinner, role="status",
  aria-live="polite", aria-hidden visuals, pointer-events-none
- frontend/src/styles/cmps/loader.scss (new) + cmps/index.scss import
- frontend/src/App.vue: mounts AppLoader; shell gated on isAppReady
- frontend/src/lib/startup.ts: plain mount, initial navigation tracked as a page load
- frontend/index.html: #app-loader removed
- Deleted: components/InitialLoader.vue, lib/initialLoader.ts, tests/InitialLoader.test.ts,
  tests/initialLoaderService.test.ts
- Per-page spinner rows replaced with trackPageLoad: pages/CvsListPage.vue, pages/JobsListPage.vue
  (background reloads only get the top bar), components/JobCvsModal.vue (Loading CVs, Checking
  file, Checking for an existing match), components/MatchResult.vue (Scoring the match)
- Tests: tests/lib/loading.test.ts, tests/AppLoader.test.ts (new); applicationStartup.test.ts
  rewritten; page-loader blocks added to CvsListPage, JobsListPage, JobCvsModal, MatchResult
  tests; obsolete loading-text assertions updated in JobCvsModal.test.ts and
  JobsListPage.filter-adversarial.test.ts

Unit tests: 782 passed, 0 failed (46 files)
E2E tests: none in this Vue app (no Playwright config in frontend/)
Typecheck: npx vue-tsc --noEmit clean
Lint: frontend/package.json has no `lint` script and no linter is installed; checked no trailing
semicolons, no inline style=, no new .css files manually
API contract: no change; .orchestrate/api-contract.yaml does not exist, so no note was written

Handoff:
- No backend work.
- Plan Step 7 (.doc/architecture.md) NOT done: the frontend role may not write .doc/. The
  orchestrator or a human should add the loader mechanism to the frontend section.
- Reduced motion: the loader uses `animation: none` (static bar and chip), not a slowed spin.
  The existing tests/ui-polish.adversarial.test.ts requires that for every reduced-motion block.
- QA should verify in a browser: there's no signed-out NavBar flash at startup (the shell is
  hidden until the initial navigation settles); the spinner sits above the Manage CVs modal and
  its preview (z-[70]); fast calls (<150ms) never flash the loader.

STATUS: DONE
