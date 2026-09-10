# Plan: Recruiting Platform UI/UX Redesign — Theming, Routing, Nav

Status: done
Owner: Ilana
Last updated: 2026-07-29

## Goal
Replace the current single-page, state-machine-driven frontend with a themed, routed multi-page
application: a modern visual design driven by CSS variables (colors, radii, shadows), real URL-based
navigation between Job / Resume / Match Result pages with working back/forward, a persistent nav bar,
a polished file-upload control that shows the picked file name instead of the browser default text, and
a centered success toast when a job is created.

## Scope
- In scope:
  - Design tokens: CSS custom properties for colors, spacing, border radius, shadow, and typography,
    organized per `.rule/style-rules.md` (`setup` → `basics` → `cmps` import order in `main.css`),
    mapped into Tailwind v4 via `@theme` so existing utility classes pick up the new tokens.
  - Restyle `JobForm.vue`, `ResumeUpload.vue`, `MatchResult.vue` and `App.vue` with the new tokens;
    replace hard-coded `slate-*` Tailwind colors with theme-mapped ones.
  - `vue-router` added and wired: routes for creating a job, uploading a resume against a job, and
    viewing a match result; a top nav bar (`@lucide/vue` icons per `.rule/ui-rules.md`) linking
    between them.
  - Match Result page reads a route param: if it identifies an existing match, fetch and show it
    (`GET /api/match/:id`, already implemented in `backend/src/routes/match.ts`); if not, and a
    job+resume are known, create the match and update the URL; otherwise show an empty state.
  - "Create a new job" and "Upload another CV" actions that reset the relevant flow and navigate.
  - Custom file-picker UI for `ResumeUpload.vue`: hides the native input's default label text,
    shows a prompt before a file is chosen and the file name after.
  - A visually distinct, center-of-screen success toast (`vue-sonner`, per `.rule/ui-rules.md`) for
    "Job created successfully", separate from the corner toaster used for other messages.
  - A light/dark theme toggle in the nav bar (resolved per Open Question 1 — user opted in), backed by
    a `frontend/src/lib/theme.ts` composable and `data-theme` attribute, persisted to `localStorage`.
  - Updated/added tests for the above; update `.doc/architecture.md`'s frontend section to reflect the
    new page/router structure (required when component ownership changes, per that file's own
    maintenance note).
- Out of scope:
  - Any backend/API changes — all required `GET` endpoints already exist and match
    `.orchestration/api-contract.yaml`.
  - Auth, multi-user/org switching, or anything beyond this repo's current single-`demo-org` flow.
  - New branch: **per explicit user instruction, this work stays on the current branch
    (`feat/recruiting-platform`)**, not a new `feat/<topic>` branch. This is a deliberate, one-time
    deviation from `.rule/versioning-rules.md`'s "create a new branch before executing" rule, agreed
    with the user for this task; larger features will get their own branch going forward.

## Assumptions
- `vue-sonner` and `@lucide/vue` are already dependencies (`frontend/package.json`) but unused in
  templates today except for icons in `MatchResult.vue` — this plan is the first real use of the toast
  library's styling surface.
- `vue-router` is not yet a dependency and needs to be added.
- Backend already implements `GET /api/job/:id`, `GET /api/resume/:id`, and `GET /api/match/:id`
  (`backend/src/routes/job.ts`, `resume.ts`, `match.ts`), so the frontend can fetch by id with no
  backend changes.
- `vue-sonner` supports multiple named `<Toaster id="...">` instances and routing a specific toast to
  one via `toast.success(msg, { toasterId })` (confirmed in
  `frontend/node_modules/vue-sonner/src/packages/types.ts`) — this is the mechanism for the
  center-screen "job created" toast without a custom modal component.
- Presentational components (`JobForm`, `ResumeUpload`, `MatchResult`) stay router-agnostic and keep
  emitting events (`created`, `uploaded`) as they do today; new thin page components
  (`JobPage`, `ResumePage`, `MatchPage`) own routing concerns (reading params, `router.push`/`replace`).
  This keeps the existing component tests (`frontend/tests/*.test.ts`) valid with minimal changes.

## Open Questions
1. **Dark mode: build a toggle now, or just structure tokens so it's easy later?**
   **Resolved: yes, add a light/dark toggle.** Tokens are defined under `:root` (light) and overridden
   under `[data-theme="dark"]`; default follows `prefers-color-scheme` when the user hasn't chosen
   explicitly, and an explicit choice is persisted to `localStorage` and applied via a `data-theme`
   attribute on `<html>`. A toggle button (sun/moon `@lucide/vue` icon) lives in the nav bar.
2. **Route URL shape.**
   Recommended:
   - `/` — create a job (`JobPage`)
   - `/jobs/:jobId/resume` — upload a resume against that job (`ResumePage`)
   - `/jobs/:jobId/matches/:matchId?` — match result, `matchId` optional (`MatchPage`)
   - any unmatched path redirects to `/`
   This keeps ids in the URL path (bookmarkable/shareable, consistent with the backend's `GET /:id`
   endpoints) rather than in query strings.
3. **What "current" state powers the nav bar and the Match page's empty/populated behavior?**
   Recommended: a small `frontend/src/lib/session.ts` composable holding reactive
   `{ jobId, jobTitle, resumeId, matchId }`, persisted to `localStorage` so a page reload doesn't lose
   context. The nav bar reads it to enable/disable "Upload CV" and "Match Result" links; `MatchPage`
   uses it to auto-create a match when a resume was just uploaded but no `matchId` is in the URL yet.
4. **Match score visual treatment.**
   Recommended: a horizontal score bar with a color band (red/amber/green by score range) plus the
   existing numeric score, using plain CSS driven by the new tokens — no new charting dependency.

*(Answer inline or in a follow-up message; recommended answers above will be used if none are given.)*

## Steps
1. **Dependencies** — add `vue-router` to `frontend/package.json`.
2. **Design tokens** (`.rule/style-rules.md` structure):
   - `frontend/src/styles/setup/tokens.css` — CSS custom properties for color (brand + semantic:
     surface, foreground, border, success/warning/danger), spacing, `--radius-*`, `--shadow-*`, font
     stack; mapped into Tailwind v4 via an `@theme` block so existing utility classes resolve to them.
   - `frontend/src/styles/setup/reset.css` — minimal base reset.
   - `frontend/src/styles/basics/` — base element styles (body, headings, form controls, buttons).
   - `frontend/src/styles/cmps/` — component-scoped styles (nav bar, card, toast overrides, file
     dropzone, score bar).
   - Update `frontend/src/main.css` to import Tailwind plus `setup` → `basics` → `cmps`, in that order.
3. **Session composable** — `frontend/src/lib/session.ts`: reactive, `localStorage`-backed
   `{ jobId, jobTitle, resumeId, matchId }` with setters and a `reset()`.
4. **API client additions** — `frontend/src/lib/api.ts`: add `getJob(id)` and `getMatch(id)` (both
   endpoints already exist server-side; only the frontend wrapper is missing).
5. **Router** — `frontend/src/router/index.ts` with the routes from Open Question 2; mount it in
   `frontend/src/main.ts`.
6. **NavBar** — `frontend/src/components/NavBar.vue`: links to Job/Resume/Match routes (via
   `router-link`, active-state styling, `@lucide/vue` icons), reading enabled/disabled state and target
   ids from `session.ts`.
7. **Page components** (thin, router-aware; wrap the existing presentational components):
   - `frontend/src/pages/JobPage.vue` — renders `JobForm`; on `@created`, writes to `session.ts` and
     `router.push`es to the resume route.
   - `frontend/src/pages/ResumePage.vue` — reads `jobId` from the route, shows a small job summary
     (via `getJob` if not already in session), renders `ResumeUpload`; on `@uploaded`, writes to
     `session.ts` and navigates to the match route (without a `matchId` yet).
   - `frontend/src/pages/MatchPage.vue` — reads `jobId`/`matchId` from the route:
     - `matchId` present → fetch via `getMatch` and render.
     - absent, but `session.ts` has a `resumeId`/`jobId` pair → create the match, then
       `router.replace` to the URL that includes the new `matchId`.
     - neither → empty state with a CTA back to `/`.
     Includes "Create a new job" (resets session, navigates to `/`) and "Upload another CV" (keeps
     `jobId`, clears `resumeId`/`matchId`, navigates to the resume route) actions.
8. **`App.vue` rewrite** — drop the manual `job`/`resume` ref state machine; render `NavBar`,
   `<router-view>`, and the two `Toaster` instances (default corner one + the dedicated centered one).
9. **File-picker UX** (`ResumeUpload.vue`) — replace the bare native `<input type="file">` with a
   custom control: visually-hidden native input for accessibility/click handling, a styled
   label/dropzone showing a prompt ("Drop a CV or click to browse") when no file is chosen, and the
   selected file's name (with a small clear/change affordance) once one is.
10. **Centered success toast** (`JobForm.vue` + `App.vue`) — add a second `<Toaster id="center"
    position="top-center" />` in `App.vue`, CSS-overridden in `cmps/` to sit at true vertical-center
    (`position: fixed; top: 50%; transform: translate(-50%, -50%)`); change the "Job created" call to
    `toast.success('Job created successfully', { toasterId: 'center' })` so only that message routes
    there, leaving other toasts (errors, "Resume uploaded", etc.) in the default corner toaster.
11. **Score visual** (`MatchResult.vue`) — add the color-banded score bar from Open Question 4.
11a. **Theme toggle** — `frontend/src/lib/theme.ts` composable (`getInitialTheme`, `toggleTheme`,
    reactive current value, `localStorage` persistence, applies `data-theme` on `document.documentElement`);
    a toggle button in `NavBar.vue` swapping sun/moon icons.
12. **Restyle pass** — apply the new tokens/utilities across `JobForm.vue`, `ResumeUpload.vue`,
    `MatchResult.vue`, `NavBar.vue`, page components: consistent card surfaces, spacing, shadows,
    focus states.
13. **Tests** — update `frontend/tests/JobForm.test.ts`, `ResumeUpload.test.ts`, `MatchResult.test.ts`
    for the file-picker markup change; add tests for `session.ts`, and router-level tests for
    `MatchPage` (existing-match fetch path, auto-create path, empty-state path) and for nav-bar
    link enabling/disabling, per `.rule/testing-rules.md` (happy-path + failure-path coverage).
14. **Docs** — update `.doc/architecture.md`'s Frontend section to describe the new
    `pages/`, `router/`, `components/NavBar.vue`, and `lib/session.ts` structure.

## Validation
- `npm test` and `npm run typecheck` pass in `frontend/` (existing scripts).
- Manual smoke test covering the full flow: create a job → centered success toast appears → land on
  resume page showing job context → pick a CV → input shows only the file name → land on match page,
  which creates the match and shows score + explanation → browser back returns to resume page → browser
  forward returns to the same match result (now loaded from `matchId` in the URL, not re-created) →
  nav bar can jump directly between all three pages → "Create a new job" and "Upload another CV" both
  work and correctly reset only the state they should.
- Reload the browser on the match URL directly (with a real `matchId`) and confirm it loads the
  persisted match rather than showing empty or re-creating it.
- Reload/visit the match route with no ids at all and confirm the empty state (not a blank page or
  console error).

## Risks
- **Toast centering fights the library's built-in corner positioning.** Mitigated by using a second,
  independently positioned `<Toaster id="center">` instance (confirmed supported by `vue-sonner`)
  instead of trying to override the shared default toaster's position globally.
- **Native file input styling is limited across browsers.** Mitigated by keeping the real `<input
  type="file">` for functionality/accessibility (visually hidden, not `display:none`, so it stays
  keyboard-focusable) and building the visible prompt/file-name UI alongside it, rather than trying to
  restyle the browser-native control directly.
- **Route/session state getting out of sync** (e.g., URL has a `matchId` for a job no longer in
  `session.ts`). Mitigated by having `MatchPage` always trust the URL's `matchId` first (fetch and
  display it) and only fall back to `session.ts` when the URL doesn't have one.
- **Existing component tests break** if presentational components are made router-aware directly.
  Mitigated by keeping routing logic in the new page-level wrappers only (see Assumptions).

## Rollout Order
1. Tokens + `main.css` restructuring (step 2) — no behavior change, safe to land first and verify
   nothing visually regresses before building on top of it.
2. Router + session composable + page wrappers + `App.vue` rewrite (steps 1, 3–8) — the structural
   navigation change.
3. File-picker UX and centered toast (steps 9–10) — the two specific UX asks.
4. Score visual and full restyle pass (steps 11–12) — polish once structure is stable.
5. Tests and docs (steps 13–14) alongside each preceding group, not saved for the end.

## Rollback
- All work lands as normal commits on the current branch (`feat/recruiting-platform`), per the explicit
  no-new-branch instruction for this task — `git revert` on the relevant commit(s) recovers the prior
  single-page `App.vue` state machine if any step needs to be undone. No destructive operations
  (force-push, history rewrite) are used at any point.
