Status: done
Owner: Ilana
Last updated: 2026-11-01

## Goal
Add one reusable loader component that is shown for as long as any API call is still
running, and use it **instead of** the loader(s) that exist today: the startup
`InitialLoader` (commit `a0fa014`) and the ad-hoc per-page
"Loading …" spinner rows. Backlog task: "Add a loader component, displayed until each
api call finishes running. Add it instead of the already existing loader."

## Scope
In scope (frontend only; no `stack:full` marker, no `backend/` changes):
- A tracker for in-flight API requests: a module-level reactive counter in
  `frontend/src/lib/` (same style as `lib/auth.ts` / `lib/theme.ts`), incremented when
  a request starts and decremented in `finally` when it settles (success or error).
- Hook the tracker into `apiFetch` in `frontend/src/lib/http.ts` so every call
  (including the silent refresh-and-retry) is covered with no per-caller code. The
  separate raw `fetch` calls to `/api/auth/*` in `lib/auth.ts` are routed through it too
  if they bypass `apiFetch`.
- A new `AppLoader.vue` component in `frontend/src/components/`, mounted once in
  `App.vue`, visible while the in-flight count is > 0.
- Remove `InitialLoader.vue`, `lib/initialLoader.ts`, the `#app-loader` mount point in
  `frontend/index.html`, and simplify `lib/startup.ts` / `main.ts` back to a plain
  mount. Replace the matching tests.
- Replace the per-page spinner rows (`CvsListPage`, `JobsListPage`, `JobCvsModal`,
  `MatchResult`) with the new loader — see Open Question 2.
- Styling per `.claude/rules/ui-and-styling.md`: Tailwind utilities by default, shared
  rules in `frontend/src/styles/cmps/loader.scss`, tokens only, no inline styles; icon
  from `@lucide/vue` (`Loader`, as used today).

Out of scope:
- Any backend change; changing what the API returns.
- Skeleton screens, progress bars, or per-request percentages.
- Changing toast/error behaviour (`.plan/023`, `.plan/026`).

## Assumptions
- Startup is covered because the first API call (`fetchMe` in the router guard) runs
  through `apiFetch`; the app shell no longer needs a separate pre-mount loader.
- `index.html` can show a static, CSS-only placeholder before the JS bundle loads if
  we want zero blank flash (see Open Question 3); otherwise nothing is shown until JS
  runs, as with any SPA.
- The loader must be accessible: `role="status"`, `aria-live="polite"`, spinner
  `aria-hidden`, and `prefers-reduced-motion` respected.

## Open Questions
1. **Overlay or inline?** Should the loader be a full-screen overlay that blocks the UI
   while any call runs, or a non-blocking indicator (e.g. a slim top bar / corner spinner)?
   Recommended: **non-blocking top-of-page indicator plus a centered spinner only for the
   initial/page-level load** — a blocking overlay on every call (e.g. each pager click or
   each match score request) would feel heavy. Simplest alternative: single centered
   overlay for everything.
2. **Which existing loaders does "instead of" cover?** (a) Only the startup
   `InitialLoader`, or (b) also the per-page "Loading CVs…/Loading jobs…/…" rows?
   Recommended: **(b) replace all of them** so there is exactly one loader pattern;
   inline rows that carry specific text become redundant.
3. **Anti-flicker.** Show the loader only after calls have run > ~150 ms, and keep it
   visible for a minimum ~300 ms once shown, so fast calls don't flash it?
   Recommended: **yes**, with both values as named constants in `lib/`.
4. **Branch.** Current branch is `feat/initial-load-loader` and holds the unmerged
   startup loader this plan removes. Recommended: **continue on this branch** (same
   workstream) rather than create `feat/add-loader-component`.
5. **Linear.** The Linear MCP server failed to connect (HTTP 401 invalid token), so the
   loop cannot create or move tickets. Recommended: refresh the token, or **skip Linear
   and track progress only in `.orchestrate/`** for this run.

## Steps
1. Add `frontend/src/lib/loading.ts`: reactive `pendingCount`, `isLoading` (computed,
   with the debounce / minimum-visible constants), `trackRequest(promise)` helper.
2. Wrap `apiFetch` (and the refresh call) with `trackRequest`; make `lib/auth.ts` use it
   for any direct `fetch`.
3. Create `components/AppLoader.vue` + `styles/cmps/loader.scss` (imported from
   `styles/cmps/index.scss`); mount in `App.vue`.
4. Remove `InitialLoader.vue`, `lib/initialLoader.ts`, `#app-loader` in `index.html`;
   simplify `lib/startup.ts` and `main.ts`.
5. Replace the per-page spinner rows (per Open Question 2) with the shared loader and
   drop their now-unused local `loading` refs only where nothing else reads them
   (e.g. `v-if="!loading && …"` guards stay).
6. Tests: add `tests/lib/loading.test.ts`, `tests/AppLoader.test.ts`; update/delete
   `InitialLoader.test.ts`, `initialLoaderService.test.ts`, `applicationStartup.test.ts`,
   and page tests that assert the old "Loading …" text.
7. Update `.doc/architecture.md` (frontend section) with the loader mechanism.

## Validation
- `cd frontend && npm test` passes.
- `cd frontend && npx vue-tsc --noEmit` passes.
- `cd frontend && npm run lint` passes.
- Unit test: `pendingCount` is 1 during a pending `apiFetch`, back to 0 after it resolves
  **and** after it rejects.
- Unit test: two concurrent calls keep `isLoading` true until both settle.
- Unit test: a 401 → refresh → retry sequence keeps `isLoading` true throughout.
- Component test: `AppLoader` renders `role="status"` only while loading, spinner is
  `aria-hidden`.
- Grep proves removal: no references to `InitialLoader`, `initialLoader`, or
  `app-loader` remain in `frontend/` (`grep -r` returns nothing).
- No inline `style=` and no new plain `.css` file added.

## Risks
- Overlay blocking interaction on slow calls → mitigated by the non-blocking
  recommendation (Q1) and the debounce (Q3).
- Counter drift if a request never settles → always decrement in `finally`.
- Existing tests that assert the old loading text will break → updated in Step 6.
- Removing the pre-mount loader may show a blank page until the JS bundle loads →
  Q3/assumption; acceptable or addable as static HTML.

## Rollout Order
1. `lib/loading.ts` + tests
2. `apiFetch` / auth wiring
3. `AppLoader` component + styles + `App.vue`
4. Remove the old startup loader
5. Replace per-page spinners
6. Docs

## Rollback
Revert the branch commit(s); the previous `InitialLoader` and per-page spinners return
unchanged. No data or schema is touched.
