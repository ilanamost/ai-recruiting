Status: superseded — see .plan/030-2026-09-08-remove-docx-cv-support.md (DOCX support removed)
Owner: Ilana
Last updated: 2026-09-08

## Addendum — 2026-08-10 (post-review revision)
The initial implementation gave both containers a fixed `h-[384px] max-w-[964px]` per the
reviewer's first-stated numbers. That shrank the PDF preview relative to its prior size, so the
reviewer clarified: match the PDF preview's *original* size exactly, not a new fixed value.
Final result: both containers use the PDF's original `h-[65vh] min-h-[24rem]` (viewport-relative
height, no width cap) — identical classes on both, DOCX additionally keeping its own
`overflow-y-auto`/border/padding/`shadow-card-md` since rendered HTML doesn't scroll itself the
way an iframe does.

## Goal
The DOCX preview pane in `JobCvsModal.vue` (rendered HTML per
`.plan/012-2026-08-09-docx-preview-rendering.md`) sits in a container matching the PDF
preview's iframe: same height/width footprint, and a box-shadow consistent with the rest of
the app's design tokens — today the PDF branch is boxed (`h-[65vh] min-h-[24rem]`, rounded
border) while the DOCX branch's rendered HTML flows unbounded with no matching container.

## Scope
In scope:
- `frontend/src/components/JobCvsModal.vue`: wrap the DOCX preview's `v-html` content in a
  container that mirrors the PDF branch's `h-[65vh] min-h-[24rem]` sizing and
  `rounded-md border border-border` styling, plus a box-shadow using this app's existing
  shadow token (`shadow-card-md`, already exposed via `@theme` and used elsewhere — no new
  token or custom CSS). Since HTML content (unlike an iframe) doesn't scroll itself, the
  container needs its own `overflow-y-auto` so long resumes don't blow out the fixed height.
- Tests: `frontend/tests/JobCvsModal.test.ts` — the DOCX preview's rendered-HTML wrapper
  carries the matching height/width/shadow classes.

Out of scope:
- Any change to the PDF preview branch, which already has this container shape — it's the
  reference, not the target.
- Any change to the HTML *content* itself (the sanitize-html allow-list, the mammoth
  conversion) — this is a container/layout change only.
- The "compact" preview inside `CvsListPage.vue` or elsewhere — this app only has one DOCX
  content preview surface, `JobCvsModal.vue`'s popup.

## Assumptions
- Frontend-only — pure Tailwind class changes on an existing element, no backend involved.
- "A container similar to the pdf viewer container in height and width" means literally reusing
  the same `h-[65vh] min-h-[24rem]` sizing, not inventing new dimensions — keeps the two preview
  types visually consistent when a user toggles between CVs of different file types.

## Open Questions
None — small, unambiguous, reuses an existing sizing pattern and an existing design token.

## Steps
1. **`JobCvsModal.vue`**: change the DOCX preview's success-state markup from
   ```html
   <div v-else class="max-w-none text-sm text-fg [&_h1]:mb-2 ..." v-html="previewHtml" />
   ```
   to a sized, bordered, shadowed, internally-scrolling wrapper around the same content:
   ```html
   <div v-else class="h-[65vh] min-h-[24rem] overflow-y-auto rounded-md border border-border p-4 shadow-card-md">
     <div class="max-w-none text-sm text-fg [&_h1]:mb-2 ..." v-html="previewHtml" />
   </div>
   ```
   (keep the existing `[&_h1]:...` etc. utility list unchanged on the inner div — only the
   wrapper is new).
2. **Tests**: assert the wrapper carries `h-[65vh]`, `min-h-[24rem]`, `border`, and
   `shadow-card-md` for a mounted DOCX preview.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: open a DOCX CV's preview and a PDF CV's preview back to
  back — both boxes should occupy the same footprint and show a visible shadow.

## Risks
- None of note — additive Tailwind classes on an existing element.

## Rollout Order
Single frontend ticket.

## Rollback
Revert the commit touching `frontend/src/components/JobCvsModal.vue` and its test file.
