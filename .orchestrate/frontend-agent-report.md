# Frontend Agent Report: empty password field (plan 039)

Branch: `feat/login-password-field-empty` (nothing committed). Status: DONE. Date: 2026-11-08.

Agent-reported results: `npx vitest run` passes (53 files, 881 tests); `npx vue-tsc --noEmit` clean; no lint script. QA must re-verify.

## Changes
- `frontend/src/pages/LoginPage.vue`
  - Password input has `autocomplete="new-password"` in Login and Signup modes. Email unchanged (plan Q2).
  - `resetCredentials()` clears the `password` state, resets `showPassword`, and sets the password input's DOM value to `''` via a template ref (autofill writes to the DOM without touching Vue state).
  - Runs on mount, in `switchMode`, and on `pageshow` when `event.persisted` is true; the listener is removed on unmount.
- `frontend/tests/LoginPage.test.ts`: mocks extended (`logout`, `user`, `profileImageSrc`, `useRoute`); new `empty password field (.plan/039)` block covering attribute, empty on mount, simulated autofill cleared, mode switch, `pageshow` persisted/not persisted, listener removal, logout-then-login-page path, login/logout/login again, failed login keeps email.

## Logout
`NavBar.onLogout` runs `logout()` then `router.push('/login')`; `LoginPage` is remounted, the app never stores the password, and the same attribute plus reset on mount apply. Covered by a dedicated test.

## Not verified
- Real browser with a saved password (first load, refresh, logout): manual check, jsdom cannot prove it.
- Autofill tests simulate it by overriding the input `value` setter; this is not real autofill.
