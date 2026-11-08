Status: done
Owner: Ilana
Last updated: 2026-11-08

## Goal
The password field on the Login and Signup pages must be empty until the user types in it. It
must not be pre-filled on first load, after a refresh, or after logging out. Backlog task: "When
the application loads, on the login and Signup pages, a password appeares in the password field."

## Scope
Frontend only (no `stack:full` marker).
- `frontend/src/pages/LoginPage.vue`: the only file with a code change.
  - Add `autocomplete` attributes so the browser's password manager does not fill the field.
  - Reset `password` (and `showPassword`) on mount, on a Login/Signup mode switch, and when the
    page is restored from the browser's back/forward cache (`pageshow` with `persisted`).
- `frontend/tests/LoginPage.test.ts`: new tests.
- No backend, API contract, or styling change.

**Logout is explicitly covered.** `NavBar.onLogout` runs `logout()` and then `router.push('/login')`,
an in-app navigation. There is no `keep-alive`, so `LoginPage` is created fresh, and the app never
stores the password anywhere (it lives only in the form field). So after logout the only way a
password can appear is browser autofill on that new mount. It is stopped by the same two measures as
a fresh load (`autocomplete="new-password"` and the reset on mount), and a dedicated test proves the
logout-then-login-page path (see Validation).

Out of scope: the Settings page password fields (not part of this task), removing the show/hide
password toggle.

## Assumptions
- Root cause (from code, not yet reproduced in a browser): the login and signup inputs have no
  `autocomplete` attribute and no `name`, so Chrome/Safari/Edge fill a saved password into them on
  load and when the page is restored after refresh or logout. The Vue state (`ref('')`) is already
  empty, so this is browser autofill writing into the DOM, not app state.
- Browsers cannot be forced to never autofill. `autocomplete="new-password"` is the standard
  signal and is honored by current Chrome, Edge, Safari and Firefox for saved-password autofill.
- Existing login and signup behavior (validation, submit, redirect) must not change.

## Open Questions
1. **How should autofill be blocked?**
   - **Option A (recommended): `autocomplete="new-password"` on the password input in both modes.**
     Simple, widely honored. Trade-off: the browser will no longer offer the saved password on the
     login form, which is what the task asks for.
   - Option B: `autocomplete="off"`. Chrome ignores it on password fields, so it is unreliable.
   - Option C: keep `current-password` on login and only block signup. This does not fix the
     reported login-page behavior.
2. **Should the email field also be left empty?**
   - **Recommended: leave email as is** (no change). The task is about the password. Some browsers
     may still offer a saved email, which is harmless.
   - Alternative: also set `autocomplete="off"` on email so neither field is pre-filled.
3. **Also clear the fields in code (mount, mode switch, back/forward restore)?**
   - **Recommended: yes.** This is a safety net: it covers browsers that restore form values on
     refresh or from the back/forward cache regardless of `autocomplete`.
   - Alternative: attribute only. Smaller, but weaker on bfcache restores after logout.

**Answers (2026-11-08):** Q1 -> `autocomplete="new-password"`. Q2 -> leave email as is. Q3 -> yes,
clear in code. Also requested: the password must be cleared after logout (covered, see Scope).

## Steps
1. Branch `feat/login-password-field-empty` (created from `origin/master`).
2. `LoginPage.vue`: add `autocomplete="new-password"` to the password input; apply the Q2 answer to
   the email input.
3. `LoginPage.vue`: add `resetCredentials()` that clears `password` and `showPassword`. Call it on
   mount, in `switchMode`, and from a `pageshow` listener when `event.persisted` is true (removed
   on unmount).
4. Tests in `frontend/tests/LoginPage.test.ts`, per the `writing-tests` skill.
5. Run `cd frontend && npx vitest run` and `npx vue-tsc --noEmit`. Backend suites are not affected.

## Validation
QA checklist, each item provable by a test or command:
- The password input has `autocomplete="new-password"` in both Login and Signup modes.
- The password input value is empty when the page mounts, in both modes.
- If the DOM password value is non-empty at mount (simulated autofill), it is cleared after mount.
- Switching Login to Signup (and back) clears a typed password and resets the show/hide toggle to
  hidden.
- A `pageshow` event with `persisted: true` clears the password; with `persisted: false` it does
  not touch what the user typed.
- The `pageshow` listener is removed when the component unmounts.
- Logout path: with a signed-in user, `NavBar` logout calls `logout()` and navigates to `/login`; the
  mounted `LoginPage` then has an empty password field, even when the DOM value was pre-filled by
  simulated autofill before the reset ran.
- Logging in, logging out, and logging in again never carries the previous password into the field.
- A failed login keeps the entered email and does not break the submit flow; existing
  `LoginPage.test.ts` tests pass unchanged.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` pass.
- Manual (real browser with a saved password): the field is empty on first load, after refresh, and
  after logout. This cannot be proven in jsdom and will be listed as such in the QA report.

## Risks
- Browsers may still ignore `new-password` in rare cases (some password-manager extensions).
  Mitigation: the code-level clearing on mount and `pageshow`.
- A user typing quickly right at page load could have a character cleared by the mount reset.
  Mitigation: the reset runs synchronously on mount, before the field is interactive.
- Users lose the saved-password convenience on login. This is the requested behavior.

## Rollout Order
1. `LoginPage.vue` attribute and reset logic.
2. Tests.
3. QA validation, then human approval of the QA ticket.

## Rollback
Revert the branch. Frontend-only, no data or schema change.
