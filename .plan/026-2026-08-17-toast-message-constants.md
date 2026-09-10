Status: done
Owner: Ilana
Last updated: 2026-08-17

## Goal
Remove hardcoded toast copy from the frontend. Every string literal passed to `toast.success(...)`
or `toast.error(...)` today lives inline at the call site; this task moves every one of them into
a single constants module and has every call site reference the constant instead of a literal.
Visible behavior does not change — same text, same toast type, same call sites — only where the
copy is authored changes.

## Scope
In scope — a new `frontend/src/lib/toastMessages.ts` exporting one `TOAST` object, with copy
**grouped by toast type first** (`success`, `error`, `info` — per feedback: separate by the kind
of message, not by domain), each key domain-prefixed (`jobUpdated`, `resumeAttached`, …) so keys
stay unique and traceable across the flattened `success`/`error` groups. `info` starts as an empty
object — the app has no `toast.info(...)` or `toast.message(...)` call site today, so there is
nothing to move into it, but the module reserves the slot so the first future info-style toast has
an obvious, consistent home instead of prompting a restructure.

32 call sites across 6 files map to 30 unique constants (2 literals are each reused verbatim at a
second call site, noted below):

**`TOAST.success`**

| Key | Copy | File : line |
|---|---|---|
| jobCreated | `Job created successfully` | `components/JobForm.vue:31` |
| jobUpdated | `Job updated` | `pages/JobsListPage.vue:156` |
| jobDeleted | `Job deleted` | `pages/JobsListPage.vue:187` |
| jobDuplicated | `Job duplicated` | `pages/JobsListPage.vue:201` |
| resumeUpdated | `CV updated` | `pages/CvsListPage.vue:95` |
| resumeDeleted | `CV deleted` | `pages/CvsListPage.vue:119` |
| resumeFileReplaced | `CV file replaced` | `pages/CvsListPage.vue:146` |
| resumeUploaded | `CV uploaded` | `pages/CvsListPage.vue:179` |
| resumeAttached | `CV attached` | `components/JobCvsModal.vue:229` |
| resumeDetached | `CV detached` | `components/JobCvsModal.vue:255` |
| settingsImageRemoved | `Profile image removed` | `pages/SettingsPage.vue:86` |
| settingsUpdated | `Settings updated` | `pages/SettingsPage.vue:137` |
| authLoggedIn | `Logged in` | `pages/LoginPage.vue:54` |
| authAccountCreated | `Account created` | `pages/LoginPage.vue:57` |

**`TOAST.error`**

| Key | Copy | File : line |
|---|---|---|
| jobValidationRequired | `Title and description are required` | `components/JobForm.vue:19`, `pages/JobsListPage.vue:146` (same literal reused at both) |
| jobCreateFailed | `Failed to create job` | `components/JobForm.vue:35` |
| jobUpdateFailed | `Failed to update job` | `pages/JobsListPage.vue:161` |
| jobDeleteFailed | `Failed to delete job` | `pages/JobsListPage.vue:191` |
| jobDuplicateFailed | `Failed to duplicate job` | `pages/JobsListPage.vue:205` |
| resumeValidationRequired | `Name and email are required` | `pages/CvsListPage.vue:89`, `:169` (same literal reused at both) |
| resumeFileRequired | `A CV file is required` | `pages/CvsListPage.vue:173` |
| resumeUpdateFailed | `Failed to update CV` | `pages/CvsListPage.vue:100` |
| resumeDeleteFailed | `Failed to delete CV` | `pages/CvsListPage.vue:123` |
| resumeFileReplaceFailed | `Failed to replace CV file` | `pages/CvsListPage.vue:149` |
| resumeUploadFailed | `Failed to upload CV` | `pages/CvsListPage.vue:184` |
| resumeAttachFailed | `Failed to attach CV` | `components/JobCvsModal.vue:234` |
| resumeDetachFailed | `Failed to detach CV` | `components/JobCvsModal.vue:261` |
| matchLoadFailed | `Failed to load match scores` | `components/JobCvsModal.vue:118` |
| matchLookupFailed | `Failed to look up an existing match` | `components/JobCvsModal.vue:196` |
| settingsImageRemoveFailed | `Failed to remove profile image` | `pages/SettingsPage.vue:88` |

Every fallback string in a dynamic `err instanceof X ? err.message : '...'` ternary keeps that
shape — only the literal fallback moves to `TOAST.error.<key>`; `err.message` itself is runtime
data, not a hardcoded value, and is out of scope.

Out of scope:
- `LoginPage.vue`'s inline `errorMessage.value = ... : 'Something went wrong'` — this renders as
  text in the template, not a toast, so it is not a "toaster message" and stays as-is.
- Field-validation copy (`'Name is required'`, `'Email is required'`, etc. in `LoginPage.vue`'s
  computed validators) — same reason, not a toast call.
- Any non-toast hardcoded string (route labels, button text, empty-state copy). The backlog line's
  broader framing ("no hard coded values in the application") is scoped down to its concrete,
  actionable ask — toaster messages — matching how `.doc/product-definition.md`'s prioritization
  rules favor scoring/UX correctness over sweeping the whole codebase for unrelated string
  literals. The second backlog line (SCSS) is a separate, unrelated task.
- `{ toasterId: 'center' }` and other `toast.success(...)`/`toast.error(...)` call *options* —
  only the message-text argument moves to a constant, not the call shape.

## Assumptions
- Frontend-only; no backend involved, no `stack:full`.
- `frontend/src/lib/` is this codebase's existing home for shared non-component modules
  (`api.ts`, `auth.ts`, `http.ts`, `theme.ts`, `animation.ts`), so `toastMessages.ts` belongs there
  rather than in a new top-level `utils/` directory.
- Grouping by toast type (`success`/`error`/`info`) rather than by domain (job/resume/…) is a
  deliberate choice per feedback on this plan's first draft, which grouped by domain instead —
  domain is preserved as a prefix on each key so nothing about traceability is lost, but the
  top-level shape now mirrors `toast.<type>(...)`, matching the reader's mental model of "which
  kind of toast is this" over "which feature is this".
- `resume`, not `cv`, is the key prefix for CV-related entries, per `.doc/glossary.md`'s "never
  call it a CV in code" rule — the English copy itself keeps saying "CV" since the glossary
  allows that in product-facing text; only the code-facing name changes.

## Open Questions
None — the backlog line, the existing toast call sites, and the success/error/info grouping from
feedback give an exact, mechanical mapping (the tables above). There is no design decision left to
make; this is relocation, not redesign.

## Steps
1. Create `frontend/src/lib/toastMessages.ts` exporting `export const TOAST = { success: {...},
   error: {...}, info: {} } as const` with every key from the Scope tables, copy text unchanged
   from today.
2. `components/JobForm.vue`: import `TOAST`, replace the three literals — line 19 →
   `TOAST.error.jobValidationRequired`, line 31 → `TOAST.success.jobCreated`, line 35's fallback →
   `TOAST.error.jobCreateFailed`.
3. `pages/JobsListPage.vue`: import `TOAST`, replace all seven literals (146, 156, 161, 187, 191,
   201, 205) with their matching `TOAST.success.*` / `TOAST.error.*` keys per the tables above.
4. `pages/CvsListPage.vue`: import `TOAST`, replace all eleven literals (89, 95, 100, 119, 123,
   146, 149, 169, 173, 179, 184).
5. `components/JobCvsModal.vue`: import `TOAST`, replace all six literals (118, 196, 229, 234,
   255, 261).
6. `pages/SettingsPage.vue`: import `TOAST`, replace the three literals at lines 86, 88, 137.
7. `pages/LoginPage.vue`: import `TOAST`, replace the two literals at lines 54, 57 (the unrelated
   `errorMessage` string on line 61 and the field-validation computeds stay untouched, per Scope).
8. Grep `frontend/src/**` for `toast.success(` and `toast.error(` after the above to confirm zero
   remaining string-literal arguments — dynamic `err.message` branches and the two de-duplicated
   fallbacks (`jobValidationRequired`, `resumeValidationRequired`) are the only expected
   non-`TOAST.*` shapes left, and even those now resolve through `TOAST.*` on the fallback side.
9. Tests: grep `frontend/tests/**` for the copy strings in the Scope tables (e.g. `'Job updated'`,
   `'CV attached'`) — existing assertions that check toast text keep passing unchanged (the
   rendered string is identical, so assertions comparing against the same literal continue to
   match); no test file should need a behavioral change. Add one new unit test file,
   `frontend/tests/lib/toastMessages.test.ts`, asserting the module's shape (e.g.
   `TOAST.success.jobUpdated === 'Job updated'`, `TOAST.info` is an empty object) so a future
   accidental edit to the copy is caught.

## Validation
- `cd frontend && npx vitest run` — 100% pass, no changed assertions beyond the new
  `toastMessages` test.
- `cd frontend && npx vue-tsc --noEmit` — clean.
- Grep-based check (Step 8) shows no remaining hardcoded `toast.success('...')` /
  `toast.error('...')` string literals outside of dynamic `err.message` ternary fallbacks, which
  now all resolve through `TOAST.error.*`.
- Manual spot check via the `run` skill: trigger one success toast (e.g. update a job) and one
  error toast (e.g. submit the CV form with empty name/email) and confirm the visible text is
  identical to before this change.

## Risks
- Missing a call site would leave a stray literal — the 32-row Scope tables are the exhaustive
  checklist; Step 8's grep is the mechanical verification that closes this risk, not a spot check.
- Collapsing each duplicated literal (`jobValidationRequired`, `resumeValidationRequired`) into one
  shared constant is a no-op today (identical text at both call sites) but means a future edit to
  one call site's copy now edits both — flagged here so it isn't mistaken for an accidental
  behavior change if the two ever need to diverge.
- An empty `TOAST.info` object is dead weight until the app's first info-style toast — acceptable
  because it was explicitly requested, but worth noting as the one piece of this change that isn't
  strictly "relocate an existing literal".

## Rollout Order
Single frontend ticket — no backend involved, and the new module plus every call-site update
lands together (a call site pointing at a constant that doesn't exist yet, or a constant nothing
references yet, are both intermediate states not worth landing separately).

## Rollback
Revert the commit adding `frontend/src/lib/toastMessages.ts` and touching
`frontend/src/components/{JobForm,JobCvsModal}.vue`, `frontend/src/pages/{JobsListPage,
CvsListPage,SettingsPage,LoginPage}.vue`, and the new `frontend/tests/lib/toastMessages.test.ts`.
