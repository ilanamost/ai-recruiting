Status: done
Owner: Ilana
Last updated: 2026-08-11

## Goal
Clicking a job's description on `JobsListPage.vue` opens a read-only preview dialog showing
that job's full details — untruncated description included — instead of only the 140-character
snippet the card shows today.

## Scope
In scope:
- `frontend/src/pages/JobsListPage.vue`: the description `<p>` becomes clickable (cursor
  pointer, click handler), opening a centered modal dialog — same visual pattern as
  `JobCvsModal.vue`'s preview dialog (`fixed inset-0 z-50 flex items-center justify-center
  bg-black/50` backdrop, a `card` panel, a close button) — showing the job's title, location
  (when set), full description, created date, and CV count. Read-only: no edit form, no
  delete/duplicate actions inside it (those stay on the card, where they already are).
- Tests: `frontend/tests/JobsListPage.test.ts` — clicking the description opens the dialog with
  the full (untruncated) description text; the dialog closes via its close control and via
  clicking the backdrop (matching `JobCvsModal.vue`'s existing preview-dialog close behavior).

Out of scope:
- Any backend change. `Job.description` is already the full string — `descriptionSnippet()`
  only truncates it for card display client-side; the data was never partial, just not shown in
  full. No new API call, no new store action.
- Editing from within the preview — the existing inline edit toggle on the card (already
  available to Admin/Recruiter) is untouched and stays the only way to edit a job.
- `CvsListPage.vue` or any other list — the backlog names "a job description" specifically;
  this task doesn't touch CV cards.
- Any role restriction on who can open the preview — every role that can already see the Jobs
  list can already see the full (untruncated) description via Edit, so a read-only preview adds
  no new access.

## Assumptions
- Frontend-only, no `stack:full` override needed — the data already exists client-side.
- "Implement similarly to the CV preview" means the same *dialog pattern*
  (`JobCvsModal.vue`'s preview overlay: backdrop, centered card, close button, backdrop-click-
  to-close) — not that this is nested inside another modal the way the CV preview sits inside
  "Manage CVs." There is no equivalent outer job-management modal to nest inside; this opens
  directly from the job card on `JobsListPage.vue`.

## Open Questions
1. **Does clicking anywhere on the card open the preview, or only the description text
   specifically?** The backlog says "when clicking on a job description," naming the
   description, not the whole card — the card already has several other click targets (Edit,
   Delete, Duplicate, Manage CVs buttons). **Recommended:** only the description `<p>` is
   clickable (cursor pointer, distinguishable from the plain title text above it), avoiding any
   conflict with the existing button click targets on the same card.

Proceeding with the recommended answer unless told otherwise.

## Steps
1. **`JobsListPage.vue`**: add `const previewJob = ref<Job | null>(null)` and
   `openPreview(job)`/`closePreview()` functions. Make the description `<p>` (currently
   `{{ descriptionSnippet(job.description) }}`) clickable — `class="cursor-pointer ..."`,
   `@click.stop="openPreview(job)"` (`.stop` so it doesn't bubble into any future card-level
   click handling) — keep rendering the truncated snippet on the card itself, only the dialog
   shows the full text.
2. Add the preview dialog markup after the existing job list, following `JobCvsModal.vue`'s
   preview-dialog structure: `<div v-if="previewJob" class="fixed inset-0 z-50 flex items-center
   justify-center bg-black/50 p-4" @click.self="closePreview">` wrapping a `card` panel with the
   job's title, a location badge (`v-if="previewJob.location"`, reusing the `MapPin` icon
   already used on the card), the full `previewJob.description` (`white-space: pre-wrap`
   equivalent Tailwind class so line breaks in the original description render, matching how
   `JobCvsModal.vue`'s text-content preview already handles a CV's plain-text content), the
   created date, the CV count, and a close button (`X` icon, matching `JobCvsModal.vue`'s close
   button).
3. **Tests**: per Scope's Tests bullet above.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: create a job with a description longer than 140 characters,
  confirm the card still shows the truncated snippet, click it, confirm the dialog shows the
  full text, confirm closing via both the close button and clicking the backdrop works.

## Risks
- None of note — additive UI, no data or authorization change, reuses an established dialog
  pattern already proven elsewhere in this app.

## Rollout Order
Single frontend ticket — no backend involved.

## Rollback
Revert the commit touching `frontend/src/pages/JobsListPage.vue` and its test file.
