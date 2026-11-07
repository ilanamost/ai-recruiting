=== BACKEND AGENT REPORT ===
Ticket: AI-107 (plan .plan/036-2026-11-07-mobile-iphone-auth-and-layout.md, Option 1)

Endpoints implemented (all per .orchestrate/api-contract.yaml v0.2.0, additive — cookie flow unchanged):
- POST /api/auth/signup  -> 201 { ...AuthUser, access_token, refresh_token } + cookies
- POST /api/auth/login   -> 200 { ...AuthUser, access_token, refresh_token } + cookies
- POST /api/auth/refresh -> 200 { access_token, refresh_token } + cookies (was empty 200);
  refresh token from cookie, else body `refresh_token`; rotation + reuse detection unchanged
- POST /api/auth/logout  -> 204; behind requireAuth (cookie or bearer); revokes cookie, else body, refresh token
- GET  /api/auth/me      -> unchanged, now reachable with Authorization: Bearer
- PATCH /api/auth/me     -> returns { ...AuthUser, access_token, refresh_token } only when a
  password or role change rotates the session; plain edits return AuthUser without tokens
- requireAuth (backend/src/middleware/auth.ts): valid cookie wins, else Authorization: Bearer <jwt>
- CORS (backend/src/app.ts): allowedHeaders ['Content-Type', 'Authorization'], origin FRONTEND_URL, credentials

Deviation from contract text: the contract names the 401 code `unauthorized`; the codebase's
existing code (ErrorCodes.UNAUTHENTICATED) is `unauthenticated`, which the cookie flow and the
frontend already use. Kept `unauthenticated` so nothing regresses — contract wording should be fixed.

Persistence: unchanged (existing Postgres store / in-memory store for tests). No schema change, no new env vars.

Unit tests: 403 passed, 0 failed (21 files; new: backend/tests/auth-bearer.test.ts, 24 tests)
Type check: npx tsc --noEmit clean

Docs: .doc/architecture.md, .doc/deployment.md, .doc/backend-overview.md

To run:
  cd backend && npm run dev

STATUS: DONE
