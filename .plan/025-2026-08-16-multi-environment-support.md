Status: done
Owner: Ilana
Last updated: 2026-08-16

## Goal
The app currently only runs against `localhost` (frontend hardcodes a `localhost:3001`
fallback, backend hardcodes a `localhost:5173` CORS fallback, no non-`.env` env files
exist). Add real support for a `staging` and a `production` environment alongside the
existing local-dev setup, deploy the frontend to GitHub Pages, and leave clear written
instructions for filling in the env values needed to run staging/production for real.

## Scope
In scope:
- `frontend/`: Vite mode-based env files (`.env.staging`, `.env.production`), a `base`
  path that works both locally and as a GitHub Pages project page, and a router base
  that follows it.
- `backend/`: documented env var contract per environment (`DATABASE_URL`, `JWT_SECRET`,
  `PORT`, `FRONTEND_URL`, `NODE_ENV`, `SCORING_MODEL`, `ANTHROPIC_API_KEY`), and a fix to
  the auth cookie's `sameSite`/`secure` attributes — see Assumptions, this is a real bug
  once frontend and backend live on different origins, not new scope creep.
- A GitHub Actions workflow that builds and deploys `frontend/` to GitHub Pages on push
  to `master`.
- `.doc/deployment.md` (new): the filled-in instructions the backlog item asks for —
  what each env var means, where to put real values, and the one-time manual GitHub
  repo-settings step GitHub Pages requires.
- `.gitignore`: allow-list the new `.example` template files (it currently only
  allow-lists `.env.example`).
- `.doc/architecture.md`: short pointer to the new deployment doc, and a note on the
  cookie attribute change (auth-relevant, per CLAUDE.md's doc-update rule).

Out of scope:
- Actually provisioning or paying for a staging/production Postgres instance or a
  backend host (Render/Railway/Fly/etc.) — I have no accounts or credentials to do
  this, and it isn't a code change. `.doc/deployment.md` documents the contract so
  Ilana can point any Node+Postgres host at it.
- Enabling GitHub Pages in the repo's Settings → Pages, and adding the CI secrets/
  variables the workflow reads — both require GitHub repo-admin access I don't have.
  Documented as explicit manual steps in `.doc/deployment.md`.
- Any change to `frontend/.env`/`backend/.env` (the real, already-`.gitignore`d local
  files) — only `.example` templates are added, never real secrets.

## Assumptions
- GitHub Pages only serves static files, so it can host `frontend/`'s build output but
  never `backend/`. Staging/production backends need a separately hosted Node process
  and Postgres instance, wherever Ilana chooses to run them — this plan documents the
  env contract, not a specific host.
- **Cross-origin cookies are a real, pre-existing gap this task exposes.**
  `backend/src/lib/auth.ts`'s `baseCookieOptions()` currently hardcodes
  `sameSite: 'lax'` and `secure: NODE_ENV === 'production'`. That's correct only when
  frontend and backend share an origin (today: both `localhost`). Once the frontend is
  a GitHub Pages origin (`https://<user>.github.io`) talking to a backend on a
  different host, `sameSite: 'lax'` silently drops the auth cookies on cross-site
  fetches — login would appear to succeed (the response sets the cookie) but every
  subsequent request would look logged-out. Fixing this is required for staging/
  production to work at all, not an unrelated improvement.
- Vite already exposes `import.meta.env.BASE_URL`, derived from `vite.config.ts`'s
  `base` — pointing the router at it is a one-line change, not a new mechanism.
- `frontend/src/lib/{auth,api,http}.ts` already read `VITE_API_URL` with a
  `localhost:3001` fallback — staging/production just need that variable set via mode-
  specific env files; no source change needed there.

## Open Questions
All three resolved by Ilana — approved as recommended, no changes to Steps:
1. **GitHub Pages SPA routing** — resolved: history mode + 404.html fallback trick
   (not hash mode).
2. **Staging cross-origin cookies** — resolved: both staging and production get
   `sameSite: 'none'`/`secure: true`, keyed off `NODE_ENV !== 'development'`.
3. **Commit the GitHub Actions workflow now** — resolved: yes, commit it now even
   though it stays inert until Ilana does the one-time GitHub Settings steps.

## Steps
1. `frontend/vite.config.ts`: set `base: process.env.VITE_BASE_PATH ?? '/'` so CI can
   pass the GitHub Pages project-page path (`/ai-dev-agents/`) without a source change,
   while local `dev`/`preview`/`build` keep defaulting to `/`.
2. `frontend/src/router/index.ts`: `createWebHistory()` → `createWebHistory(import.meta.env.BASE_URL)`.
3. Add `frontend/.env.example`, `frontend/.env.staging.example`, `frontend/.env.production.example`,
   each documenting `VITE_API_URL=` with a one-line comment on what it should point to
   for that environment.
4. `frontend/package.json`: add `"build:staging": "vue-tsc -b && vite build --mode staging"`
   and `"build:production": "vue-tsc -b && vite build --mode production"` alongside the
   existing `build`.
5. Add `backend/.env.example`, `backend/.env.staging.example`, `backend/.env.production.example`,
   each listing `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `NODE_ENV`,
   `SCORING_MODEL`, `ANTHROPIC_API_KEY` with one-line comments (placeholder values only,
   e.g. `JWT_SECRET=changeme-generate-a-real-secret`).
6. `backend/src/lib/auth.ts`'s `baseCookieOptions()`: change to
   `sameSite: process.env.NODE_ENV === 'development' ? 'lax' : 'none'` and
   `secure: process.env.NODE_ENV !== 'development'` (SameSite=None requires Secure).
   Add/update a unit test covering both branches.
7. `.gitignore`: add `!.env.staging.example` and `!.env.production.example` next to the
   existing `!.env.example`.
8. `.github/workflows/deploy-frontend.yml`: on push to `master` touching `frontend/**`
   (plus `workflow_dispatch` for manual runs), `npm ci && npm run build:production` in
   `frontend/` with `VITE_API_URL` and `VITE_BASE_PATH` from repo variables, copy
   `dist/index.html` to `dist/404.html`, then deploy via `actions/upload-pages-artifact`
   + `actions/deploy-pages`.
9. New `.doc/deployment.md`: environments overview table, how to fill each `.example`
   file, the GitHub Pages one-time setup (enable Pages source, add
   `VITE_API_URL_PRODUCTION`/`VITE_BASE_PATH` repo variables), and a callout that
   `FRONTEND_URL` on the backend must exactly match the deployed frontend origin for
   CORS + cookies to work.
10. `.doc/architecture.md`: add a short "Environments & deployment" pointer to the new
    doc, plus a Change Log line noting the cookie `sameSite`/`secure` behavior now
    depends on `NODE_ENV`.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — pass.
- `cd backend && npx vitest run` and `npx tsc --noEmit` — pass, including the new/updated
  cookie-options test covering both `NODE_ENV` branches.
- `cd frontend && npm run build` (default, local) — still emits working root-relative
  asset paths, `dist/index.html` loads at `/`.
- `cd frontend && VITE_BASE_PATH=/ai-dev-agents/ npm run build:production` — emits
  `/ai-dev-agents/`-prefixed asset paths; `dist/404.html` exists and is byte-identical
  to `dist/index.html`.
- Manual (documented, not run by me): once Ilana enables GitHub Pages and adds the repo
  variables, a push to `master` should produce a working deploy at the Pages URL, able
  to log in against whatever backend `VITE_API_URL_PRODUCTION` points at.

## Risks
- The cookie `sameSite`/`secure` change is a real behavior change to auth, not purely
  additive — worth a careful look before approval since it affects every non-development
  request. Mitigation: gated strictly on `NODE_ENV`, so local dev (`NODE_ENV` unset or
  `development`) is byte-for-byte unchanged; only staging/production behavior changes,
  and only in the direction cross-origin deployment actually requires.
- Docs can drift from whatever host Ilana eventually picks for the backend (Render vs.
  Railway vs. something else) — `.doc/deployment.md` is written host-agnostically
  (env var contract, not a specific provider's UI) to minimize that.

## Rollout Order
Single branch, frontend + backend + CI + docs together — the pieces are only useful
combined (a workflow with no matching env vars, or env vars with no cookie fix, both
leave staging/production non-functional on their own).

## Rollback
Revert the branch's commit(s). The only files touched outside `frontend/`/`backend/`/
`.doc/` are `.gitignore` (two added lines) and the new workflow file — both trivially
revertible with no migration or data implications.
