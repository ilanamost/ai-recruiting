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

=== REVISION 2 — R2-2 (browser-loaded files 401 on iOS Safari) ===
Ticket: AI-106 (.plan/036 Revision 2, R2-2). Not committed. base.scss (R2-1) untouched by this pass.

Files changed:
- frontend/src/lib/api.ts — new fetchResumeFileBlob(id, { download? }): Promise<Blob> via apiFetch (+ parseErrorResponse on !ok); getResumeFileUrl kept
- frontend/src/stores/resume.ts — fetchResumeFileBlob pass-through (keeps .plan/018: components call stores)
- frontend/src/lib/auth.ts — reactive profileImageSrc (object URL) fetched via apiFetch whenever profileImageUrl changes (incl. version bumps); cleared on logout / has_profile_image false; previous URL revoked; stale responses ignored; fetch errors swallowed. Exported from useAuth(); profileImageUrl unchanged
- frontend/src/components/NavBar.vue — <img> uses profileImageSrc (User icon while loading / on failure)
- frontend/src/pages/SettingsPage.vue — <img> uses previewUrl || profileImageSrc; hasImage/removeImage still key off profileImageUrl (an image is stored)
- frontend/src/components/JobCvsModal.vue — preview: GET via store instead of HEAD, iframe :src = blob URL, revoked on close/switch/unmount, request token guards stale responses, failure -> existing inline message. Download: <button class="btn btn-ghost"> fetching ?download=1, anchor click with download=file_name, URL revoked after 10s (Safari reads the blob asynchronously), disabled per row while busy, toast on failure (ApiError message, else TOAST.error.resumeDownloadFailed)
- frontend/src/lib/toastMessages.ts — TOAST.error.resumeDownloadFailed = 'Failed to download CV'
- Tests: tests/auth-profile-image-src.test.ts (new); tests/api.test.ts, tests/stores/resume.test.ts, tests/JobCvsModal.test.ts, tests/qa-docx-removal.adversarial.test.ts, tests/NavBar.test.ts, tests/SettingsPage.test.ts extended/updated; lib/api + useAuth mocks gained fetchResumeFileBlob / profileImageSrc in the other suites; toast-constant pin tests (tests/lib/toastMessages.test.ts, tests/qa-toast-constants.adversarial.test.ts) extended for the one new constant

Unit tests: 848 passed, 0 failed (51 files)
Typecheck: npx vue-tsc --noEmit clean
API contract: unchanged — no new endpoints (existing GET /api/resume/:id/file[?download=1] and GET /api/auth/me/profile-image, now called with the bearer header)

Handoff:
- Backend: nothing new; those two GETs must honor Authorization: Bearer (already in requireAuth) and CORS must allow it.
- QA on iPhone Safari: avatar shows in navbar + settings (and updates after upload); Manage CVs preview renders (first page only in iOS iframe — known Safari limit) and Download saves with the CV's file name.
- Note: the avatar fetch goes through apiFetch, so it counts toward the global request loader like any other API call.

STATUS: DONE
