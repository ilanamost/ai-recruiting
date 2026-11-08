# Frontend Agent Report: logged-out navbar (plan 040)

Branch: `feat/logged-out-navbar` (nothing committed). Status: DONE. Date: 2026-11-08.

Results: orchestrator re-run `npx vitest run` = 896 passed (54 files); `npx vue-tsc --noEmit` clean; no lint script. QA must re-verify.

## Changes
- `frontend/src/components/NavBar.vue`
  - `isSignedIn` computed from `user`.
  - Signed out: the brand is a plain `<div class="navbar-brand is-static">` (same icon and wordmark; no link, href or tabindex). Hamburger, mobile overlay, links container and the gear block (dropdown and overlay) are not rendered. Theme toggle and avatar placeholder stay.
  - Not in the plan: a watcher closes both menus on logout, so a menu open at logout does not come back open after the next login.
- `frontend/src/styles/cmps/navbar.scss`: `.navbar-brand.is-static` (`cursor: default`, hover colour stays `var(--fg)`, specificity beats the brand's `:hover`); `margin-left: auto` on `.navbar-actions` so the actions stay right-aligned when the links container is absent. Layout checked by reading the CSS only (desktop: two flex children with `space-between`; phone under 768px: wordmark hidden, brand icon + theme toggle + avatar).
- `frontend/tests/NavBar.test.ts`: new "signed out (.plan/040)" block (9 tests): no `a[href]` and only the theme toggle as a button; static, non-focusable brand with `is-static`; no links, hamburger, gear, menu items or overlays; avatar placeholder present and theme toggle works; setting a user shows links/brand link/gear without a remount; logout hides them and menus do not reopen after the next login; real `logout()` + navigation to `/login` ends in the signed-out navbar; SCSS rules for the static brand and right-aligned actions asserted on the source.
- `frontend/tests/mobile-nav.adversarial.test.ts`: one existing test changed, "renders and toggles without a user" relied on the hamburger showing with no user. Renamed to "renders without a hamburger or menu when there is no user"; asserts hamburger, links container and overlay are absent and rendering does not throw.

## Orchestrator fix (not part of the plan)
- `frontend/tests/ui-polish.adversarial.test.ts`: its `concatStylesheet` helper only followed `@import './x.scss';`. After the earlier Sass `@import` -> `@use` change (commit 54cecbd) it read an empty stylesheet, so 10 tests failed on master before this task. The helper now follows `@use` as well as `@import` and resolves Sass partials (`./card` -> `card.scss`, `./setup` -> `setup/index.scss`).

## Not verified
- Layout, cursor and phone-width behavior in a real browser (jsdom cannot show them).
