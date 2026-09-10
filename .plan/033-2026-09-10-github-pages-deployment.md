Status: proposed
Owner: Ilana
Last updated: 2026-09-10

## Goal
Get `frontend/` actually live on GitHub Pages. [[025]] already did the code-side prep
(mode-based env files, a `base`-aware Vite config, a `history`-mode router that reads
`import.meta.env.BASE_URL`, and cross-site-safe auth cookies) and its backlog entry is
marked done — but the two deliverables that make a deploy happen, a committed GitHub
Actions workflow and the one-time repo settings, were never actually produced: there is
no `.github/` directory on disk at all, and `.gitignore` currently blanket-ignores
`.github/`, so a workflow file could never have been tracked even if one had been
written. This plan closes that specific gap, step by step, so a push to `master` results
in a working `https://ilanamost.github.io/ai-recruiting/`.

## Scope
In scope:
- `.gitignore`: narrow the current blanket `.github/` ignore so `.github/workflows/`
  can be tracked. Nothing else lives under `.github/` today, so this is a one-line fix,
  not a redesign of the ignore rules.
- `.github/workflows/deploy-frontend.yml` (new): build `frontend/` in production mode
  and publish `frontend/dist` to GitHub Pages on every push to `master` (plus a manual
  `workflow_dispatch` trigger).
- Exact manual, one-time GitHub Settings steps for Ilana (repo-admin access required,
  which I don't have) — enabling Pages and setting the two build-time values the
  workflow needs.
- A short verification checklist to confirm the deploy actually works end to end,
  including the parts that are easy to get wrong (base path, SPA deep-link routing,
  cross-origin auth).

Out of scope:
- Hosting the backend anywhere. GitHub Pages only serves static files — it cannot run
  `backend/`'s Node/Postgres process. This plan assumes a backend is already reachable
  at some URL (per [[025]]'s deployment contract); if it isn't yet, the Pages site will
  load but every API call (including login) will fail. That's a separate, larger task.
- Re-doing any of the already-completed [[025]] code changes (base path, router,
  cookie `sameSite`/`secure`, env `.example` files) — verified present below, no changes
  proposed to any of them.
- Rewriting `.doc/deployment.md` or `.doc/architecture.md`. `.doc/` is currently also
  blanket-`.gitignore`d and absent from disk, same root cause as `.github/`. Re-creating
  the docs tree is a bigger, separate decision (whether `.doc/` should be tracked at
  all) than this plan's narrow goal of "make the Pages deploy actually work."

## Assumptions
- The repo's `origin` remote is `https://github.com/ilanamost/ai-recruiting.git`, so the
  GitHub Pages project-page base path is `/ai-recruiting/` and the eventual URL is
  `https://ilanamost.github.io/ai-recruiting/`. (Note: the root `.env`'s
  `VITE_BASE_PATH=/ai-dev-agents/` is a stale value from a template/prior project —
  it's gitignored and never reaches CI, so it doesn't block anything, but it will
  produce a broken local `build:production` if anyone runs it without overriding the
  var. Worth fixing locally; not a repo change.)
- Verified already in place from [[025]], so this plan builds on them rather than
  redoing them: `frontend/vite.config.ts` reads `base` from `process.env.VITE_BASE_PATH`;
  `frontend/src/router/index.ts` uses `createWebHistory(import.meta.env.BASE_URL)`;
  `backend/src/lib/auth.ts` sets `sameSite: 'none'`/`secure: true` off of `NODE_ENV`;
  `frontend/package.json` has a `build:production` script.
- History-mode routing (not hash mode) is the deliberate choice per [[025]]'s resolved
  Open Questions — GitHub Pages SPA support comes from a `404.html` copy of
  `index.html`, produced in CI, not from a `#/` URL scheme.

## Open Questions
1. Where is (or will) the production backend be hosted, so `VITE_API_URL_PRODUCTION`
   has a real value? Not blocking this plan (the workflow reads it as a variable
   either way) but the deploy won't be functionally complete without an answer.

## Steps
1. `.gitignore`: replace the blanket `.github/` line with `.github/*` +
   `!.github/workflows/`, so future non-workflow files under `.github/` stay ignored by
   default but the workflow directory is trackable.
2. Add `.github/workflows/deploy-frontend.yml`:
   - Triggers: `push` to `master` with `paths: ['frontend/**']`, plus
     `workflow_dispatch` for manual runs.
   - `permissions: { pages: write, id-token: write }`.
   - Steps: checkout → `actions/setup-node` (Node version matching `frontend/package.json`
     engines, or LTS) → `npm ci` in `frontend/` → `npm run build:production` in
     `frontend/`, with `VITE_API_URL: ${{ vars.VITE_API_URL_PRODUCTION }}` and
     `VITE_BASE_PATH: ${{ vars.VITE_BASE_PATH }}` as env → `cp dist/index.html
     dist/404.html` (SPA fallback) → `actions/upload-pages-artifact` pointing at
     `frontend/dist` → `actions/deploy-pages` (as a dependent `deploy` job using the
     `github-pages` environment).
3. Commit both files together in one PR/commit — the workflow is inert without the
   `.gitignore` fix, so splitting them buys nothing.

## Manual steps (Ilana — needs repo-admin access I don't have)
4. GitHub repo → **Settings → Pages → Build and deployment → Source**: set to
   **GitHub Actions** (not "Deploy from a branch").
5. GitHub repo → **Settings → Secrets and variables → Actions → Variables**: add
   - `VITE_BASE_PATH` = `/ai-recruiting/`
   - `VITE_API_URL_PRODUCTION` = the real production backend URL (from whatever host
     runs `backend/` — see Open Questions).
6. On whatever host runs the production backend, set `FRONTEND_URL` =
   `https://ilanamost.github.io` (scheme + host only, no trailing path or slash — this
   must match exactly for `backend/src/app.ts`'s CORS check and for the cross-site
   auth cookies to be accepted).
7. Push to `master` (or merge the PR from Step 3) and watch the **Actions** tab for the
   `deploy-frontend` run to go green.

## Validation
- Local, before pushing: `cd frontend && VITE_BASE_PATH=/ai-recruiting/
  VITE_API_URL=<a real or placeholder URL> npm run build:production` — succeeds,
  `dist/index.html` and `dist/404.html` exist and are byte-identical, and asset `src`/
  `href` paths in `dist/index.html` are prefixed with `/ai-recruiting/`.
- Local smoke test: `npx vite preview --outDir dist --base /ai-recruiting/` (or any
  static file server rooted at `frontend/dist`) and click through a couple of routes.
- After the workflow runs: open `https://ilanamost.github.io/ai-recruiting/` and confirm
  the app shell loads with no 404s in the Network tab (catches a wrong base path).
- Navigate to a nested route directly by URL (e.g. paste
  `https://ilanamost.github.io/ai-recruiting/jobs` into the address bar) and hard-refresh
  — confirms the `404.html` SPA fallback is working, not just client-side navigation.
- Log in against the real backend from the deployed frontend — confirms `FRONTEND_URL`,
  CORS, and the `sameSite: 'none'`/`secure: true` cookie settings actually line up
  cross-origin, not just in code.

## Risks
- The workflow stays inert (never runs, or runs and fails at the Pages-publish step)
  until the manual Steps 4–6 are done — same caveat [[025]] already called out. Not
  avoidable: repo Settings and CI variables need admin access I don't have.
- If the production backend isn't deployed/reachable yet, the site will load but every
  API call will fail — this looks like a broken deploy but is actually a missing
  backend host, a separate task from this one.
- Narrowing `.gitignore`'s `.github/` rule to `.github/*` + `!.github/workflows/`
  assumes nothing else is meant to live untracked under `.github/`; true today (the
  directory doesn't exist yet), worth re-checking if that changes later.

## Rollout Order
Single commit: `.gitignore` fix + workflow file together, since one is useless without
the other. Manual Settings/variables steps happen once, after merge, and are idempotent
(safe to redo if a value needs correcting).

## Rollback
Revert the commit — deletes the workflow and restores the blanket `.github/` ignore.
If Pages was already enabled and should be turned off, Settings → Pages → Source → None.
No data or migration implications; this is CI/static-hosting config only.
