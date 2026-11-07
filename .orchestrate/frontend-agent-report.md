=== FRONTEND AGENT REPORT ===
Ticket: AI-114 (.plan/037-2026-11-07-mobile-text-wrapping.md)
Branch: feat/mobile-text-wrapping (not committed)

Files changed:
- frontend/src/styles/cmps/list.scss — .list-badge is `white-space: nowrap; flex-shrink: 0` at every size; the
  blanket max-width:767px `.list-badge` override from .plan/036 is removed; new `.list-badge-text` rule under
  `@media (max-width: 767px)`: `flex-shrink: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere`
- frontend/src/pages/JobsListPage.vue — `list-badge-text` on the location badge (card + preview dialog); CV count
  badges (card + preview) left as plain `.list-badge`; title/description column gets `min-w-0 [overflow-wrap:anywhere]`;
  edit Save/Cancel row and delete-confirm row get `flex-wrap`
- frontend/src/pages/CvsListPage.vue — `list-badge-text` on the file name badge and the job title badges; edit
  Save/Cancel row and delete-confirm row get `flex-wrap`
- frontend/src/components/JobCvsModal.vue — `list-badge-text` on the file name badge; detach-confirm row and
  Download/Detach row get `flex-wrap`
- frontend/src/styles/basics/base.scss — `.btn` gets `white-space: nowrap`
- frontend/src/styles/cmps/navbar.scss — `.navbar-link` and `.navbar-menu-item` get `white-space: nowrap`
- frontend/src/styles/cmps/avatar.scss — `.avatar-picker-placeholder` ("Add photo") gets `white-space: nowrap`
- frontend/src/components/FilterTabs.vue — tablist gets `flex-wrap`, tabs get `whitespace-nowrap`
- frontend/src/components/Pager.vue — nav gets `flex-wrap`, "Page N of M" gets `whitespace-nowrap`
- frontend/src/components/MatchResult.vue — score ("82/100") gets `whitespace-nowrap`
- frontend/tests/mobile-text-wrapping.test.ts (new) — style contract on the compiled SCSS
- frontend/tests/mobile-safe-area.test.ts — the .plan/036 assertion now targets `.list-badge-text` (it asserted the old
  blanket rule)
- frontend/tests/JobsListPage.test.ts, CvsListPage.test.ts, JobCvsModal.test.ts — badge class tests

Unit tests: 860 passed, 0 failed (52 files, `npx vitest run`)
Typecheck: `npx vue-tsc --noEmit` clean
E2E tests: none; this app has no Playwright setup
Built CSS check (`vite build` into a scratch dir): `.list-badge{…white-space:nowrap;flex-shrink:0…}` sits outside any
media query; `.list-badge-text{white-space:normal;overflow-wrap:anywhere;flex-shrink:1;min-width:0}` sits only inside
`@media (width<=767px)`.
API contract: no change (styling only)

## Audit (390px, reasoned from code/CSS)

| Component | Result | Change |
|---|---|---|
| Jobs card: "N CVs" badge | Bug confirmed in code: the badge was allowed to shrink and to wrap on mobile, so "3 CVs" broke onto two rows | nowrap + flex-shrink:0 (base `.list-badge`); the title column now takes the squeeze (`min-w-0`, overflow-wrap) |
| Jobs card: location badge | Long user text, must wrap | `list-badge-text` |
| Job preview: count badge / location badge / "Created …" | Footer row already `flex-wrap`; badge now nowrap | location → `list-badge-text`; count unchanged |
| Jobs card buttons (Edit/Duplicate/Manage CVs/Delete) | Row already `flex-wrap`; labels could split inside a button | `.btn` nowrap |
| Jobs edit Save/Cancel, delete Confirm/Cancel rows | `flex` with no wrap | `flex-wrap` |
| Jobs filter strip (Location, Job creation date, Applied, Rows per page) | Already `flex-wrap`, labels short | none |
| CVs card: file name badge, job title badges | Long user text | `list-badge-text` |
| CVs header (h1 + Upload CV / Cancel upload) | Fits at 390px | none (button nowrap via `.btn`) |
| CVs edit / delete-confirm rows | `flex` with no wrap | `flex-wrap` |
| "Created …" / "Uploaded …" / "Attached …" lines | Full-width `<p>`, short text | none |
| Manage CVs dialog: file name badge | Long user text | `list-badge-text` |
| Manage CVs dialog: Download/Detach, Confirm detach/Cancel rows | `flex` with no wrap | `flex-wrap` |
| Manage CVs dialog: attach row, filter strip, skill chips, Clear filters | Already `flex-wrap`; Clear filters already `shrink-0` | none (button nowrap via `.btn`) |
| FilterTabs (All/Junior/Mid/Senior) | Fits (about 250px of about 286px available) but had no protection | tabs `whitespace-nowrap`, tablist `flex-wrap` |
| Pager (Prev · Page N of M · Next) | Fits (about 290px of about 318px) but the label could wrap on a narrower screen | label `whitespace-nowrap`, nav `flex-wrap` |
| MatchResult score line | Single token, low risk | `whitespace-nowrap` (defensive) |
| Navbar mobile menu (New job/Jobs/CVs) | Full-width column panel, fine at 390px | `.navbar-link` nowrap (also protects the tight 768–900px desktop row) |
| Navbar settings menu (User settings/Logout) | min-width 10rem, OK | `.navbar-menu-item` nowrap (defensive) |
| Home page: accordion headers, steps, features, action buttons | Headers use `justify-between` with a `shrink-0` chevron; action row already `flex-wrap` | none (button nowrap via `.btn`) |
| Login / Sign up | Single column card (max-w-sm); "Sign up"/"Log in" inline links fit on one line | none |
| Settings: "Add photo" placeholder in the 4rem avatar | Could wrap inside the circle | `.avatar-picker-placeholder` nowrap |
| Settings: fields, "Admin (set via database)", Save changes | Column layout, fits | none |
| Job form (New job) | Column layout | none |

## What was verified and what was not
- Verified: unit tests, typecheck, and the compiled CSS output (both the Sass compile in tests and a real `vite build`).
- **Not checked in a browser or on a device.** No headless browser (Playwright/Puppeteer) is installed in `frontend/`,
  and the list pages need the backend and a logged-in user. The audit above is reasoned from the templates and CSS,
  and the pixel widths are estimates. Plan Validation items still open for QA/the user: 390px device mode for 0/1/25 CVs,
  a 60-character file name and a long location with no horizontal scroll, and the iPhone 13 check after a private-tab load
  (Safari may cache the old CSS).

Handoff:
- No backend work.
- QA: check at 390px that the Jobs "N CVs" badge stays on one row and that a long job title with no spaces wraps in the
  title column instead of pushing the badge off the card. Also check that long file names and locations still wrap.

STATUS: DONE
