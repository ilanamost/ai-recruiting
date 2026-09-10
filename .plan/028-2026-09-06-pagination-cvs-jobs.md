Status: done
Owner: orchestrator
Last updated: 2026-09-06

# Pagination for CVs and Jobs pages

## Addendum — 2026-09-06 (post-QA revisions)
After QA signed off, the user asked for a page-size selector, then asked to relocate it. Both
added directly, no scope change to Steps 1-6 (the backend already accepted any `limit` up to
the 500 cap — this only exposes a choice in the UI):

1. **First pass**: `Pager.vue` gained a "Rows per page" `<select>` and an `update:limit` emit
   alongside `update:page`, rendered inside the pager bar itself.
2. **Revision**: the user found the select awkward at the bottom of the page and asked for it
   to live at the top instead, grouped with each page's other filters/selects. `Pager.vue` was
   reverted to Prev/Next/"Page X of Y" only (no `update:limit`, presentational as originally
   designed). The select moved into:
   - `JobsListPage.vue`'s existing row-2 filter strip, alongside Location/Job creation
     date/Applied — reusing the same `select-wrap`/`ChevronDown` pattern already used there.
     Hidden via `v-if="!hasActiveFilter"`, same condition as the Pager itself, since a page-size
     choice has nothing to act on while filtering requests `UNPAGED_LIMIT` regardless.
   - `CvsListPage.vue`, which had no filter strip at all — a new one-item strip using the same
     `bg-bg`/`rounded-md`/`p-3` treatment was added below the header row, housing just the
     rows-per-page select, gated on `!loading && !error && resumes.length > 0`.
   Both pages keep their own `pageSize` ref and reset to page 1 on change (page 2 at limit 10
   has no defined meaning at limit 50) — that part of the first pass was unaffected, only the
   select's owning component and DOM position moved.

## Goal
Add real, server-side pagination to the two top-level list pages — CVs
(`frontend/src/pages/CvsListPage.vue`, backed by `GET /api/resume`) and Jobs
(`frontend/src/pages/JobsListPage.vue`, backed by `GET /api/job`) — so the
client requests one page of results at a time instead of fetching the full
table on every load, per the backlog item "Add pagination for each of the
pages data, Cvs and jobs" (`.plan/000-backlog.md`).

## Scope
- `stack:full`. `backend/` is a real Express + Postgres API (contrary to the
  stale note in `AGENTS.md`'s Repository Layout section — see Risks), and
  correct pagination requires `LIMIT`/`OFFSET` at the database layer, not
  just slicing an already-fully-fetched array. This corrects `AGENTS.md`
  after the plan lands (see Rollout Order).
- In scope:
  - `GET /api/job` and `GET /api/resume` accept `page`/`limit` query params
    and return a paginated envelope instead of a bare array.
  - `Store.listJobs` / `Store.listResumes` (both `memory-store.ts` and
    `pg-store.ts`) accept pagination and return `{ items, total }`.
  - `CvsListPage.vue` and `JobsListPage.vue` gain pagination controls (a new
    reusable `frontend/src/components/Pager.vue`).
  - `frontend/src/stores/job.ts` / `resume.ts` and `frontend/src/lib/api.ts`
    carry the new params/response shape.
- Out of scope:
  - `GET /:id/resumes` (the per-job "Manage CVs" list used by
    `JobCvsModal.vue`) — that list is small (resumes attached to one job)
    and not part of the backlog item, which names "each of the pages", i.e.
    the CVs and Jobs top-level pages.
  - Moving the existing client-side search/filter (`.plan/013`) to the
    server. See Open Questions for how filtering and pagination interact
    instead.
  - Changing page size per user, remembering the last page across
    navigation, or URL query-param deep-linking (`?page=2`) — not requested.

## Assumptions
- Default page size: 10 items, for both CVs and Jobs. Recommended; confirm
  at the approval gate.
- Neither `GET /api/job` nor `GET /api/resume` currently apply any
  role/ownership filtering server-side (`.plan/009`–`.plan/011`'s ownership
  scoping only touches edit/delete permission and the job-scoped
  `/:id/resumes` list) — confirmed by reading both routes and
  `CvsListPage.vue`. So `total` from a plain `COUNT(*)` / `.length` is
  accurate for every role; no ownership filtering has to happen inside the
  paginated query.
- `org_id` stays a required, separate filter on `GET /api/job`, applied
  before paging (`WHERE org_id = $1 ... LIMIT/OFFSET`).
- Postgres total count uses a second `count(*)` query rather than a
  `count(*) OVER()` window function, for readability over a demo-scale
  table; revisit only if profiling shows it matters.

## Open Questions
1. **How should pagination and the existing client-side Jobs filter
   (`.plan/013`) coexist?** Server-side pagination means the client only
   holds one page of jobs at a time, but `filteredJobs` in
   `JobsListPage.vue` filters whatever is currently in `jobs.value` — so
   filtering would silently only search the current page.
   **Recommended**: when any filter (title, location, date, applied-status)
   is active, request an effectively-unpaginated page (`limit=500` — the
   same ceiling as Open Question 3's cap, so this request isn't silently
   truncated below what it asks for) so filtering keeps searching the whole
   list exactly as it does today, and hide/disable the `Pager` while a
   filter is active; when
   no filter is active, use the normal paged request and show the `Pager`.
   This keeps the filter feature's behavior completely unchanged and keeps
   this task's scope to "add pagination," not "make filtering
   server-side." A future task can move filtering server-side if the org's
   data outgrows a single unpaginated filter query.
2. **Response envelope shape.** Recommended:
   `{ items: T[], total: number, page: number, limit: number }` for both
   endpoints — consistent, self-describing, lets the frontend compute
   `totalPages = Math.ceil(total / limit)` without a second request.
3. **Invalid/out-of-range `page`/`limit` query params** (non-numeric,
   negative, `page` beyond the last page, `limit` of 0 or absurdly large).
   Recommended: clamp rather than error — missing/invalid `page` defaults to
   1, missing/invalid `limit` defaults to 10 and is capped at 500 (matching
   Open Question 1's unpaginated-fallback request, so that request isn't
   itself silently clamped below what it asks for), a `page` past the last
   page returns an empty `items` array with the correct `total` (not a
   404) — since this is a query param a stale client link can easily
   produce, not a validation boundary worth failing loudly on (compare
   `.claude/skills/error-handling`'s guidance to reserve hard validation
   errors for malformed input the client controls, not for a page number a
   list can simply outgrow). This still means an org with more than 500
   jobs or CVs will see client-side filtering (Open Question 1) and
   `JobCvsModal`'s attach dropdown silently see only the first 500 —
   accepted for now per this plan's demo-scale assumption; a future task
   should move filtering server-side before that becomes real.

## Steps
1. **Backend types** (`backend/src/store/types.ts`): add
   `export interface Page<T> { items: T[]; total: number }` and a
   `export interface PageParams { page: number; limit: number }`. Change
   `listJobs(org_id: string): Promise<Job[]>` to
   `listJobs(org_id: string, params: PageParams): Promise<Page<Job>>`, and
   `listResumes(): Promise<ResumeWithCandidate[]>` to
   `listResumes(params: PageParams): Promise<Page<ResumeWithCandidate>>`.
2. **`backend/src/store/memory-store.ts`**: update `listJobs`/`listResumes`
   to filter/sort exactly as today, then `total = filtered.length` and
   `items = filtered.slice((page - 1) * limit, (page - 1) * limit + limit)`.
3. **`backend/src/store/pg-store.ts`**: update `listJobs`/`listResumes` to
   run the existing `SELECT ... ORDER BY ...` with `LIMIT $n OFFSET $n`
   appended, plus a `SELECT count(*)` query with the same `WHERE` clause
   (no `org_id` filter for resumes) for `total`.
4. **`backend/src/routes/job.ts`** (`GET /`, ~line 51): parse `page`/`limit`
   from `req.query` with the clamping rules from Open Question 3, call
   `store.listJobs(org_id, { page, limit })`, and
   `res.json({ items: jobs.items, total: jobs.total, page, limit })`.
5. **`backend/src/routes/resume.ts`** (`GET /`, ~line 32): same treatment,
   calling `store.listResumes({ page, limit })`.
6. **Backend tests**: extend `backend/tests/job.test.ts` and
   `backend/tests/resume.test.ts` with cases for default paging, an explicit
   `page`/`limit`, a `page` past the end (empty `items`, correct `total`),
   and invalid `page`/`limit` values (clamped, not a 400). Update
   `backend/tests/job-location-adversarial.test.ts:204`, which calls
   `store.listJobs('demo-org')` directly and reads the result as a bare
   array — change it to read `.items` from the new `Page<Job>` return and
   pass a `PageParams` argument.
7. **`.orchestrate/api-contract.yaml`**: record the new `page`/`limit` query
   params and the paginated response envelope for both endpoints — this is
   the frontend agent's and backend agent's shared source of truth per the
   dev-loop.
8. **`frontend/src/types.ts`**: add a generic `Page<T>` type mirroring the
   backend envelope.
9. **`frontend/src/lib/api.ts`**: change `listJobs(orgId)` to
   `listJobs(orgId, { page, limit })` returning `Page<Job>`, and
   `listResumes()` to `listResumes({ page, limit })` returning
   `Page<Resume>`, both appending the query params to the existing URLs.
10. **`frontend/src/stores/job.ts`**: add `total`/`page`/`limit` refs
    alongside `jobs`; `listJobs(orgId, page = 1, limit = 10)` stores
    `jobs.value = result.items` plus the new refs. `deleteJob` currently
    filters the deleted job out of `jobs.value` locally (`job.ts:44-47`) —
    change it to re-fetch the current page instead (a local filter would
    leave the page short of `limit` items even though a next page exists).
11. **`frontend/src/stores/resume.ts`**: same shape for
    `listResumes(page = 1, limit = 10, options?)`. `uploadResume` currently
    prepends locally (`resume.ts:36-40`) and `deleteResume` filters locally
    (`resume.ts:54-57`) — both need to re-fetch the current page for the
    same reason as `deleteJob` above.
12. **`frontend/src/components/Pager.vue`** (new): Tailwind-styled Prev /
    Next buttons plus a "Page X of Y" label, disabled at the first/last
    page, emitting a `page` update (`v-model:page` or an
    `@update:page` event) — follow the existing `select-wrap`/icon button
    patterns already used in `JobsListPage.vue` for visual consistency.
13. **`CvsListPage.vue`**: add a `page` ref, wire `Pager` below the list,
    call `resumeStore.listResumes(page)` on page change.
14. **`JobsListPage.vue`**: add a `page` ref; when
    `hasActiveFilter` (new computed: true if any of the existing filter
    refs is non-empty) request `listJobs(orgId, 1, 500)` and hide `Pager`
    (Open Question 1); otherwise request `listJobs(orgId, page, 10)` and
    show `Pager`. Keep the existing `filteredJobs` computed unchanged.
15. **Frontend tests**: `Pager.vue` unit test (button disabled states, emits
    correct page numbers); `stores/job.ts` / `stores/resume.ts` tests for
    the new paginated call shape; update any existing test that mocks
    `api.listJobs`/`api.listResumes` to return a bare array — it must now
    return a `Page<T>` envelope.
16. ~~**E2E** (Playwright)~~ — dropped: no Playwright/e2e is configured
    anywhere in this repo (`.claude/agents/frontend.md` is authoritative
    that only Vitest unit tests exist here); this step assumed tooling that
    doesn't exist. Step 15's Vitest coverage plus the manual checks below
    stand in for it.

## Validation
- `npx vitest run` and backend `npm test` both pass, including the new
  pagination cases in Steps 6 and 15.
- `npx vue-tsc --noEmit` passes (envelope type change is fully threaded
  through `api.ts` → stores → pages).
- Manual check: Jobs page with 15+ demo jobs shows 10 per page, Next/Prev
  work, and the existing title/location/date/applied filters still search
  every job (not just the current page) per Open Question 1's resolution.
- Manual check: CVs page paginates the same way; deleting a CV or uploading
  a new one leaves the current page showing exactly `limit` items (or fewer
  only on the last page), not a gap.

## Risks
- **`AGENTS.md`'s Repository Layout section is stale**: it states
  "`backend/` does not exist yet and is only created by a task explicitly
  marked `stack:full`," but `backend/` already exists as a real Express +
  Postgres API with `auth`/`job`/`match`/`resume` routes and both a
  `memory-store` and `pg-store`. This plan corrects that note once the task
  lands (see Rollout Order) — flagging here so review isn't surprised by an
  `AGENTS.md` diff in an otherwise pagination-only PR.
- Changing `GET /api/job` / `GET /api/resume`'s response shape is a
  breaking API contract change — any other consumer of these endpoints
  (there are none known today besides this frontend) would need updating
  too.
- `pg-store.ts`'s extra `count(*)` query doubles the query count for these
  two list endpoints; acceptable at current scale per Assumptions.

## Rollout Order
1. Frontend Agent writes `.orchestrate/api-contract.yaml` (Step 7) codifying
   the envelope and clamping rules this plan already decided in Open
   Questions 2–3, then implements Steps 8–16 (types → api.ts → stores →
   `Pager.vue` → pages → tests) against that contract. `api-contract.yaml`
   is write-scoped to the Frontend Agent only (`.claude/agents/frontend.md`)
   — the Backend Agent only reads it — so the contract is authored first
   even though the backend implements the storage/query side; nothing in it
   is left for backend to invent, since the shape was fixed in this plan.
2. Backend Agent implements Steps 1–6 (types → memory-store → pg-store →
   routes → tests) to match `.orchestrate/api-contract.yaml` exactly.
3. QA validates against this plan's Validation section.
4. On merge, fix `AGENTS.md`'s Repository Layout line to state `backend/`
   exists and describe it, rather than saying it doesn't exist yet.

## Rollback
- Frontend and backend changes ship in one PR (single workstream branch);
  revert the PR to fully roll back.
- If only the frontend pagination UI needs to be pulled back post-merge
  while keeping the backend envelope (e.g. a UI bug), `Pager.vue` can be
  hidden and the pages reverted to requesting `limit=500` unconditionally,
  since the backend change is backward-tolerant (omitting `page`/`limit`
  still returns page 1 of the default limit, not an error).
