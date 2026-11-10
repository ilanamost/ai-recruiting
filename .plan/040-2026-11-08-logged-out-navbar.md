Status: done
Owner: Ilana
Last updated: 2026-11-08

## Goal
When nobody is signed in, the navbar must not show anything the visitor cannot use: no route
links, no inactive buttons, and no settings/logout gear. "AI Recruiting" stays visible but is not
clickable. The avatar placeholder and the light/dark switch stay. Backlog task: "When the user is
logged out, he shouldn't be able to see buttons that are inactive..."

## Scope
Frontend only (no `stack:full` marker).
- `frontend/src/components/NavBar.vue`: render by signed-in state (`user` from `useAuth()`).
  Signed out:
  - The brand is a plain, non-interactive element (not a `RouterLink`): same icon and wordmark,
    no link role, no pointer cursor, no hover colour shift.
  - The nav links container (`New job`, `Jobs`, `CVs`) is not rendered.
  - The hamburger button and the mobile menu overlay are not rendered (nothing to open).
  - The gear button, its dropdown, and its overlay are not rendered (see Open Question 1).
  - The theme toggle and the avatar placeholder stay.
  Signed in: unchanged.
- `frontend/src/styles/cmps/navbar.scss`: a modifier (e.g. `.navbar-brand.is-static`) that turns off
  the pointer cursor and hover/active colour for the non-link brand. Tokens and SCSS per the
  ui-and-styling rule; no inline styles.
- `frontend/tests/NavBar.test.ts`: new tests.
- No backend, API contract, router, or auth logic change.

Out of scope: the login page content, route guards, and the Settings page.

## Assumptions
- "Logged out" means `useAuth().user.value` is `null`. In practice this is only visible on `/login`,
  because the router guard redirects every other path there (`frontend/src/router/index.ts`).
- On first load the shell is hidden until the session check finishes (`isAppReady` in `App.vue`), so
  a signed-in user never sees the signed-out navbar flash first; no change needed there.
- After login or logout the navbar must update immediately. `user` is already reactive, so this
  needs no extra wiring.
- The existing signed-in behavior and tests (role-based links, mobile menu, logout) must not change.

## Open Questions
1. **Gear icon: remove it or keep it unclickable?** (you allowed either)
   - **Option A (recommended): remove it when signed out.** Simplest, and nothing inert is left in
     the bar, which matches "shouldn't see inactive buttons".
   - Option B: keep it visible but `disabled`. This is exactly the kind of inactive button the task
     wants hidden.
2. **Avatar placeholder:** keep it (the task says it can remain)?
   - **Recommended: keep** the generic user-icon circle, so the bar's layout does not jump after login.
   - Alternative: remove it too.
3. **Hamburger on phones when signed out?**
   - **Recommended: hide it.** With no links or menu items it would open an empty panel.
   - Alternative: keep it. It would open an empty menu, which is a dead button.

**Answers (2026-11-08):** Q1 -> remove the gear when signed out. Q2 -> keep the avatar placeholder.
Q3 -> hide the hamburger.

## Steps
1. Branch `feat/logged-out-navbar` (created from `master`).
2. `NavBar.vue`: add `isSignedIn` (`computed(() => !!user.value)`); switch the brand between
   `RouterLink` and a static element; `v-if="isSignedIn"` on the hamburger, mobile overlay, links
   container and gear block (per the answers above).
3. `navbar.scss`: the static-brand modifier; make sure the layout (brand left, actions right) holds
   when the links container is absent, at desktop and 390 px widths.
4. Tests in `frontend/tests/NavBar.test.ts`, per the `writing-tests` skill.
5. Run `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` (there is no lint script).

## Validation
QA checklist, each item provable by a test or command:
- Signed out: no `a[href]` and no `button` other than the theme toggle exists inside the navbar.
- Signed out: the text "AI Recruiting" and its icon are present, but not inside an `<a>`; the brand
  element has no `href`, is not focusable via keyboard, and carries the static modifier class.
- Signed out: no `New job`, `Jobs` or `CVs` text; no hamburger button; no settings gear; the
  "User settings" and "Logout" items are absent.
- Signed out: the theme toggle is present and toggles the theme; the avatar placeholder (user icon)
  is present.
- Signed in (admin, recruiter, candidate): the brand is a link to `/`; role-based links, hamburger,
  gear, "User settings" and "Logout" behave as before. All existing `NavBar.test.ts` tests pass
  unchanged.
- Reactivity: mounting signed out, then setting a user, shows links, brand link and gear without a
  remount; logging out hides them again (and a real `logout()` + `/login` navigation ends in the
  signed-out navbar).
- At phone width (the mobile CSS), signed out shows brand + theme toggle + avatar and no hamburger.
- The static brand has no pointer cursor and no hover colour change (asserted via the class and the
  SCSS rule in the compiled stylesheet).
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` pass.
- Manual (real browser): `/login` shows the minimal navbar on desktop and on a phone-width window.
  jsdom cannot verify layout or cursor, so QA will list this as unverified unless run.

## Risks
- Navbar layout shifts when the links container disappears (`justify-content: space-between` pushes
  the actions left if the brand is the only left item). Mitigation: check the SCSS at both widths and
  keep the actions right-aligned (`margin-left: auto` if needed).
- Existing tests may assume the gear or links always render with no user mocked. Mitigation: update
  only tests that relied on the signed-out state, and say so in the QA report.
- The non-link brand loses its link semantics for assistive tech. That is intended (it is not
  clickable), but the markup should still expose the product name as text.

## Rollout Order
1. `NavBar.vue` and `navbar.scss`.
2. Tests.
3. QA validation, then human approval of the QA ticket.

## Rollback
Revert the branch. Frontend-only, no data or schema change.
