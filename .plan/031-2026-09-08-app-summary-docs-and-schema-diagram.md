Status: done
Owner: Ilana
Last updated: 2026-09-08

## Goal
Produce onboarding-grade documentation of the entire application — thorough enough that
someone who reads it could credibly explain the system to a recruiter and be hired for the
job, per the backlog wording. Three new files under `.doc/`, split as the backlog requests:
a backend-focused summary, a frontend-focused summary, and a standalone schema diagram
showing how the database tables connect. Every architectural choice explained with its
reasoning, not just its shape.

## Scope
In scope:
- `.doc/backend-overview.md` (new): the application's purpose and functionality from the
  backend's vantage point, then a thorough walkthrough of:
  - Architecture: Express app structure, middleware chain, request lifecycle.
  - Data: the Postgres schema (tables, columns, indexes, constraints) at the level of "what
    each table is for and why it's shaped this way" — cross-referencing `schema.sql`'s
    existing inline comments and the `.plan/` entries that motivated each addition, not
    duplicating `.doc/schema-diagram.md`'s ER diagram itself.
  - Services: `extraction/` (PDF text extraction, post `.plan/030` PDF-only), `analysis/`
    (LLM-driven years-of-experience + skills extraction, degrade-to-unclassified behavior),
    the Anthropic scoring/match flow.
  - Store layer: `store/types.ts`'s `Store` interface, `pg-store.ts` vs `memory-store.ts`
    (why both exist — test isolation vs real persistence), and the pagination helper.
  - Routes: every route file (`auth`, `job`, `resume`, `match`, …), grouped by resource,
    with the permission matrix (admin/recruiter/candidate) explained per route, not just
    listed.
  - Authentication & authorization: JWT issuance, refresh-token rotation and hashing,
    `requireAuth`/`requireRole` middleware, ownership scoping (`resume.owner_user_id`).
  - External connections: the Anthropic API (prompt-caching strategy per
    `.doc/architecture.md`), environment/config loading (`.env` / `.env.staging` /
    `.env.production` per `.plan/025`).
  - For each major choice (why a `Store` interface with two implementations, why skills are
    a separate `resume_skill` table rather than a JSON column, why refresh tokens are hashed
    rather than stored raw, why analysis failure degrades instead of failing the upload,
    etc.) — state the choice AND the reasoning, in prose a non-engineer can follow.
- `.doc/frontend-overview.md` (new): same depth, frontend side:
  - Architecture: Vue 3 + Vite + Vue Router + Pinia, why this stack, the `pages/` vs
    `components/` split.
  - UI/UX: Tailwind v4 + the SCSS `setup/basics/cmps` tree (why both exist, per
    `.claude/rules/ui-and-styling.md`), the design-token approach, the home page's
    "what/how/features" structure, responsive/mobile nav behavior, animations, the CV/Job
    preview dialogs, the recruiter filter UI (`.plan/029`).
  - State/data flow: Pinia stores as the only place that calls the API (`.plan/018`), the
    toast-in-components pattern (`.plan/023`), how a store method, a page, and a component
    divide responsibility using one concrete example end to end (e.g. uploading a CV).
  - Connections: `lib/api.ts`'s fetch wrapper, how auth tokens attach to requests, how
    environment-specific API URLs are resolved (`.plan/025`).
  - Authentication/authorization on the client: `lib/auth.ts`, route guards, role-based nav
    visibility (`.plan/015`), what happens on 401/refresh failure.
  - Same "choice + reasoning" bar as the backend file.
- `.doc/schema-diagram.md` (new): a Mermaid `erDiagram` (GitHub renders Mermaid natively in
  `.md` files, so no external tool/image needed) covering every table in `backend/schema.sql`
  — `org`, `job`, `candidate`, `resume`, `resume_skill`, `job_resume`, `match`, `app_user`,
  `refresh_token` — with primary keys, foreign keys, and cardinality (1—many, many—many via
  `job_resume`) all correct against the actual `schema.sql`, plus a short prose walkthrough
  of the graph: how a candidate's upload becomes a `resume`, how `job_resume` links it to a
  `job`, how `match` scores that pair, and why `candidate` (freeform upload metadata) and
  `app_user` (login identity) are deliberately separate (`.doc/architecture.md`'s Open
  Question 4).
- Cross-linking: add one short pointer line near the top of `.doc/architecture.md` to the
  two new overview files and the schema diagram, so a reader starting from the existing doc
  finds them. Do not restructure or duplicate `architecture.md`'s existing content — it
  stays the concise reference; the new files are the expansive walkthrough.

Out of scope:
- Any change to application code, tests, or `schema.sql` itself — this is a documentation
  task only.
- A generated/exported image (PNG/SVG) of the schema diagram — the Mermaid block in the
  `.md` file is the deliverable.
- Auto-generating docs from code (e.g., OpenAPI/JSDoc tooling) — hand-written prose per
  `.doc/`'s existing convention.

## Assumptions
- "Diagram from the backend schema... could be added in a separate file" is satisfied by a
  Mermaid ER diagram inside `.doc/schema-diagram.md`, since these are Markdown docs read on
  GitHub/in-editor, not a chat surface — no artifact/image needed.
- The existing `.doc/architecture.md`, `.doc/glossary.md`, and `.doc/deployment.md` are not
  being replaced; the new files are additive and link back to them rather than repeating
  their content.

## Open Questions
1. Should `.doc/backend-overview.md` and `.doc/frontend-overview.md` also cover deployment
   (GitHub Pages, environment files)? Recommended: no — `.doc/deployment.md` already owns
   that; link to it instead of duplicating.
2. Is a single Mermaid `erDiagram` block enough, or does "diagram" imply also documenting
   non-schema relationships (e.g., which routes touch which tables)? Recommended: schema-only
   ER diagram, since the backlog line says "diagram from the backend schema... how the tables
   are connected" — table-to-table relationships specifically, not a route-to-table map.

## Steps
1. Write `.doc/schema-diagram.md` first (smallest, and both overview files will reference
   it) — Mermaid `erDiagram` plus prose walkthrough, verified line-by-line against
   `backend/schema.sql`.
2. Write `.doc/backend-overview.md` per the Scope outline above.
3. Write `.doc/frontend-overview.md` per the Scope outline above.
4. Add the cross-link pointer near the top of `.doc/architecture.md`.
5. Fact-check pass: verify every file path, route, table/column name, and library named in
   all three new files actually exists at that name in the current codebase.

## Validation
- Every file path mentioned in the three new docs resolves with a real file
  (spot-checkable via `Glob`/`Grep` — no invented paths).
- The Mermaid `erDiagram` in `.doc/schema-diagram.md` lists exactly the 9 tables in
  `backend/schema.sql` (`org`, `job`, `candidate`, `resume`, `resume_skill`, `job_resume`,
  `match`, `app_user`, `refresh_token`) with FK relationships matching the `references`
  clauses there.
- Every route named in `.doc/backend-overview.md` exists in `backend/src/routes/` with that
  method + path.
- `npx vitest run` (backend and frontend) and both `typecheck` scripts still pass —
  confirms this doc-only task made no accidental code edits.
- A read-through by a second pass (the QA step below) confirms no fabricated functionality:
  every described feature has a corresponding `.plan/*.md` entry or code location.

## Risks
- Documentation drifts from the code the moment either changes again — acceptable; these are
  point-in-time onboarding docs like `.doc/architecture.md` already is, not generated docs.
- Overlap with `.doc/architecture.md` could create two sources of truth that disagree later.
  Mitigated by keeping `architecture.md` as the terse reference and the new files as prose
  expansion that links to it rather than restating its content verbatim.

## Rollout Order
1. Schema diagram first (both overview docs reference it).
2. Backend overview, then frontend overview (independent of each other, can be parallel).
3. `architecture.md` cross-link and the fact-check pass last.

## Rollback
Delete the three new files and revert the `architecture.md` cross-link line. No code or data
is affected.
