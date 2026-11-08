=== QA REPORT ===
Ticket: plan 039 - login-password-field-empty
Date: 2026-11-08
Branch: feat/login-password-field-empty (uncommitted)
Scope: frontend-only (frontend/ only; backend/ unaffected, backend checks not applicable)

Static:      vue-tsc --noEmit PASS (exit 0) · lint NOT RUN (frontend has no lint script)
Unit:        887 passed, 0 failed (54 files, full `npx vitest run`, including QA's 6 adversarial tests
             in LoginPage.adversarial.test.ts). QA's first full run, before that file was added, was
             881 passed (53 files). The 887 figure was re-run in full by the orchestrator afterwards.
E2E:         not applicable - no Playwright/e2e suite exists in frontend/ (no e2e script, no frontend/e2e)
Backend:     not applicable, frontend-only task

Files verified (read independently of the frontend agent report):
- frontend/src/pages/LoginPage.vue (only source change: +25/-1)
- frontend/tests/LoginPage.test.ts (new describe 'empty password field (.plan/039)')
- frontend/tests/LoginPage.adversarial.test.ts (QA-added)
- SettingsPage.vue is unmodified (git status), and its tests pass.

Acceptance criteria (plan 039 Validation):
- autocomplete="new-password" in Login and Signup modes - PASS - test 'sets autocomplete="new-password" ... in login and signup modes'
- Password empty on mount in both modes - PASS - 'has an empty password on mount in both modes'
- Simulated autofill at mount is cleared - PASS - 'clears a password the browser autofilled into the DOM at mount'. Not vacuous: QA test
  'autofill simulation is non-vacuous' shows a plain v-model input keeps 'saved-password' with the same hook, so only the
  resetCredentials() DOM write (passwordInput.value.value = '') can explain the pass.
- Mode switch clears typed password and resets show/hide to hidden (both directions) - PASS - 'clears a typed password and hides it again...'
  plus QA 'rapid Login/Signup switching' (10 rapid switches, email kept).
- pageshow persisted=true clears, persisted=false leaves typed text - PASS - 'clears the password on pageshow with persisted=true but leaves it on persisted=false'
  (also checks Vue state cleared via the "Password is required" error). QA added 25 repeated persisted=false events: typed text kept.
- pageshow listener removed on unmount - PASS - 'removes the pageshow listener on unmount' (same handler reference passed to removeEventListener);
  QA 'pageshow persisted=true after unmount is a no-op' does not throw.
- Logout path - PASS (with caveat) - 'shows an empty password field on the login page after logging out': NavBar Logout calls logout(),
  router.push('/login'), then a fresh LoginPage mount with simulated autofill has an empty field. Caveat: the router push is mocked, so the
  LoginPage is mounted manually by the test rather than by the real router; this is a reasonable but not end-to-end proof.
- Login, logout, login again does not carry the password - PASS - 'does not carry the previous password ... across login, logout and login again'
- Failed login keeps email, submit flow intact; existing tests unchanged - PASS - 'keeps the entered email after a failed login' and the
  pre-existing LoginPage tests all pass unchanged.
- vitest and vue-tsc pass - PASS - see counts above.
- Manual real-browser check with a saved password - UNVERIFIED (see below).

Adversarial cases tried (frontend/tests/LoginPage.adversarial.test.ts, 6 tests, all pass):
- reset must not wipe characters typed after mount (25 non-persisted pageshow events) - PASS
- rapid Login/Signup toggling x10 - PASS
- pageshow after unmount - PASS
- 12,000-char password with special characters - PASS
- pageshow persisted=true hides a visible password - PASS
- validity check of the autofill simulation itself - PASS

Findings:
- No functional defects found in LoginPage.vue.
- frontend/src/pages/LoginPage.vue:26-31 - the reset runs in onMounted, not before first paint. A user cannot realistically type within
  that window, so the plan's typing-at-load risk is low, but it is not tested in a real browser (jsdom is synchronous).
- frontend/src/pages/LoginPage.vue:46-51 (note, not a defect) - switchMode clears the password but keeps name/email; this matches the plan.
- Behavior change by design: autocomplete="new-password" means the browser will no longer offer the saved password at login (plan Q1 answer).
- Code-style: no semicolons in the changed files; consistent with .claude/rules/code-style.md.

UNVERIFIED / NOT COVERED (explicit):
1. Real-browser behavior with a saved password (Chrome/Edge/Safari/Firefox, password-manager extensions): first load, refresh, bfcache
   restore, and logout were NOT exercised. jsdom only simulates autofill via a setter hook. Needs a manual check by a human.
   Browsers may still ignore autocomplete="new-password" in rare cases; the code-level clear is the only mitigation.
2. Lint: not run, because frontend/package.json has no lint script (only dev, build, preview, test, typecheck).
3. E2E: no e2e suite exists, so no browser-driven test of the real router/logout flow.
4. Real bfcache PageTransitionEvent is only simulated with a synthetic Event carrying `persisted`.
5. Backend: not applicable.

Result: the feature PASSES all automated checks. Release remains pending the manual real-browser check (item 1).

STATUS: DONE
