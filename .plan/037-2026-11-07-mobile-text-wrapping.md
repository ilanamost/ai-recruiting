Status: done
Owner: Ilana
Last updated: 2026-11-07

## Goal
On an iPhone 13, short texts such as the "3 CVs" count badge in the Jobs route break across
several rows instead of staying on one row. Fix it, and check and fix the same problem
elsewhere in the app. Backlog task: "on an iphone 13 device - some of the texts appear cut,
spread out to several rows instead of remaining on a single row…".

## Scope
Frontend only (no `stack:full` marker; no `backend/` changes).

**Root cause (found in code, not yet reproduced on a device).** `.plan/036` added a blanket
rule in `frontend/src/styles/cmps/list.scss`: below 768px every `.list-badge` switches from
`white-space: nowrap` to `white-space: normal; overflow-wrap: anywhere`. That was meant for
badges holding unbounded text (a long CV file name, job title or location). It also hit the
short count badge in `JobsListPage.vue` (`3 CVs`), which sits in a flex row next to the job
title and is allowed to shrink, so it now wraps word by word. It was added by the frontend agent in plan 036 as a precaution, with no on-device repro, and was not reviewed closely enough.

**Fix.**
- `.list-badge` goes back to `white-space: nowrap` and `flex-shrink: 0` on every screen size,
  so short badges (CV counts) never wrap.
- New modifier `.list-badge-text` for badges holding user-supplied text (CV file name, job
  title, job location): below 768px it may shrink and wrap anywhere (`min-width: 0`,
  `white-space: normal`, `overflow-wrap: anywhere`). Applied in `JobsListPage.vue` (location,
  two places), `CvsListPage.vue` (file name, job title) and `JobCvsModal.vue` (file name).
- **Audit** of other places where short text can break onto several rows at 390px: buttons
  (`.btn`), `FilterTabs.vue`, `Pager.vue`, the navbar mobile menu, score and date lines,
  "Created …" / "Attached …" lines, and the Home page. For each, short fixed labels get
  `white-space: nowrap` (via the shared class or a utility), and rows that can overflow get
  `flex-wrap` so items move to a new row instead of splitting a label. Record what was
  checked and changed in `.orchestrate/frontend-agent-report.md`.

Out of scope: truncating with an ellipsis, redesigning the cards, desktop layout changes.

## Assumptions
- The reported "3 cvs" badge is `JobsListPage.vue`'s CV count badge (lines ~443 and ~538).
- iPhone 13 portrait is 390 CSS px wide; the existing 768px breakpoint stays.
- Long user-supplied text should still wrap rather than overflow (kept from `.plan/036`).

**Approved 2026-11-07:** Q1 → keep wrapping anywhere (recommended). Q2 → proceed with the audit.

## Open Questions
1. **Should long file names / titles / locations wrap or be cut with an ellipsis (`…`)?**
   - **Recommended: keep wrapping anywhere** (current behavior). Nothing is hidden, and the
     full CV file name stays readable.
   - Alternative: single-line with ellipsis; tidier but hides part of the name.
2. Is the Jobs "3 CVs" badge the only text you saw cut, or did you notice others
   (name them if so)? **Recommended: proceed with the audit above regardless.**

## Steps
1. Branch `feat/mobile-text-wrapping` (created from `master`).
2. Edit `frontend/src/styles/cmps/list.scss`: nowrap + no-shrink default, add
   `.list-badge-text` mobile rule (SCSS; no trailing semicolons in JS/TS).
3. Add `list-badge-text` to the five long-content badges listed in Scope.
4. Run the audit at 390px (browser devtools device mode) across Home, Jobs, CVs, Settings,
   Login, the Manage CVs dialog and the Job preview; fix findings with utilities or the shared
   stylesheet; list them in the report.
5. Tests: a style-contract Vitest (like `tests/mobile-safe-area.test.ts`) asserting `.list-badge`
   is `nowrap` with no mobile override and `.list-badge-text` wraps; component tests that the
   count badges don't carry `list-badge-text` and the long-text badges do.
6. `cd frontend && npx vitest run` and `npx vue-tsc --noEmit`.

## Validation
- `npx vitest run` and `npx vue-tsc --noEmit` pass.
- Built CSS: `.list-badge` has `white-space: nowrap` outside any media query (grep of
  `dist/assets/*.css`); `.list-badge-text` has the mobile wrap rule.
- At 390px in device mode: the Jobs "N CVs" badge is one row for 0, 1 and 25 CVs; a 60-character
  CV file name and a long job location still wrap inside the card with no horizontal scroll.
- Audit list in `.orchestrate/frontend-agent-report.md` shows each checked component and
  result.
- On an iPhone 13 (after a private-tab load): the CV count badge stays on one row.

## Risks
- A new `nowrap` could push a row wider than 390px — mitigated by `flex-wrap` on the parent
  rows and by keeping `overflow-x-clip` on the app shell from `.plan/036`.
- Device-only layout cannot be fully verified without the phone; Safari may cache the old CSS.

## Rollout Order
Stylesheet → templates → tests → audit fixes. Frontend deploy only.

## Rollback
Revert the branch; no data, schema or API changes.
