Status: done
Owner: Ilana
Last updated: 2026-11-07

## Goal
Make the app usable on a real iPhone 13 (Safari): (1) stop the "Not authenticated" error on
every route, and (2) fix the layout so page content and the navbar are not flush against /
cut off by the device edges. Backlog task: "When I ran the app on a real iphone13 device…".

## Scope
**Part B — layout (frontend only, always in scope):**
- `frontend/index.html`: add `viewport-fit=cover` to the viewport meta so
  `env(safe-area-inset-*)` is populated (notch / rounded corners / home indicator).
- `frontend/src/styles/cmps/navbar.scss`: horizontal + top safe-area padding on the navbar
  (`max(var(--navbar-pad), env(safe-area-inset-left/right/top))`), and ensure the brand icon,
  hamburger and mobile menu panel are not clipped at 390 px width.
- `frontend/src/App.vue` `<main>`: guaranteed side padding on mobile (today `p-6` — verify it
  is not overridden), plus bottom safe-area padding. Use tokens in
  `frontend/src/styles/setup/tokens.css` for any new spacing value; Tailwind utilities by default.
- Check the jobs/CVs/home/settings/login pages and the dialogs (CV/Job preview, Manage CVs)
  at 390 × 844 for horizontal overflow; fix with utilities only.

**Part A — "Not authenticated" (needs a decision, see Open Questions):**
Root cause (from code, not yet reproduced on-device): auth is httpOnly cookies
(`backend/src/lib/auth.ts`, `SameSite=None; Secure`), and the frontend (GitHub Pages) and the
API (Render) are on different sites. iOS Safari's Intelligent Tracking Prevention blocks
cross-site cookies even with `SameSite=None`, so the cookie is never sent, `requireAuth`
(`backend/src/middleware/auth.ts`) finds no token, and every route returns 401. Desktop
Chrome still allows them, which is why it works there. A frontend-only change cannot fix this.

## Assumptions
- The failing deployment is the split-origin one (GitHub Pages → hosted API), not localhost.
- iPhone 13 viewport ≈ 390 × 844 CSS px, top inset ≈ 47 px in portrait.
- Existing behavior on desktop (cookie auth) must not regress.

## Open Questions
1. **How should we fix auth on Safari?** This crosses into `backend/`, which the backlog task
   does not mark `stack:full`.
   - **Option 1 (recommended): mark the task `stack:full` and add bearer-token fallback.**
     Backend: `login`/`signup`/`refresh` also return `{ access_token, refresh_token }` in the
     JSON body; `requireAuth` accepts `Authorization: Bearer <jwt>` in addition to the cookie;
     `/refresh` and `/logout` accept the refresh token from the body when the cookie is absent.
     Frontend: keep tokens in `localStorage`, send the `Authorization` header from
     `frontend/src/lib/http.ts`, refresh via body. Cookies keep working where allowed.
     Trade-off: tokens in `localStorage` are readable by XSS (weaker than httpOnly cookies).
   - **Option 2: put both apps on one site** (custom domain, e.g. `app.example.com` +
     `api.example.com`) so cookies are first-party. No code change to auth, but needs a domain
     and DNS/hosting setup outside this repo; only a docs update (`.doc/deployment.md`) here.
   - **Option 3: layout fixes only**, and leave the Safari auth issue open.
2. Should the bearer-token storage be `localStorage` (survives reload) or in-memory only
   (safer, but the user re-logs in on every reload unless refresh cookie works)?
   Recommended: `localStorage`.

**Answers (2026-11-07):** Q1 → Option 1 (task now `stack:full`). Q2 → `localStorage`.

## Steps
1. Branch `feat/mobile-iphone-auth-and-layout-fixes` (created).
2. Layout: viewport meta, navbar safe-area + padding, `<main>` padding, per-page overflow fixes.
3. Add a Vitest component/style-contract test where practical (e.g. assert viewport meta
   content in `index.html`; NavBar renders brand + hamburger at mobile width).
4. If Option 1: backend token-in-body + `requireAuth` bearer fallback + refresh/logout body
   support; update `.orchestrate/api-contract.yaml`, `.doc/architecture.md`, `.doc/deployment.md`;
   Supertest tests for bearer auth, expired bearer → 401, refresh via body, cookie path unchanged.
5. If Option 1: frontend token store in `lib/auth.ts`, header injection + refresh-by-body in
   `lib/http.ts`, clear tokens on logout; Vitest tests for each.
6. If Option 2: document the same-site domain setup in `.doc/deployment.md`.
7. Manual check on a real iPhone 13 (or iOS simulator / Safari responsive mode for layout).

## Validation
- `cd frontend && npm test`, `npx vue-tsc --noEmit`, `npm run lint` all pass.
- If `stack:full`: `cd backend && npm test` passes, including new bearer-auth tests.
- `index.html` viewport meta contains `viewport-fit=cover` (test).
- At 390 px width no page has horizontal scroll and navbar items are fully visible
  (manual / Playwright viewport check).
- On an iPhone 13 Safari: log in, open Home, Jobs, CVs, Settings with no "Not authenticated"
  error; navbar and content have visible padding at all edges, including landscape.
- Desktop cookie login still works (existing tests unchanged and green).

## Risks
- Bearer tokens in `localStorage` widen XSS impact — mitigate with short access-token TTL
  (existing 15 min) and refresh-token rotation (already implemented).
- `env(safe-area-inset-*)` is 0 on non-notched devices; padding must use `max()` so nothing
  collapses there.
- Fix can't be fully verified without a real iOS device.

## Rollout Order
Layout fixes first (independent, low risk), then backend bearer support (backwards
compatible, deploy first), then frontend token usage.

## Rollback
Revert the branch. Backend change is additive (cookie path untouched), so a frontend revert
alone restores prior behavior.

## Revision 2 — post-deploy findings (2026-11-07)
Bearer login now works on the iPhone, but real-device testing found three remaining problems.
Same branch and Linear ticket (AI-106); user asked to proceed without a new approval gate.

**R2-1 Input zoom (layout).** Cause: iOS Safari zooms a focused field whose `font-size` is
under 16px; the shared field rules use `0.875rem`, and the zoom persists to the next page,
which also made content look flush to the edges. The first fix was lost/overridden (a later
`select` rule has equal specificity). Fix: 16px fields at `max-width: 639px`, placed at the
end of `frontend/src/styles/basics/base.scss`, plus `text-size-adjust: 100%` on `html`.
We deliberately do **not** set `maximum-scale=1` (it blocks user pinch-zoom, an
accessibility regression).

**R2-2 Browser-loaded files return 401 on Safari.** Cause: `<img src>`, `<iframe src>` and
`<a download>` are loaded by the browser itself and cannot send `Authorization: Bearer`.
Fix (frontend only, backend unchanged): fetch each file through `apiFetch` (bearer + 401
refresh-retry), turn the response into a `Blob`, and use an object URL:
- avatar (`NavBar.vue`, `SettingsPage.vue`, `lib/auth.ts`): fetch `/api/auth/me/profile-image`
  into a blob URL; re-fetch when `profileImageUrl` changes; revoke the old URL.
- CV preview (`JobCvsModal.vue`): replace the HEAD check with a GET of the file; the blob URL
  feeds the iframe; a failed fetch shows the existing "file couldn't be loaded" state;
  revoke on close/switch.
- CV download (`JobCvsModal.vue`): button that fetches `?download=1` through `apiFetch` and
  saves the blob with the CV's file name; failure shows a toast from the component.
- Helper in `frontend/src/lib/api.ts` (`fetchResumeFileBlob`); `getResumeFileUrl` stays.

**R2-3 Validation additions.**
- Tests: `base.scss` has the 16px mobile rule after the `select` rule; file helpers send the
  bearer header; blob URLs are created and revoked; failed fetch shows the error state/toast.
- Existing suites + `vue-tsc` stay green.
- On iPhone Safari: no zoom when focusing login fields or on the next page; Manage CVs
  dialog previews and downloads a CV; avatar shows in navbar and settings.

**Risks.** Blob PDFs in an iOS `<iframe>` show only the first page (Safari limitation) —
acceptable for preview; download remains available. Object URLs must be revoked to avoid leaks.
