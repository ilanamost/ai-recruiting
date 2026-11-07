=== FRONTEND AGENT REPORT ===
Ticket: AI-106 (.plan/036-2026-11-07-mobile-iphone-auth-and-layout.md)
Branch: feat/mobile-iphone-auth-and-layout-fixes (not committed)

Files changed:
- frontend/index.html (viewport-fit=cover)
- frontend/src/App.vue (<main> padding via --page-pad + safe-area insets; overflow-x-clip shell)
- frontend/src/styles/setup/tokens.css (--navbar-pad-x, --navbar-pad-y, --page-pad + sm override)
- frontend/src/styles/cmps/navbar.scss (safe-area padding on navbar and mobile panel; brand/actions flex-shrink: 0)
- frontend/src/styles/cmps/list.scss (.list-badge wraps on mobile)
- frontend/src/pages/CvsListPage.vue, frontend/src/pages/JobsListPage.vue, frontend/src/components/JobCvsModal.vue (min-w-0 + overflow-wrap on long names/emails/titles)
- frontend/src/lib/token.ts (new: localStorage token store, try/catch wrapped; takeTokens, withAuthHeader)
- frontend/src/lib/http.ts (Bearer header; refresh with body token, store rotated pair, clear on rejected refresh; credentials: 'include' kept)
- frontend/src/lib/auth.ts (login/signup/updateProfile store + strip tokens; logout sends bearer + body refresh token, clears tokens)
- frontend/tests/lib/token.test.ts (new), frontend/tests/mobile-safe-area.test.ts (new), frontend/tests/http.test.ts, frontend/tests/auth.test.ts (extended)

Unit tests: 816 passed, 0 failed (49 files)
E2E tests: none — this Vue app has no Playwright setup
Typecheck: npx vue-tsc --noEmit clean
Lint: no `lint` script or ESLint config exists in frontend/package.json — not run
API contract: .orchestrate/api-contract.yaml (bearer fallback: token pair in login/signup/refresh bodies, refresh/logout body token, requireAuth bearer, PATCH /me rotated pair)

Handoff:
- Backend: implement the contract — login/signup return { ...toAuthUser(user), access_token, refresh_token }; refresh returns { access_token, refresh_token }; refresh/logout fall back to body refresh_token; requireAuth accepts Authorization: Bearer; CORS allows the Authorization header; PATCH /me returns the rotated pair when it calls issueSession.
- Known gap: URLs loaded directly by the browser (avatar <img src> /api/auth/me/profile-image, CV <iframe>/<a download> file URLs) cannot carry a bearer header, so on iOS Safari they will still 401. Fix needs a follow-up (fetch as blob via apiFetch + object URL, or short-lived signed URLs).
- QA: verify at 390x844 (and landscape) that navbar items and page edges clear the notch/home indicator; verify desktop cookie login unchanged.
- Token store lives in lib/token.ts rather than lib/auth.ts (plan step 5) to avoid an auth.ts <-> http.ts import cycle.

STATUS: DONE
