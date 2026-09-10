Status: done
Owner: Ilana
Last updated: 2026-08-11

## Goal
Replacing (or removing) a profile image in User Settings updates every place that image
appears — the NavBar avatar, in particular — immediately, without requiring a page refresh.

## Scope
In scope:
- `frontend/src/lib/auth.ts`: `profileImageUrl` is a computed built from
  `user.value?.has_profile_image` (a boolean) alone, so its output string is identical before
  and after *replacing* an already-set image — `has_profile_image` stays `true` both times.
  Nothing about that computed's output ever changes, so Vue never touches the `<img src>`
  binding again after the first load, and the browser has no reason to re-request the image —
  this is the root cause, not a caching quirk that a refresh "fixes" by luck. Add a
  session-local `profileImageVersion` counter, bumped every time `updateProfile` resolves
  successfully, and append it as a cache-busting query parameter to the URL.
- `frontend/src/pages/SettingsPage.vue`: `onSubmit`'s success branch never clears
  `profileImageFile`/`previewUrl` after a successful save — see Assumptions for why this is a
  real second bug, not just tidiness, and needs fixing alongside the root cause.
- Tests: `frontend/tests/stores/../lib` auth tests (or wherever `lib/auth.ts`'s existing tests
  live) — replacing an image while `has_profile_image` stays `true` produces a different
  `profileImageUrl` string than before the replacement. `frontend/tests/SettingsPage.test.ts` —
  after a successful image-inclusive submit, a subsequent click on "Remove profile image"
  actually calls `updateProfile({ remove_profile_image: true })` rather than only discarding a
  local selection that no longer exists.

Out of scope:
- Any backend change — `has_profile_image`/the image bytes themselves are already correct and
  already served correctly on request; this is purely a frontend cache/reactivity gap.
- `NavBar.vue`/`SettingsPage.vue`'s own `<img>` template bindings — both already read the
  reactive `profileImageUrl` (or `previewUrl ?? profileImageUrl`) correctly; once the computed
  itself changes on update, both consumers update automatically with no template change needed.

## Assumptions
- Frontend-only, no `stack:full` override needed.
- **The `SettingsPage.vue` half is a real bug, not cleanup.** `removeImage()` checks
  `profileImageFile.value` first and, if set, treats a click as "discard the local unsaved
  selection" rather than calling the server. Since a successful submit never clears
  `profileImageFile`, clicking "Remove profile image" immediately after a successful upload (in
  the same mounted instance, no navigation away) silently does the wrong thing — it looks like
  it removed the image (the stale local blob preview disappears) but never told the server, so
  the image is still there. This needs the same fix as the live-update issue to be genuinely
  resolved, not just visually patched.

## Open Questions
None — this is a diagnosed bug with one clear, targeted fix; there's no design decision to
make.

## Steps
1. **`frontend/src/lib/auth.ts`**: add `const profileImageVersion = ref(0)`. In `updateProfile`,
   right after `user.value = await response.json()` on success, `profileImageVersion.value += 1`.
   Change `profileImageUrl`'s computed to
   `` user.value?.has_profile_image ? `${API_URL}/api/auth/me/profile-image?v=${profileImageVersion.value}` : null ``.
2. **`frontend/src/pages/SettingsPage.vue`**: in `onSubmit`'s success branch (alongside the
   existing `currentPassword.value = ''` etc.), add the same revoke-and-clear sequence
   `onImageChange`/`onBeforeUnmount` already use: if `previewUrl.value`,
   `URL.revokeObjectURL(previewUrl.value)` then set it to `null`; set `profileImageFile.value =
   null`. After this, `hasImage`/the `<img>` binding correctly falls back to the (now
   cache-busted) `profileImageUrl` instead of continuing to show the local blob indefinitely.
3. **Tests**: per Scope's Tests bullet above.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: as any role, go to User Settings with an existing profile
  image, upload a different image, save — without refreshing, confirm the NavBar avatar updates
  to the new image immediately. Then click "Remove profile image" (same page, no navigation) and
  confirm it actually removes it (NavBar avatar reverts to the default icon), not just the local
  preview.

## Risks
- None of note — a targeted, low-risk fix confined to one composable and one page component.

## Rollout Order
Single frontend ticket — no backend involved.

## Rollback
Revert the commit touching `frontend/src/lib/auth.ts` and `frontend/src/pages/SettingsPage.vue`,
plus their test files.
