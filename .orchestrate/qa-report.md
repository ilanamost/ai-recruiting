=== QA REPORT ===
Ticket: AI-115 (QA) for AI-114 (frontend) — .plan/037-2026-11-07-mobile-text-wrapping.md
Branch: feat/mobile-text-wrapping (uncommitted working tree)
Scope: frontend-only (no stack:full; backend/ exists but was not touched by this task)
Overall: PASS on every check that can be automated. The on-device and 390px device-mode Validation items
are still OPEN: they were not checked in a browser or on a device (see below).

Static:      tsc PASS (`npx vue-tsc --noEmit`, exit 0, incl. new QA test file) · lint N/A (no lint script in frontend/package.json — not a failure)
Unit:        867 passed, 0 failed (53 files, `npx vitest run`; 860 pre-existing/implementer + 7 new QA)
E2E:         not applicable (no Playwright config or test:e2e script in frontend/)
Backend:     not applicable, frontend-only task
Build:       PASS — `npx vite build --mode production --outDir <scratchpad>/dist`, exit 0; scratch output deleted afterwards

## Built CSS check (dist/assets/index-*.css, parsed with a brace-depth walker)
- `.list-badge{…white-space:nowrap;flex-shrink:0;…max-width:100%…}` — top level, outside any media query, unlayered. PASS
- `.list-badge-text{white-space:normal;overflow-wrap:anywhere;flex-shrink:1;min-width:0}` — only inside
  `@media (width<=767px)`; no other `.list-badge-text` rule exists. PASS
- Source order: `.list-badge` at byte 45206, `.list-badge-text` at byte 45512. The two selectors have equal
  specificity, so the mobile override wins only because it comes later — and it does. PASS
- `.btn`, `.navbar-link`, `.navbar-menu-item`, `.avatar-picker-placeholder` all carry `white-space:nowrap` at top level. PASS

## Validation section
- vitest + vue-tsc pass — PASS — see above
- Built CSS: `.list-badge` nowrap outside media; `.list-badge-text` mobile wrap rule — PASS — see above
- 390px device mode: "N CVs" one row for 0/1/25; 60-char file name + long location wrap, no horizontal scroll —
  NOT VERIFIED IN A BROWSER. Evidence is class-level and CSS-level only:
  `mobile-text-wrapping.qa.test.ts > keeps the count badge a plain nowrap badge for 0, 1 and 25 CVs` (PASS:
  "0 CVs", "1 CV", "25 CVs", none carry list-badge-text) and `> lets an unbroken 200-char title give way` (PASS).
  jsdom has no layout engine, so actual row count and scroll width are unproven.
- Audit list in frontend-agent-report.md — PASS — 22-row table present, and it says plainly that it was not browser-checked
- iPhone 13 private-tab check — NOT VERIFIED (needs the device; left for the user)

## Diff review — badges
| Badge | File:line | list-badge-text? | Expected | Result |
|---|---|---|---|---|
| Jobs card "N CVs" | pages/JobsListPage.vue:445 | no | no | PASS |
| Jobs card location | pages/JobsListPage.vue:451 | yes | yes | PASS |
| Job preview location | pages/JobsListPage.vue:526 | yes | yes | PASS |
| Job preview "N CVs" | pages/JobsListPage.vue:540 | no | no | PASS |
| CVs card file name | pages/CvsListPage.vue:334 | yes | yes | PASS |
| CVs card job titles | pages/CvsListPage.vue:341 | yes | yes | PASS |
| Manage CVs file name | components/JobCvsModal.vue:596 | yes | yes | PASS |
A grep for `list-badge` across frontend/src/**/*.vue finds exactly these 7 uses, so none were missed.

## Regression review: the new `white-space: nowrap` (reasoned from CSS and templates, NOT checked in a browser)
Budget at 390px: the main column is 390 − 2×24 (--page-pad) = 342px. A `.card` (1.5rem padding) leaves 294px.
The Manage CVs dialog leaves 390 − 32 (p-4) − 48 = 310px, and its filter strip (p-3) leaves 286px.
Widths below are estimates from font size and padding.
- `.btn` (base.scss:159): every multi-button row is `flex flex-wrap` (Jobs card actions, edit/confirm rows,
  CVs rows, modal Download/Detach + confirm rows, Home CTAs, modal attach row). The rows that do not wrap are
  `h1 "CVs"` + "Cancel upload" (~200px, CvsListPage.vue:238) and the dialog headers with an icon-only Close
  button, whose title columns are `min-w-0`. The widest single button label is "Confirm delete", about 130px.
  No .btn renders user text. No overflow expected.
- Navbar (`.navbar-link`, `.navbar-menu-item`): below 768px the links are in the absolute full-width hamburger
  panel and the wordmark is hidden. At 768px the row is roughly brand 124 + links 250 + actions 120 + gaps 32
  + padding 48 ≈ 575px, under 768. The settings menu has min-width 10rem, which fits "User settings". No overflow expected.
- FilterTabs (All + EXPERIENCE_LEVELS): about 252px against 286px in the Manage CVs strip. Single-word labels
  could not wrap before either, so `whitespace-nowrap` changes nothing for them. Note: the parent passes
  `class="shrink-0"` (JobCvsModal.vue:501), so the new `flex-wrap` on the tablist only kicks in if the strip
  itself is narrower than the tabs. Low risk at 390px. On a ~320px screen (strip ≈ 216px) the tabs would
  overflow the strip rather than wrap. That is not a regression (it was the same before), but it is worth knowing.
- Pager: Prev ~90 + "Page 100 of 100" ~105 + Next ~90 + gaps 24 ≈ 309 against 318px, plus a `flex-wrap`
  fallback. No overflow expected.
- MatchResult score "82/100" and avatar "Add photo" (10px text, ~45px inside a 56px content box): fit.
- Jobs card title row: the count badge is now `flex-shrink:0`. The title column got `min-w-0
  [overflow-wrap:anywhere]` (JobsListPage.vue:433), so a long unbroken title wraps instead of pushing the badge
  out. Asserted at class level by the QA test.
- Desktop (≥768px): `.list-badge-text` is nowrap there. A 60-char file name (~390px at 12px semibold) fits the
  672px max-w-2xl column. This matches pre-.plan/036 desktop behavior, so it is not a regression.
- The rules are unlayered, so they beat any Tailwind utility (e.g. a future `whitespace-normal` on a `.btn`
  would be ignored). This is an existing project convention, noted in navbar.scss:147, not a defect.

## Adversarial tests added — frontend/tests/mobile-text-wrapping.qa.test.ts (7 tests, all PASS)
- keeps the count badge a plain nowrap badge for 0, 1 and 25 CVs (singular/plural) — PASS
- lets an unbroken 200-char title give way (min-w-0 column) instead of squeezing the count badge — PASS
- keeps the badge split stable across rapid preview open/close cycles (5 rounds) — PASS
- renders no location badge for an empty-string location — PASS
- places the mobile .list-badge-text rule after the base .list-badge rule (cascade order) — PASS
- has no media query of any width that lets a plain .list-badge wrap or shrink — PASS
- never lets .list-badge-text wrap outside the mobile breakpoint — PASS

## Acceptance criteria (relevant to this task)
- Short count badge stays on one row on mobile — PASS at CSS/class level (built CSS + tests above). Browser and device not verified.
- Long user text (file name, job title, location) still wraps on mobile instead of overflowing — PASS at
  CSS/class level (`mobile-text-wrapping.test.ts > lets .list-badge-text shrink and wrap anywhere below 768px`,
  component class tests). Browser not verified.
- No new horizontal overflow at 390px from the nowrap audit — PASS by reasoning only (see regression review).
  Not browser-verified.

## Findings (non-blocking)
- frontend/src/components/JobCvsModal.vue:501 — `class="shrink-0"` on FilterTabs means the new tablist
  `flex-wrap` (FilterTabs.vue:72) can only help if the strip is narrower than the tabs. On a ~320px device the
  tabs would overflow the strip instead of wrapping. Expected: tabs wrap. Actual (by reasoning): overflow below
  about 350px. This is outside the 390px target and not a regression. A possible fix is `min-w-0` or dropping
  `shrink-0` on that FilterTabs. Low priority.
- frontend/dist/ exists in the repo, dated 2026-11-07 19:11, which is before this QA run. It is gitignored
  (.gitignore:16) and was not created by QA. The frontend report says its build went to a scratch dir, so this
  is likely from an earlier run. Delete it if unwanted.
- Unrelated working-tree change: .gitignore has its agent-tooling ignores commented out (this is why .claude/,
  .doc/, AGENTS.md etc. show as untracked). This is not part of .plan/037. Review it before committing.

STATUS: DONE
