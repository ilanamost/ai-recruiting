Status: active
Owner: Ilana
Last updated: 2026-09-14

## Goal
Get `backend/` running on a real, publicly reachable HTTPS URL so the GitHub Pages
frontend from [[033]] can actually call the API instead of failing every request.
[[033]] deliberately scoped this out ("Hosting the backend anywhere" was explicit
out-of-scope) and left it as Open Question 1. This plan closes that gap: deploy
`backend/` as a Render Web Service, provision Postgres on **Neon** (Render's own
free Postgres hit an account-level wall — see below), run `schema.sql` against it
once, wire the resulting API URL back into the frontend's `VITE_API_URL_PRODUCTION`
build variable, and verify login/CORS/cookies work end to end across the two origins.

## Scope
In scope:
- Deploying `backend/` as a Render Web Service (Render's native Node runtime — no
  Dockerfile needed, since `npm run build` / `npm run start` already produce and run
  `build/index.js`).
- Provisioning a **Neon** Postgres database (free tier) and running `backend/schema.sql`
  against it once (this repo has no migration tool — `schema.sql` is the only
  schema-bootstrap mechanism, and it's already idempotent: `create table if not
  exists` / `add column if not exists` throughout).
- Setting the production environment variables on the Render service, using
  `backend/.env.production.example` as the checklist, `DATABASE_URL` now pointing at
  the Neon connection string instead of a Render-hosted database.
- Optionally committing a `render.yaml` Blueprint for the web service (no `databases:`
  entry this time — Neon isn't a Render-native resource a Blueprint can provision).
- Closing [[033]]'s Open Question 1: once the Render URL exists, set
  `VITE_API_URL_PRODUCTION` in the repo's GitHub Actions variables and confirm
  `FRONTEND_URL` on Render matches the GitHub Pages origin exactly.
- An end-to-end verification checklist (health check, CORS, cross-site cookies,
  a real scoring call) — this is the part [[033]] flagged as "will look like a
  broken deploy but is actually a missing backend host."

Out of scope:
- Provisioning the database on Render itself. Attempted first (per the original
  version of this plan) and abandoned: Render caps an account at one active
  free-tier Postgres instance, and Ilana's account already has one in use elsewhere.
  Rather than force that constraint (upgrade to a paid Render Postgres, or delete an
  unrelated existing database), this plan splits providers instead.
- Choosing a different host than Render for the *web service* — that decision stands
  from the original version of this plan; only the database provider changed.
- Adding a proper migration framework — out of scope for getting a first deploy live;
  `schema.sql` run once is enough for now.
- Any GitHub Actions workflow for the backend. Render auto-builds/deploys on push to
  the connected branch by itself; there is nothing for CI to do here the way there was
  for GitHub Pages.
- Custom domains, staging environment, or autoscaling — single production
  service only.
- Rewriting `.doc/architecture.md` — still blanket-`.gitignore`d and absent from disk,
  same as [[033]] noted; not re-litigating that decision here.

## Assumptions
- Decisions made together with Ilana in conversation (recorded here for the record,
  not left as open questions):
  1. Web service host: **Render** — Node + a dashboard in one place, no Dockerfile
     required, free tier to start.
  2. Database host: **Neon** — chosen after Render's free Postgres turned out to be
     one-per-account and already spoken for. Neon is plain Postgres (no extra
     platform layered on top, unlike Supabase), has its own generous free tier, and
     needs zero backend code changes (see below) — a straight swap of `DATABASE_URL`.
- `backend/` needs no code changes to be deployable, on either provider: it already
  reads `PORT` from the environment with a fallback (`src/index.ts`), builds via `tsc`
  to `build/`, and starts via `node build/index.js` (`package.json` scripts). Render
  injects its own `PORT`; the app already honors whatever it's given.
- Neon's connection strings ship with `?sslmode=require` already appended. Verified in
  `backend/src/store/pg-store.ts`: `new Pool({ connectionString })` passes no explicit
  `ssl` option, but `pg`'s connection-string parser (`pg-connection-string`) reads
  `sslmode` out of the URL itself and configures TLS accordingly — so Neon's URL works
  as-is, no code change needed to switch providers.
- `backend/.env.production.example` is accurate as-is (verified by reading it):
  `DATABASE_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `NODE_ENV`, `SCORING_MODEL`,
  `ANTHROPIC_API_KEY`. It's missing `ANALYSIS_MODEL` (present in `.env.example` but not
  the production example) — worth adding for completeness in Step 1, though the app
  falls back to `claude-sonnet-5` if unset (`src/analysis/index.ts`) so it's not blocking.
- `FRONTEND_URL` must exactly match the GitHub Pages origin — `https://ilanamost.github.io`,
  scheme + host only, no path or trailing slash — or CORS (`src/app.ts`'s `cors()`) and the
  `sameSite: 'none'`/`secure: true` auth cookies silently fail. Already established in [[033]].
- A real `ANTHROPIC_API_KEY` is required for scoring/analysis to actually work
  (`src/scoring/index.ts`, `src/analysis/index.ts`); the app degrades gracefully without
  one (uploads still succeed, CVs are just stored unclassified) per `.env.example`'s comment,
  so it isn't a hard blocker for a first deploy, only for the feature that matters most.

## Open Questions
None currently blocking. Both provider decisions above are already resolved. One
thing to reconfirm at signup time, not before, since terms change: Neon's and
Render's exact current free-tier limits (storage/compute caps, autosuspend behavior)
— called out as a risk below rather than an open question, since it doesn't block
writing or executing this plan.

## Steps
1. `backend/.env.production.example`: add the missing `ANALYSIS_MODEL=claude-sonnet-5`
   line for parity with `.env.example`, so the production checklist is complete. Decide
   here whether to also add a committed `render.yaml` Blueprint for the web service only
   (env: node; build command `npm ci --include=dev && npm run build` — see Risks for
   why plain `npm ci` fails here; start command `npm run start`;
   health check path `/api/health`; no `databases:` entry, since Neon isn't provisioned
   through Render; secrets — `DATABASE_URL` now included, since it carries Neon
   credentials, plus `ANTHROPIC_API_KEY`/`JWT_SECRET` — marked `sync: false` so Render
   forces manual entry in the dashboard and the file never carries a real secret) —
   recommended since it documents the infra in-repo, but skip it if Ilana would rather
   click through the dashboard once and not maintain another config file.
2. Commit the `.env.production.example` fix (and `render.yaml`, if added) together.

## Manual steps (Ilana — needs Render and Neon accounts, which I don't have)
3. Create a free Neon project (neon.tech). Copy its connection string — Neon's
   dashboard gives you the full string with `?sslmode=require` already appended; this
   becomes `DATABASE_URL` in Step 6. Neon's SQL Editor (in-browser) can also run
   `schema.sql` directly in Step 7 without needing a local `psql` install.
4. Create a Render account and connect the `ilanamost/ai-recruiting` GitHub repo.
5. Provision the web service: **New → Web Service**, connect the repo, set:
   - Root directory: `backend`
   - Build command: `npm ci --include=dev && npm run build` — the `--include=dev` is
     required (see Risks): with `NODE_ENV=production` set as an env var, npm's
     default `omit=dev` behavior skips `devDependencies` during the build step,
     which breaks `tsc` since `typescript`, `@types/node`, `@types/pg`,
     `@types/multer`, etc. all live there.
   - Start command: `npm run start`
   - Health check path: `/api/health`
   - If `render.yaml` was committed in Step 1, use **New → Blueprint** instead and
     these fields come from the file.
6. Set environment variables on the Render service (from
   `backend/.env.production.example`): `DATABASE_URL` (the Neon connection string from
   Step 3), `JWT_SECRET` (generate a real one, e.g. `openssl rand -hex 32` — never
   reuse the placeholder), `FRONTEND_URL=https://ilanamost.github.io`,
   `NODE_ENV=production`, `SCORING_MODEL=claude-sonnet-5`, `ANALYSIS_MODEL=claude-sonnet-5`,
   `ANTHROPIC_API_KEY=<real Anthropic key>`. Do **not** set `PORT` — Render injects it.
7. Run the schema once against Neon: either paste `backend/schema.sql`'s contents into
   Neon's SQL Editor and run it, or `psql "<neon-connection-string>" -f backend/schema.sql`
   from a machine with `psql` installed. Confirm it completes with no errors (it's
   idempotent, so safe to re-run if ever needed).
8. Deploy the Render service (automatic once the service + env vars are saved) and
   watch the build/deploy logs until `backend listening on port <port>` appears and
   the health check goes green.
9. Copy the resulting service URL (e.g. `https://ai-recruiting-backend.onrender.com`).
10. Close [[033]]'s Open Question 1: GitHub repo → **Settings → Secrets and variables
    → Actions → Variables** → set `VITE_API_URL_PRODUCTION` to that URL. Push to
    `master` (or re-run the `deploy-frontend` workflow via `workflow_dispatch`) so the
    frontend rebuilds against the real backend.

## Validation
- `curl https://<render-url>/api/health` → `{"status":"ok"}`.
- Render service logs show a clean startup with no uncaught errors on boot; Neon's
  dashboard shows an active connection once the service is up.
- From `https://ilanamost.github.io/ai-recruiting/`, sign up and log in — confirms
  `FRONTEND_URL` matches, CORS accepts the request, and the `sameSite: 'none'`/
  `secure: true` cookies actually get set and sent cross-origin (not just correct in
  code — this is the exact failure mode [[033]] called out).
- Upload a CV against a job and confirm a match score is returned — exercises
  `DATABASE_URL`/`schema.sql` (Neon data layer) and `ANTHROPIC_API_KEY` (scoring/analysis)
  together, not just the health check.
- Re-check Step 10's GitHub Actions variable is actually picked up: view the deployed
  page's network tab and confirm API calls go to the Render URL, not `localhost` or a
  placeholder.

## Risks
- Hit in practice: setting `NODE_ENV=production` as a Render env var (required for
  the app's own cookie `sameSite`/`secure` logic) also makes npm's build-step
  `npm ci`/`npm install` default to `omit=dev`, skipping `devDependencies`. Since
  `typescript` and every `@types/*` package the build needs (`@types/node`,
  `@types/pg`, `@types/multer`, etc.) live in `devDependencies`, the `tsc` build
  failed outright (`Cannot find module 'pg'`, `Cannot find name 'Buffer'`, implicit
  `any` on every Express handler param). Fixed by changing the Build Command to
  `npm ci --include=dev && npm run build` — devDependencies are still absent from
  the final runtime image's relevance (nothing at runtime imports them), only the
  build step needs them present.
- Splitting providers means every database query now crosses the public internet
  between Render's region and Neon's region, instead of staying inside one host's
  network. Likely negligible at this app's scale, but worth picking Render and Neon
  regions close to each other (e.g. both US-East) to minimize it.
- Render's free-tier web service spins down after periods of idle traffic; the first
  request afterward pays a cold-start penalty (tens of seconds), which will look like
  a hang on the first login after inactivity. Neon's free tier also autosuspends when
  idle, but typically resumes in around a second — smaller and separate from Render's
  own cold start. Acceptable to start with; fix later by upgrading tiers if it becomes
  a real problem.
- Confirm both Render's and Neon's current free-tier limits (storage/compute caps,
  any project-lifetime limits) at signup time — these terms change — before relying on
  either beyond an initial trial. A reclaimed database is a data-loss risk, not just a
  downtime one; upgrade before there's real user data worth keeping.
- `ANTHROPIC_API_KEY`, `JWT_SECRET`, and now `DATABASE_URL` (carrying Neon credentials)
  are real secrets: enter them only through Render's dashboard environment-variable UI,
  never into `render.yaml` in plaintext (mark them `sync: false` in the Blueprint if
  one is committed) or into any commit.
- `FRONTEND_URL` mismatch (wrong scheme, stray trailing slash, wrong host) breaks
  CORS/cookies silently — the app loads, every API call just fails. This was already
  flagged in [[033]] and is the most likely thing to get wrong here too.

## Rollout Order
1. Commit the `.env.production.example` fix (+ `render.yaml`, if chosen) — Step 1-2.
2. Create the Neon project and copy its connection string — Step 3.
3. Manual Render provisioning, env vars, and schema load — Steps 4-9 (Ilana).
4. Set `VITE_API_URL_PRODUCTION` and redeploy the frontend — Step 10.
5. Run the full Validation checklist end to end before calling this done.

## Rollback
- Render: suspend or delete the Web Service from the dashboard. If `render.yaml` was
  committed, revert that commit — the service itself still needs deleting from the
  dashboard separately (Blueprint deletion doesn't retroactively tear down an
  already-provisioned service).
- Neon: delete the project from Neon's dashboard. Destructive and irreversible once
  reclaimed — take a `pg_dump` first if there's real data worth keeping.
- Frontend: reset `VITE_API_URL_PRODUCTION` to a placeholder and redeploy via the
  existing `deploy-frontend` workflow — no frontend data implications.
