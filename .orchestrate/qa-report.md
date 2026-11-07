=== QA REPORT ===
Ticket: AI-108 — .plan/036-2026-11-07-mobile-iphone-auth-and-layout.md
Scope: full stack (stack:full)
Overall: FAIL (1 blocking issue in Validation, 1 functional gap on Safari). Bearer auth core, refresh rotation, cookie flow and safe-area CSS PASS.

Static:      frontend vue-tsc --noEmit PASS (exit 0) · backend tsc --noEmit PASS (exit 0)
             lint: NOT RUN — frontend/package.json has no `lint` script (plan Validation lists `npm run lint`; reported, not failed)
Unit:        frontend 816 passed, 0 failed — but 1 of 50 test files FAILS (tests/auth-bearer.test.ts: "No test suite found")
             + QA adversarial file tests/qa-bearer-auth.adversarial.test.ts: 9 passed, 0 failed
E2E:         not applicable — no Playwright config or frontend/e2e in this repo
Backend:     21 files, 403 passed, 0 failed (includes backend/tests/auth-bearer.test.ts, 28 tests)
Build:       `vite build` PASS; compiled CSS contains every max(token, env(safe-area-inset-*)) rule and overflow-x:clip; dist index.html has viewport-fit=cover

Acceptance criteria / Validation:
- `cd frontend && npm test` passes — FAIL — exit code non-zero: `FAIL tests/auth-bearer.test.ts — Error: No test suite found` (file is 0 bytes, untracked)
- `npx vue-tsc --noEmit` passes — PASS — exit 0
- `npm run lint` passes — NOT APPLICABLE — no lint script exists
- `cd backend && npm test` passes incl. bearer tests — PASS — 403/403; auth-bearer.test.ts covers bearer accept, expired/wrong-secret/garbage → 401, cookie-wins precedence, refresh via body, rotation, reuse → revoke-all, logout via body, CORS Authorization preflight, PATCH /me re-issue
- index.html has viewport-fit=cover (test) — PASS — mobile-safe-area.test.ts "index.html opts into viewport-fit=cover"
- 390px: no horizontal scroll, navbar items visible — PARTIAL/UNVERIFIED — style-contract tests pass (mobile-safe-area.test.ts: navbar flex-shrink, list-badge wrap, <main> padding); no Playwright viewport run possible (no Playwright in repo); needs manual check
- iPhone 13 Safari: no "Not authenticated" on Home/Jobs/CVs/Settings — PARTIAL — API calls via apiFetch carry the bearer (http.test.ts, qa-bearer-auth adversarial "rapid parallel 401s…"); but direct browser loads still 401 (Finding 2). Needs a real device
- Desktop cookie login unchanged — PASS — git diff of frontend/tests and backend/tests contains only additions (0 removed lines); all pre-existing cookie tests green; adversarial "logout with no stored tokens is the unchanged cookie-only request" PASS; backend "a valid cookie wins over …" PASS
- Product definition "JWT access + rotating refresh-token cookies" — PASS — rotation preserved for body tokens (backend "reusing a rotated body token returns 401 and revokes every session")

Adversarial tests added (frontend/tests/qa-bearer-auth.adversarial.test.ts, all PASS):
- 8 parallel 401s → exactly 1 refresh call, refresh body carries old refresh_token, all 8 retries carry rotated access token
- failed refresh clears both stored tokens and does not retry
- refresh 200 with empty/non-JSON body (cookie-only) keeps the stored pair and retries
- malformed login body (non-string tokens) stores nothing and strips token fields from `user`
- logout with no tokens = exact old request `{ method: 'POST', credentials: 'include' }`
- logout clears tokens when fetch rejects
- logout survives localStorage throwing SecurityError (Safari private mode)
- FormData PATCH gets Authorization but no forced Content-Type
- 16 KB access token sent verbatim

Findings:
1. [BLOCKING] frontend/tests/auth-bearer.test.ts — expected a test suite (or no file), actual 0-byte untracked file → `npm test` exits non-zero. Fix: delete the file (coverage already lives in tests/http.test.ts, tests/auth.test.ts, tests/lib/token.test.ts), or fill it in.
2. [HIGH — known gap, confirmed] URLs the browser loads directly cannot carry the bearer header, so on Safari (cookies dropped) they return 401:
   - frontend/src/lib/auth.ts:47 profileImageUrl → <img> in src/components/NavBar.vue:124 and src/pages/SettingsPage.vue:160 → GET /api/auth/me/profile-image (backend/src/routes/auth.ts:330, requireAuth). Expected the avatar to render; actual a broken image on Safari.
   - frontend/src/components/JobCvsModal.vue:606 <iframe :src="getResumeFileUrl(id)"> and :564 <a :href="getResumeFileUrl(id,{download:true})" download> → GET /api/resume/:id/file (backend/src/routes/resume.ts:152, requireAuth via router.use at :68). Expected preview/download; actual 401 JSON.
   - Made worse by JobCvsModal.vue:292: the HEAD pre-check uses apiFetch, which now succeeds with the bearer, so previewFileStatus = 'ok' and the iframe shows the raw 401 body instead of the existing error fallback.
   Suggested fix (needs a plan decision): fetch the file/image with apiFetch → blob → URL.createObjectURL (revoke it on change/unmount), or a short-lived signed `?token=` query that the backend accepts only on these GET routes.
3. [LOW] backend/src/routes/auth.ts:155 — /logout is behind requireAuth. If the access token has expired (more than 15 min idle), logout returns 401 and the refresh token from the body is never revoked server-side. The client still clears localStorage (auth.ts finally block), but the refresh token stays valid until it expires. The cookie flow had the same behaviour before, but it matters more now: on Safari the refresh token sits in readable localStorage. Fix: make /logout not require a valid access token when a refresh token is present, or have the client refresh first.
4. [LOW] backend/src/app.ts:21 — `allowedHeaders: ['Content-Type','Authorization']` replaces cors's default, which echoed back whatever headers the request asked for. The frontend currently sends only these two (grep of frontend/src), so nothing breaks today. Any header added later must be added to this list too.
5. [LOW, multi-tab] Two tabs that both hit a 401 at the same moment refresh with the same refresh token from localStorage. The second refresh looks like reuse, and every session gets revoked. The in-module coalescing in frontend/src/lib/http.ts:63 only covers one tab. Cookies had the same cross-tab race, so this is not a regression. Noted because of rotation.
6. [LOW, unverified on device] With viewport-fit=cover, fixed overlays use plain `p-4` (JobsListPage.vue:513 preview dialog, JobCvsModal.vue:388). In landscape that is smaller than the ~47 px side inset, so dialog edges can sit under the notch. The top-center Toaster also does not account for safe-area-inset-top. Check both on a device.
7. [INFO] Plan Validation lists `npm run lint`, but no lint script exists. Either update the plan or add the script.

Not verified (needs a real device/manual): iPhone 13 Safari end-to-end login, landscape padding, 390px horizontal scroll per page.

STATUS: DONE
