# Job CV Preview: Stacked Dialog + Select Affordance Fixes

Status: done
Owner: Ilana
Last updated: 2026-08-02

## Goal
Fix the uncomfortable "Manage CVs" resume preview UX on the Jobs route: the PDF preview
currently renders cramped in a side-by-side column inside the same dialog as the CV list,
causing a double scrollbar. Move the preview into its own dialog stacked on top of the
CV-list dialog. Also fix the unattached-CV select control so it reads as a real select box
(border) and doesn't show a dropdown arrow when there's nothing left to select.

## Scope
In scope — `frontend/src/components/JobCvsModal.vue`, `frontend/src/styles/basics/base.css`:
- Split the resume preview out of the side-by-side grid into a second dialog that opens on
  top of `JobCvsModal` when a CV card is clicked.
- Closing the preview dialog (X button or backdrop click) closes only the preview, not the
  parent "Manage CVs" dialog.
- Enlarge the parent dialog now that it no longer needs to share width with the preview
  column.
- Size the preview dialog so the PDF/text preview and the `MatchResult` block below it sit
  in a single scroll region (no nested/double scrollbars).
- Style `<select>` with a visible border/background (matching the existing `input`/`textarea`
  treatment) so "Attach a CV" reads as a control, not plain text.
- Hide the native dropdown arrow on the select when disabled (no unattached CVs left).
- Make the "No unattached CVs available" option text bolder / a theme color instead of
  default option styling.

Out of scope:
- Any backend/API change — this is presentation-only, no contract change.
- Changing `MatchResult.vue` internals.
- A reusable/shared `Dialog` component — no other nested-dialog usage exists in the codebase
  today, so this stays local to `JobCvsModal.vue` rather than introducing a new abstraction.

## Assumptions
- No design system dialog primitive exists yet (confirmed: no Radix/shadcn `Dialog` in
  `frontend/src`), so the second dialog is hand-rolled the same way the existing one is
  (`fixed inset-0` overlay), just with a higher `z-index` so it stacks above the parent.
- "Bigger than its size now" means the parent list dialog's `max-w` should grow now that it's
  single-column again (currently `max-w-3xl`), not a change to viewport-fill behavior.

## Open Questions
None — scope is fully determined by the existing component and the request. Proceeding
without a human answer needed here.

## Steps
1. `frontend/src/styles/basics/base.css`: add a `select` rule mirroring the existing
   `input[type='text']`/`textarea` border/background/radius treatment, plus a `select:disabled`
   rule that removes the native arrow (`appearance: none`) and bumps `font-weight`/`color` for
   the placeholder text.
2. `frontend/src/components/JobCvsModal.vue`:
   - Remove the `md:grid-cols-2` side-by-side layout; the attached-CV list goes back to a
     single full-width column with its own `overflow-y-auto`.
   - Widen the parent dialog (`max-w-3xl` → `max-w-4xl`).
   - Add a second top-level overlay (`z-[60]`, above the parent's `z-50`) rendered when
     `previewResume` is set, containing the file-name header + close button, the PDF/text
     preview, and `MatchResult` below it, all inside one `overflow-y-auto` container so there
     is exactly one scrollbar.
   - Backdrop click / X on the preview dialog calls the existing `closePreview()` — it must
     not emit `close` (which would dismiss the parent dialog too).
3. Manual verification in the running app (see Validation).

## Validation
- `cd frontend && npx vitest run` — existing unit tests must still pass.
- Manual check via the `run` skill: open Jobs → Manage CVs on a job with attached CVs →
  click a card → preview opens in its own dialog on top, parent dialog stays open behind it
  → close preview (X and backdrop) → parent dialog still open, list intact.
- Confirm only one scrollbar appears in the preview dialog when content is long (PDF + match
  result together).
- Confirm the select box has a visible border in the enabled state, and no dropdown arrow +
  bold/colored text when there are no unattached CVs.

## Risks
- Low risk: presentation-only change to one component and one shared stylesheet rule. The
  new `select` CSS is scoped to the element selector, so it could affect other `<select>`
  elements elsewhere in the app if any exist — will grep for other `<select>` usages before
  landing the CSS change to confirm no unintended styling drift.

## Rollout Order
Single change, frontend-only. No backend/API contract involved, so no ticket sequencing
needed beyond this one plan.

## Rollback
Revert the commit touching `JobCvsModal.vue` and `base.css`; no data/schema/API changes to
unwind.
