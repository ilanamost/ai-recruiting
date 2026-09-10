# Authentication and Role-Based Authorization

Status: done
Owner: Ilana
Last updated: 2026-08-03

## Goal
Add secure user authentication (signup/login/logout, hashed passwords, short-lived JWT access
token + rotating refresh token in httpOnly cookies) and role-based authorization (Admin,
Recruiter, Candidate) across the existing Jobs and CVs (Resume) routes. Unsigned users are
redirected to a new `/login` route instead of seeing the app. Add a header "Settings" menu
(User settings + Logout) and a User Settings page (edit name/email/password, optional profile
image).

## Scope
In scope:
- Backend: `app_user` + `refresh_token` tables, password hashing (bcrypt-family), JWT access
  token + opaque rotating refresh token issued as httpOnly/Secure cookies, `POST /api/auth/signup`,
  `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`, `GET /api/auth/me`,
  `PATCH /api/auth/me`, `GET /api/auth/me/profile-image`.
- Backend: `requireAuth` + `requireRole(...)` middleware, applied to every existing `/api/job` and
  `/api/resume` route per the permission matrix below. `/api/match` gated the same way.
- Frontend: `/login` route (login + signup forms), auth store (`lib/auth.ts`), router guard that
  redirects unauthenticated visitors to `/login` and blocks role-inappropriate routes, header
  "Settings" menu (icon trigger → "User settings" + "Logout", each with an icon) plus a round
  profile-image avatar in the header, `/settings` route (edit name/email/password/profile image).
- Frontend: hide "New Job" nav link for Candidate; hide/disable CV- and Job-mutation controls per
  the permission matrix.
- `.doc/product-definition.md`: move candidate accounts/login from "out of scope" to in scope
  (per its own Update Triggers rule — already agreed).

Out of scope (this plan):
- Linking the new `app_user` (login identity, role=candidate) to the existing anonymous
  `candidate` table (resume-owner metadata entered at upload time) — see Open Question 4.
- Email verification, "forgot password" flow, multi-org signup/org picker.
- Admin UI for managing other users' roles (Admin role exists and is fully authorized, but there
  is no "user management" screen yet — only self-service `/settings`).
- Rate limiting / brute-force lockout on `/api/auth/login` (flagged as a Risk, not built here).

## Permission Matrix
| Route | Admin | Recruiter | Candidate |
|---|---|---|---|
| `GET /api/job`, `GET /api/job/:id` | ✅ | ✅ | ✅ (read only) |
| `POST /api/job`, `PATCH /api/job/:id`, `DELETE /api/job/:id`, `POST /api/job/:id/duplicate` | ✅ | ✅ | ❌ 403 |
| `GET /api/job/:id/resumes` (list attached CVs) | ✅ | ✅ (read only) | ✅ |
| `POST /api/job/:id/resumes` (attach), `DELETE /api/job/:id/resumes/:resumeId` (detach) | ✅ | ❌ 403 | ✅ (corrected 2026-08-04 #2 — see Addendum) |
| `GET /api/job/:jobId/resumes/:resumeId/match` | ✅ | ✅ | ✅ (read only) |
| `GET /api/resume`, `GET /api/resume/:id`, `GET /api/resume/:id/file` | ✅ | ✅ (read only) | ✅ (corrected 2026-08-04 #2) |
| `POST /api/resume`, `PATCH /api/resume/:id`, `PUT /api/resume/:id/file` | ✅ | ❌ 403 | ✅ (corrected 2026-08-04 #2) |
| `DELETE /api/resume/:id` | ✅ | ❌ 403 | ❌ 403 |
| `POST /api/match` (create/score) | ✅ | ✅ | ❌ 403 |
| `GET /api/match/:id` | ✅ | ✅ | ✅ (read only) |
| `/api/auth/signup`, `/api/auth/login` | public (no session) | | |
| `/api/auth/logout`, `/api/auth/refresh`, `/api/auth/me` (GET/PATCH) | any authenticated role, own record only | | |

Frontend mirrors this: "New Job" nav link and the create-job page are hidden/blocked for
Candidate; CVs nav link and all `/cvs` mutation controls are hidden for Candidate (see Open
Question 1) and read-only (no Edit/Delete/Replace/Upload buttons) for Recruiter; Job
mutation/duplicate/Manage-CVs-attach controls are hidden for Candidate.

## Assumptions
- Password hashing via `bcryptjs` (pure-JS) rather than native `bcrypt` — avoids node-gyp/Python
  native build requirements on Windows dev machines; same algorithm family, same security
  properties, per `.rule/security-rules.md`'s "bcrypt or Argon2" guidance.
- Access token: JWT (`jsonwebtoken`, `JWT_SECRET` env var), 15 minute expiry, httpOnly/Secure/
  `SameSite=Lax` cookie named `access_token`. Refresh token: opaque random value, stored only as
  a SHA-256 hash in `refresh_token`, 30 day expiry, httpOnly/Secure/`SameSite=Lax` cookie named
  `refresh_token` scoped to `Path=/api/auth`. Rotated (old row revoked, new row inserted) on every
  `/api/auth/refresh` call. `Secure` is conditional on `NODE_ENV=production` since local dev runs
  over plain HTTP.
- `SameSite=Lax` is sufficient because frontend (`:5173`) and backend (`:3001`) are same-site
  (same `localhost` registrable domain) in dev, and any production deployment is assumed to keep
  frontend/backend on the same registrable domain (e.g. subdomains). See Open Question 3 if that
  assumption changes.
- CORS: add `credentials: true` to the existing `cors()` config in `backend/src/app.ts`; every
  frontend API call must send `credentials: 'include'`.
- New user signup assigns `org_id = 'demo-org'` (the existing seeded org) — no org picker yet,
  matching the current single-org assumption in `.doc/product-definition.md`.
- Signup only offers Recruiter or Candidate as the selectable role (see Open Question 2 for how
  Admin accounts get created).

## Open Questions
1. **Should Candidate have read-only access to the CVs list, or is `/cvs` fully hidden/blocked?**
   The request says a Candidate "cannot duplicate, edit, delete or manage Cvs'" but doesn't
   explicitly say whether viewing is allowed. Recommended: fully hide the CVs nav link and 403 all
   `/api/resume` routes for Candidate — there's no stated product need for a candidate to browse
   other candidates' CVs, and this mirrors how "New Job" is hidden outright rather than shown
   read-only. Proceeding with this default unless you say otherwise.
2. **How does the first Admin account get created?** Self-service signup offering "Admin" as a
   choice would let anyone grant themselves full access — a privilege-escalation risk per
   `.rule/security-rules.md`'s least-privilege principle. Recommended: signup form only offers
   Recruiter/Candidate; promote the first Admin manually after signup
   (`UPDATE app_user SET role = 'admin' WHERE email = '...'`), documented as a step in
   `backend/.env.example`'s neighboring README note. Proceeding with this default unless you say
   otherwise.
3. **Cross-domain cookies in production.** If frontend and backend ever end up on genuinely
   different root domains (not subdomains of the same domain), `SameSite=Lax` cookies won't be
   sent cross-site and auth will silently break. Recommended: accept this now (matches current
   same-site dev setup and `.doc/architecture.md`'s two-process model), revisit if/when a
   production topology is decided.
4. **Should the new `app_user` (Candidate role) be linked to the existing `candidate` table**
   (the anonymous name/email captured at resume-upload time)? Recommended: no, not in this plan —
   keep them separate. Linking them is exactly the "candidate views their own match score" feature
   `.doc/product-definition.md` already flags as a future revisit, and conflating the two now would
   force a bigger data-model decision (e.g., can one candidate account own multiple resumes?) that
   isn't part of this request. Proceeding with this default unless you say otherwise.

## Data Model
`backend/schema.sql` additions (see `.rule/database-rules.md` — additive, and must also be applied
to any already-running local/dev database since `create table if not exists` doesn't retroactively
alter one):

```sql
create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references org(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'recruiter', 'candidate')),
  profile_image bytea null,
  profile_image_mime text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_user_org_id_idx on app_user(org_id);

create table if not exists refresh_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists refresh_token_user_id_idx on refresh_token(user_id);
```

Named `app_user`, not `user` — `user` is a reserved word in Postgres and would require quoting
everywhere.

## API Surface
- `POST /api/auth/signup` — `{ name, email, password, role: 'recruiter' | 'candidate' }` → `201`
  `{ id, name, email, role }` + sets `access_token`/`refresh_token` cookies (signup logs you in).
- `POST /api/auth/login` — `{ email, password }` → `200` `{ id, name, email, role }` + cookies.
  `401` on bad credentials (generic "Invalid email or password" — never reveal which field was
  wrong).
- `POST /api/auth/logout` — revokes the current refresh token row, clears both cookies → `204`.
- `POST /api/auth/refresh` — reads `refresh_token` cookie, rotates it, issues a new `access_token`
  → `200` (no body needed) + cookies. `401` + clears cookies if the refresh token is missing,
  expired, or already revoked (reuse detection).
- `GET /api/auth/me` — `200` `{ id, name, email, role, org_id, has_profile_image }`. `401` if not
  authenticated.
- `PATCH /api/auth/me` — multipart: `name?`, `email?`, `new_password?` (requires `current_password`
  when changing password), `profile_image?` (file, image/png/jpeg/webp, 2MB limit). Changing
  password revokes all other refresh tokens for that user (per `.rule/security-rules.md`:
  "invalidate sessions on password change").
- `GET /api/auth/me/profile-image` — streams the authenticated user's profile image bytes, same
  pattern as `GET /api/resume/:id/file`. `404` if none uploaded.

## Steps
1. **Backend schema**: add `app_user` + `refresh_token` to `schema.sql`; apply the same DDL
   directly against the running local dev Postgres database (per `.rule/database-rules.md` — editing
   `schema.sql` alone does not retroactively migrate an existing DB).
2. **Backend store**: extend `store/types.ts` (`Store` interface) with `createUser`,
   `getUserByEmail`, `getUserById`, `updateUser`, `createRefreshToken`, `getRefreshTokenByHash`,
   `revokeRefreshToken`, `revokeAllRefreshTokensForUser`. Implement identically in
   `memory-store.ts` and `pg-store.ts`.
3. **Backend auth lib** (`backend/src/lib/auth.ts` or similar): password hashing/verification
   (`bcryptjs`), access-token sign/verify (`jsonwebtoken`), refresh-token generation/hashing
   (`crypto.randomBytes` + SHA-256), cookie option helpers (name, httpOnly, secure-by-env,
   sameSite, path, maxAge).
4. **Backend middleware**: `requireAuth` (verifies `access_token` cookie, attaches
   `req.user = { id, role, orgId }`, `401` `AppError` if missing/invalid) and
   `requireRole(...roles)` (`403` `AppError` if `req.user.role` not in the allowed list). New
   `AuthenticationError` (401) and reuse pattern of existing `AppError` subclasses in
   `lib/errors.ts`.
5. **Backend routes**: new `routes/auth.ts` implementing the API Surface above; wire into
   `app.ts` at `/api/auth` (before the auth-required routes). Add `credentials: true` to the
   existing `cors()` call. Apply `requireAuth`/`requireRole` to every route in `routes/job.ts`,
   `routes/resume.ts`, `routes/match.ts` per the Permission Matrix.
6. **Backend env**: add `JWT_SECRET` to `backend/.env.example` (never commit a real value).
7. **Frontend `lib/http.ts`**: a shared `apiFetch(url, options)` wrapper — always sets
   `credentials: 'include'`; on a `401`, attempts one `/api/auth/refresh` and retries the original
   request once, else propagates the error (the router guard's redirect-to-`/login` handles the
   rest). Route `lib/api.ts`'s existing calls through it instead of raw `fetch`.
8. **Frontend `lib/auth.ts`**: reactive `{ user, isLoading }` composable (mirrors `lib/theme.ts`'s
   style) with `login`, `signup`, `logout`, `fetchMe`, `updateProfile` (multipart), exposing
   `profileImageUrl` (points at `/api/auth/me/profile-image` when `has_profile_image`).
9. **Frontend `/login` route**: new `pages/LoginPage.vue` — toggle between Login and Signup forms
   (email/password; signup adds name + role radio limited to Recruiter/Candidate per Open Question
   2), inline validation errors, redirects to `/` on success.
10. **Frontend router guard**: `router/index.ts` `beforeEach` — unauthenticated + route other than
    `/login` → redirect to `/login`; authenticated Candidate visiting the create-job route (`/`) →
    redirect to `/jobs`. Add `/settings` route.
11. **Frontend header**: `NavBar.vue` — hide "New Job" link when `role === 'candidate'`; hide "CVs"
    link when `role === 'candidate'` (per Open Question 1); add a round-bordered avatar
    (`profileImageUrl` or a fallback `User` icon) + a "Settings" icon button that opens a menu with
    "User settings" (icon, routes to `/settings`) and "Logout" (icon, calls `auth.logout()` then
    redirects to `/login`).
12. **Frontend `/settings` route**: new `pages/SettingsPage.vue` — form for name/email, a
    change-password sub-section (current + new password), and a profile-image file input with a
    live preview; calls `auth.updateProfile`.
13. **Frontend RBAC gating**: `JobsListPage.vue`/`JobCvsModal.vue` — hide Edit/Delete/Duplicate and
    the attach/detach controls for Candidate. `CvsListPage.vue` — hide Edit/Delete/Replace/Upload
    controls for Recruiter (read-only) and hide the page entirely for Candidate per Open Question 1.
14. **Tests** (backend `backend/tests/`, frontend `frontend/tests/`) per `.rule/testing-rules.md`:
    - Backend: signup (happy path, duplicate email → `409`/`400`, weak/missing fields → `400`),
      login (happy path, wrong password → `401`), refresh (rotation, reuse-after-rotation →
      `401`), logout (revokes token, subsequent refresh with old token → `401`), `PATCH /me`
      (password change revokes other sessions), and an authorization test per Permission Matrix row
      (Candidate `403` on job mutation/resume routes, Recruiter `403` on resume mutation routes).
    - Frontend: `LoginPage` (login + signup flows, validation errors), `NavBar` (Settings menu
      open/close, "New Job"/"CVs" links hidden for Candidate, avatar rendering), router guard
      (unauthenticated → `/login` redirect), `SettingsPage` (field edit, password change,
      image upload preview).

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Live-database verification (per `.rule/database-rules.md`): confirm `app_user`/`refresh_token`
  exist in the actual local Postgres dev database (`information_schema`), not just the in-memory
  test store.
- Manual check via the `run` skill: signup as Recruiter → land on `/` (job creation visible);
  signup as Candidate → "New Job"/"CVs" hidden from nav, visiting `/` directly redirects to
  `/jobs`; log out → redirected to `/login`, revisiting any route redirects back to `/login`;
  edit name/email/password/profile image in Settings → avatar updates in header; wait past the
  15-minute access-token expiry (or shorten it locally for the check) and confirm a request
  silently refreshes instead of logging the user out.

## Risks
- No rate limiting on `/api/auth/login` yet — brute-force risk. Flagged as follow-up, not blocking
  this plan (the request didn't ask for it and it's a separable, additive change — e.g. a
  per-IP/per-email attempt counter).
- `app_user.email` uniqueness is enforced at the DB level (`unique`); the signup route must catch
  the resulting constraint violation and return a clean `409`/`400` rather than leaking a raw
  Postgres error (per `.rule/error-handling-rules.md` — never return raw provider payloads).
- Adding `requireAuth` to every existing route is a breaking change for any current caller that
  doesn't yet send cookies — acceptable here since this is a dev-stage app with no external
  consumers, but confirm nothing else (scripts, the QA agent's own test setup) calls these routes
  without going through login first.

## Rollout Order
1. Backend ticket lands first for the schema + auth endpoints + middleware (frontend cannot
   meaningfully build login/settings without a real backend to call, unlike the usual
   frontend-defines-contract sequencing used in prior plans) — the API Surface above is the
   contract; the Frontend ticket still owns writing it into `.orchestration/api-contract.yaml` per
   `.agents/frontend/AGENT.md` Step 4, but implementation-wise both tickets can start in parallel
   against this plan's Data Model / API Surface sections.
2. Frontend ticket applies `requireAuth` gating client-side once backend endpoints exist to call.
3. QA runs last against both.

## Rollback
Revert the commits touching `backend/schema.sql`, `backend/src/**` (new `auth.ts`, `lib/auth.ts`,
middleware, and the `requireAuth`/`requireRole` additions to `job.ts`/`resume.ts`/`match.ts`), and
`frontend/src/**` (new `LoginPage.vue`/`SettingsPage.vue`, `lib/auth.ts`, `lib/http.ts`, router
guard, `NavBar.vue` changes). Drop `app_user`/`refresh_token` tables if already applied to a dev
database. No production data exists yet, so no data-migration rollback is needed.

## Addendum — 2026-08-04 corrections and additions from live testing
After signing up and using the app as a Recruiter, four corrections/additions were requested:

1. **Permission Matrix correction**: CV attach/detach within the Jobs route (`POST`/`DELETE
   /api/job/:id/resumes*`) is now **Admin-only**, not Admin+Recruiter as originally specified.
   Recruiter keeps read-only access to a job's attached CVs (view, download) but cannot
   attach/detach, matching Recruiter's existing read-only status on the CVs route itself — the
   original matrix was inconsistent in letting Recruiter mutate the job↔CV association while
   blocking CV record mutation. `backend/src/routes/job.ts`'s two attach/detach routes changed
   from `requireRole('admin', 'recruiter')` to `requireRole('admin')`;
   `frontend/src/components/JobCvsModal.vue`'s `canManageAttachments` changed from `role !==
   'candidate'` to `role === 'admin'`, and the previously-ungated Detach button is now gated the
   same way.
2. **Self-service role change**: `PATCH /api/auth/me` now accepts an optional `role` field,
   restricted server-side to `'recruiter' | 'candidate'` (never `'admin'` — same restriction as
   signup). A role change counts as a privilege change and revokes every other outstanding session
   for that user, per `.rule/security-rules.md`. `SettingsPage.vue` shows the current role; for a
   non-Admin user it's an editable select (Recruiter/Candidate only); for an Admin it's a static
   "Admin (set via database)" label — Admin is still never self-service.
3. **Profile image UX**: replaced the native `<input type="file">` control with a clickable
   circular avatar (placeholder icon/text when empty, hover cursor pointer) — clicking it opens
   the file picker to add or replace a photo — plus a small "X" overlay button to remove the photo
   entirely. Removal calls `PATCH /api/auth/me` immediately with a new `remove_profile_image`
   field (multipart `'true'`), which the store's existing `profile_image: Buffer | null` typing
   already supported — no schema change needed.
4. **Form UX**: added a show/hide toggle to every password field (login, signup, Settings current/
   new password); the signup and Settings role field is a required `<select>` (not a radio group);
   added per-field validation with a red border (`.input-invalid`) and inline message
   (`.field-error`) for required fields (name, email, password, role) on both Login/Signup and
   Settings, shown after the first submit attempt. Fixed a CSS gap where `input[type='password']`
   was missing from `base.css`'s bordered-input selector, so password fields had no visible border
   anywhere in the app.

An explicit annotation-on-CV feature ("download a CV after adding annotation") was raised and then
explicitly dropped as out of scope for now — not built.

**Ownership-scoping follow-up**: the ownership scoping this addendum deferred ("this will change
later on") is implemented in `.plan/009-2026-08-08-candidate-cv-ownership-scoping.md` — a Candidate
can now only edit/replace/delete a CV, or attach/detach it to a job, when `resume.owner_user_id`
matches their own `app_user` id; Admin remains unrestricted, Recruiter remains read-only.

Tests added/updated: `backend/tests/authorization.test.ts` (Recruiter 403 on attach/detach, Admin
attach/detach still works), `backend/tests/auth.test.ts` (role self-change, admin-role rejection,
session revocation on role change, profile image removal), `frontend/tests/JobCvsModal.test.ts`
(Recruiter read-only), `frontend/tests/LoginPage.test.ts` and `frontend/tests/SettingsPage.test.ts`
(rewritten/extended for the select-based role field, password toggle, and validation indicators).
`cd backend && npx vitest run` — 129/129 pass. `cd frontend && npx vitest run` — 117/117 pass. Both
typechecks clean.

Also fixed the same day, unrelated to the above: `JobCvsModal.vue`'s PDF-loadability check used a
plain `fetch(..., { method: 'HEAD' })` with no credentials, so once every route required auth it
always got a `401` and showed "This CV's file couldn't be loaded" — for every role, not just the
one that happened to notice it. Switched it to the shared `apiFetch` wrapper (`lib/http.ts`), which
sends `credentials: 'include'`.

## Addendum — 2026-08-04 #2: Candidate gets broad CV access (temporary, not yet ownership-scoped)
After using the app as a Candidate, the request expanded significantly: a Candidate should see the
CVs route and be able to view/upload/edit/replace/download any CV, and attach/detach CVs to a job —
everything except deleting a CV outright and everything already blocked on the Jobs route (create,
edit, duplicate, delete a job stay Admin/Recruiter only).

**Explicitly deferred, by the requester's own words ("this will change later on")**: scoping a
Candidate's CV access to only the CVs *they* uploaded. That would require a new
`resume.owner_user_id` column linking a resume to the uploading `app_user`, plus a privacy decision
about whether a Candidate should see other candidates' names/emails/resumes at all when attaching to
a job (a real concern once ownership scoping lands — right now everyone with CV access sees
everyone's CVs, same as Admin always has). This addendum's implementation is deliberately the
simple, broad version — no schema change — matching that explicit instruction; ownership scoping is
a follow-up plan, not built here.

Permission Matrix changes (see table above): `POST`/`PATCH`/`PUT /api/resume*` and `GET
/api/resume*` open up to Candidate (not `DELETE`, which stays Admin-only); `POST`/`DELETE
/api/job/:id/resumes*` (attach/detach) open up to Candidate (Recruiter remains blocked, unchanged
from the first correction).

Frontend: `CvsListPage.vue`'s single `canManageCvs` flag split into `canEditCvs` (Admin +
Candidate: upload/edit/replace) and `canDeleteCvs` (Admin only); the page's Candidate block removed
entirely. `JobCvsModal.vue`'s `canManageAttachments` now includes Candidate. `JobsListPage.vue`'s
single `canManageJobs` flag split into `canManageJobRecord` (Admin + Recruiter: edit/duplicate/
delete a job) with CV count and "Manage CVs" now open to all authenticated roles (`load()` no longer
skips `listResumes()` for Candidate, since `GET /api/resume` isn't 403 for them anymore).
`NavBar.vue`'s "CVs" link is no longer hidden for Candidate (only "New Job" still is).

Tests updated: `backend/tests/authorization.test.ts` (Candidate's `/api/resume` block rewritten from
all-403 to mostly-allowed except delete; attach/detach flipped from 403 to allowed for Candidate),
`frontend/tests/{CvsListPage,JobsListPage,JobCvsModal,NavBar}.test.ts`.
