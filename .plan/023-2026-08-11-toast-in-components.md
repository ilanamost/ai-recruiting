Status: done
Owner: Ilana
Last updated: 2026-08-11

## Goal
Partially reverse `.plan/018-2026-08-10-pinia-stores.md`'s error-notification design: a failed
mutation/lookup no longer calls `toast.error(...)` from inside the Pinia store — the store just
lets the rejection propagate — and the calling UI component is the one that shows the toast.
Everything else `.plan/018` established (stores own the data, stores are the only callers of
`lib/api.ts`, list-load failures render as a blocking `loadError` card rather than a toast)
stays exactly as it is — this is a narrower, targeted reversal of one specific design choice,
not a full rollback of the Pinia migration.

## Scope
In scope — twelve store actions across three stores lose their `try/catch { toast.error(...) }`
wrapping (the `catch` block existed only to toast and re-throw, so once the toast is gone there
is nothing left for the store to do in a catch — the function body reduces to the plain
`await`-and-update-local-state logic, and a rejection propagates to the caller unmodified,
exactly as it would with a pointless `catch (err) { throw err }`):

| Store action | File | Caller | Component's `catch` gets |
|---|---|---|---|
| `createJob` | `stores/job.ts` | `JobForm.vue`'s `onSubmit` | `toast.error(err instanceof Error ? err.message : 'Failed to create job')` |
| `updateJob` | `stores/job.ts` | `JobsListPage.vue`'s `saveEdit` | `'Failed to update job'` |
| `deleteJob` | `stores/job.ts` | `JobsListPage.vue`'s `confirmDelete` | `'Failed to delete job'` |
| `duplicateJob` | `stores/job.ts` | `JobsListPage.vue`'s `duplicate` | `'Failed to duplicate job'` |
| `attachResumeToJob` | `stores/job.ts` | `JobCvsModal.vue`'s `attach` | `'Failed to attach CV'` |
| `detachResumeFromJob` | `stores/job.ts` | `JobCvsModal.vue`'s `confirmDetach` | `'Failed to detach CV'` |
| `uploadResume` | `stores/resume.ts` | `CvsListPage.vue`'s `submitUpload` | `'Failed to upload CV'` |
| `updateResume` | `stores/resume.ts` | `CvsListPage.vue`'s `saveEdit` | `'Failed to update CV'` |
| `replaceResumeFile` | `stores/resume.ts` | `CvsListPage.vue`'s `onReplaceFileChange` | `'Failed to replace CV file'` |
| `deleteResume` | `stores/resume.ts` | `CvsListPage.vue`'s `confirmDelete` | `'Failed to delete CV'` |
| `getMatchForPair` | `stores/match.ts` | `JobCvsModal.vue`'s `loadPreviewExtras` (the `matchLookup` branch) | `'Failed to look up an existing match'` |
| `listLatestMatchesForJob` | `stores/match.ts` | `JobCvsModal.vue`'s `loadLatestMatches` | `'Failed to load match scores'` (new — this call currently swallows the error with no toast at all, relying on the store's now-removed toast; see Assumptions) |

Every fallback string above is copied verbatim from the store action it's replacing — this
task relocates existing user-facing text, it does not rewrite it.

- `stores/job.ts`: after removing the 6 `try/catch` blocks, `toast` becomes entirely unused in
  this file (its only other action, `listJobs`, uses `errorMessage`/`loadError`, never `toast`)
  — remove the now-dead `import { toast } from 'vue-sonner'`.
- `stores/resume.ts`: same — after removing 4 blocks, `toast` is unused (unrelated to
  `listResumes`'s `loadError` path, which is untouched) — remove the import.
- `stores/match.ts`: after removing both blocks, this store has no remaining use for `toast` OR
  `errorMessage` (it has no list-load/`loadError` concept at all) — remove both imports.
- Each store's top-of-file comment (all three currently describe the toast-on-mutation-failure
  design) needs updating to describe the new split accurately.
- Tests: every test asserting a store action calls `toast.error` moves that assertion to the
  component test that now owns the call; every test asserting a *component* does NOT call
  `toast.error` because "the store already handles it" gets inverted. This spans
  `frontend/tests/stores/{job,resume,match}.test.ts`, `frontend/tests/{JobForm,JobsListPage,
  CvsListPage,JobCvsModal}.test.ts`, and the adversarial files that touch these call paths
  (`frontend/tests/pinia-stores.adversarial.test.ts` at minimum — grep for `toast.error` across
  `frontend/tests/**` before starting to find every affected assertion, not just the ones named
  here).

Out of scope:
- List-load failures (`listJobs`, `listResumes`) — still set `loadError`, still render as the
  existing blocking card, never a toast. Nothing about this changes.
- `createMatch`/`getMatch` (back `MatchResult.vue`) — never toasted before `.plan/018` and don't
  now; that component renders its failure inline in the match card. Not affected by this task.
- `getResumeHtmlPreview`, `listJobResumes`, `getJob` — reads that were never toast-generating in
  either the pre-018 or post-018 design; nothing to move.
- Any change to *what* the stores own (data, API calls) — only the error-notification call site
  moves. A store action still updates `jobs`/`resumes` on success exactly as it does today.

## Assumptions
- Frontend-only, no backend involved.
- `loadLatestMatches` in `JobCvsModal.vue` (backing `.plan/021`'s best-match star) currently has
  no toast of its own — it relied entirely on the match store's now-removed
  `listLatestMatchesForJob` toast, so removing the store's toast without adding one here would
  make this specific failure mode go from "toasted" to "completely silent," a real regression
  this task must not introduce. Add the toast at the call site per the table above, keeping the
  existing behavior that a failure here doesn't block the rest of the modal (`latestMatches`
  still resets to `[]`, the star just doesn't render) — the toast is additive, not a replacement
  for that resilience.

## Open Questions
None — the backlog instruction is unambiguous and this plan's table gives an exact, mechanical
mapping from every current store-side toast to its replacement component-side call. There is no
design decision left to make; this is relocation, not redesign.

## Steps
1. **`frontend/src/stores/job.ts`**: remove the `try/catch` wrapping (and the `toast.error(...)`
   call inside it) from `createJob`, `updateJob`, `deleteJob`, `duplicateJob`,
   `attachResumeToJob`, `detachResumeFromJob` — each becomes just its plain `await api.X(...)`
   plus whatever local-state update it already does on success (e.g. `updateJob` still updates
   `jobs.value` after a successful call; only the `catch` block goes). Remove the now-unused
   `toast` import. Update the file's top comment.
2. **`frontend/src/stores/resume.ts`**: same treatment for `uploadResume`, `updateResume`,
   `replaceResumeFile`, `deleteResume`. Remove the unused `toast` import. Update the top comment.
3. **`frontend/src/stores/match.ts`**: same treatment for `getMatchForPair`,
   `listLatestMatchesForJob`. Remove the unused `toast` and `errorMessage` imports (this file
   has no other use for either after this change). Update the top comment.
4. **`frontend/src/components/JobForm.vue`**: `onSubmit`'s `catch { /* store already reported
   the failure as a toast */ }` becomes `catch (err) { toast.error(err instanceof Error ?
   err.message : 'Failed to create job') }`.
5. **`frontend/src/pages/JobsListPage.vue`**: same treatment for `saveEdit` (`'Failed to update
   job'`), `confirmDelete` (`'Failed to delete job'`), `duplicate` (`'Failed to duplicate
   job'`) — each currently has a `catch { /* store already reported... */ }` with a stale
   comment to replace.
6. **`frontend/src/pages/CvsListPage.vue`**: same treatment for `saveEdit` (`'Failed to update
   CV'`), `confirmDelete` (`'Failed to delete CV'`), `onReplaceFileChange` (`'Failed to replace
   CV file'`), `submitUpload` (`'Failed to upload CV'`).
7. **`frontend/src/components/JobCvsModal.vue`**: `attach` (`'Failed to attach CV'`),
   `confirmDetach` (`'Failed to detach CV'`) get the same treatment. `loadPreviewExtras`'s
   `matchLookup` ternary's `.catch(() => { /* already toasted */ })` becomes `.catch((err) => {
   toast.error(err instanceof Error ? err.message : 'Failed to look up an existing match') })`.
   `loadLatestMatches`'s `catch { latestMatches.value = [] }` becomes `catch (err) {
   latestMatches.value = []; toast.error(err instanceof Error ? err.message : 'Failed to load
   match scores') }` — keep the reset, add the toast alongside it, per Assumptions.
8. **Tests**: grep `frontend/tests/**` for `toast.error` and `toast.success` before touching
   anything, to find every assertion this change affects (not just the files named in Scope) —
   move each store-level "calls toast.error" assertion to the corresponding component test,
   invert each component-level "does NOT call toast.error, the store handles it" assertion, and
   add the one new case for `loadLatestMatches`'s previously-silent failure now toasting.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: trigger a failure on at least one mutation per store (e.g.
  stop the backend mid-action, or edit a job/CV with the network offline) and confirm the toast
  still appears with the same message text as before this change — the visible behavior should
  be unchanged; only where the code that produces it lives has moved.

## Risks
- The highest risk is silently dropping a toast somewhere (a call site that gets its `catch`
  block updated with the toast removed but not replaced) — the table in Scope is the checklist
  against which every one of the twelve sites should be verified, not just spot-checked.
- `loadLatestMatches` gaining a toast it never had before (Assumptions) is a small, deliberate
  UX addition bundled into this otherwise-pure-relocation task — flagged explicitly so it isn't
  mistaken for scope creep if questioned later.

## Rollout Order
Single frontend ticket — no backend involved. Store changes and component changes are
interdependent (a store with the toast removed but a component not yet updated would silently
drop that error's toast), so this should land as one coherent change, not split across two
tickets the way backend/frontend pairs were in earlier full-stack tasks this session.

## Rollback
Revert the commit touching `frontend/src/stores/{job,resume,match}.ts`,
`frontend/src/components/{JobForm,JobCvsModal}.vue`, `frontend/src/pages/{JobsListPage,
CvsListPage}.vue`, and every test file the grep in Step 8 identified.
