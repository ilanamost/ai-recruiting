=== QA REPORT ===
Ticket: .plan/040-2026-11-08-logged-out-navbar.md (branch feat/logged-out-navbar, uncommitted)
Date: 2026-11-08
Scope: frontend-only (backend not applicable, frontend-only task)

Static:      vue-tsc --noEmit PASS (exit 0) · lint: not applicable, no lint script exists
Unit:        907 passed, 0 failed (55 files, full `npx vitest run`, run after adding my tests)
E2E:         not applicable, there is no Playwright/e2e suite in frontend/ (no e2e dir)
Backend:     not applicable, frontend-only task

Tests added by QA: frontend/tests/navbar-logged-out.adversarial.test.ts (11 tests)

Acceptance criteria (plan 040 Validation):
- Signed out: no a[href], only the theme-toggle button — PASS — NavBar.test.ts "renders no link and no button other than the theme toggle"; QA "no focusable element ... besides the theme toggle"
- Brand text + icon present, not in <a>, no href, not focusable, has is-static — PASS — NavBar.test.ts "shows the brand icon and name as a static, non-focusable element"; QA focus() test confirms activeElement is not the brand
- No New job/Jobs/CVs, hamburger, gear, User settings, Logout — PASS — "renders no nav links, hamburger, gear or settings menu items" (also checks no teleported overlays in body)
- Theme toggle works, avatar placeholder present — PASS — "keeps the avatar placeholder and a working theme toggle" (label flips on click)
- Signed-in admin/recruiter/candidate unchanged — PASS — QA it.each over 3 roles (brand is <a>, not is-static, correct link sets, hamburger, gear); the existing NavBar.test.ts tests are unchanged and pass
- Reactivity (login, logout, real logout + /login) — PASS — "shows links ... without a remount", "hides everything again on logout ...", "ends in the signed-out navbar after a real logout"; QA: logout with both menus open leaves no overlays in body; 25x login/logout flapping leaves no leaked overlay and no reopened menu
- Phone width: signed out shows no hamburger — PASS for DOM (the hamburger is not rendered at any width); the CSS side is asserted on the compiled SCSS only (see Unverified)
- Static brand: no pointer cursor, no hover shift — PASS (static evidence) — NavBar.test.ts reads the SCSS source; QA compiles with sass and checks that `.navbar-brand.is-static:hover` (0,3,0) comes after `.navbar-brand:hover` (0,2,0) and sets `color: var(--fg)`, and `cursor: default`. The static div never gets `.is-active`
- vitest + vue-tsc pass — PASS — see counts above
- Manual real-browser check — NOT RUN, see Unverified

Judgement of the two edited tests:
1. mobile-nav.adversarial.test.ts: LEGITIMATE. The old test ("renders and toggles without a user") asserted a hamburger exists with no user, which plan 040 Q3 deliberately reverses. The rewrite asserts the opposite (no hamburger, no .navbar-links, no overlay) and still covers "does not throw with null user". It is not a weakened assertion. The signed-in toggle behaviour is still covered by the rest of that file.
2. ui-polish.adversarial.test.ts: LEGITIMATE. concatStylesheet only followed `@import`, so after the SCSS `@use` change it read an empty stylesheet and its checks were failing. Following `@use` too, with Sass-style resolution (x.scss, _x.scss, x/index.scss), is a correct fix to the helper and not an assertion change. The 10 previously failing tests now pass in the full run (907/907). Minor note: it treats @use as an inline @import, which is fine for these side-effect-only partials but would be wrong for namespaced or configured @use.

Findings (none blocking):
- NavBar.vue:16 — `isSignedIn = !!user.value`. A user object with a missing role counts as signed in and, because both role checks are `!==`, shows all three links (New job, Jobs, CVs) and the gear. It is the same as the pre-existing signed-in role logic, and the plan's definition is `user === null`, so it is not a regression. Documented by QA test "a user object with no role ..." (pins current behaviour). An empty object `{}` is also signed in. `undefined` is signed out.
- NavBar.test.ts "styles the static brand..." and "keeps the actions right-aligned" use regexes on SCSS source. They are brittle to reformatting (e.g. the `\n  \}` terminator), but they are non-vacuous (they fail if the rule is removed). The QA sass-compile tests cover the compiled output as well.
- Plan Validation says "asserted via the class and the SCSS rule in the compiled stylesheet". The implementer's test reads source, not compiled output. QA's compiled-CSS test closes that gap.
- NavBar.vue:96 — a `<Teleport v-if>` wraps a `v-if` overlay. Verified no overlay leaks into body at logout.
- Stderr noise: "[Vue warn]: Failed to resolve component: RouterLink" from the pre-existing tests/qa-toast-relocation.adversarial.test.ts. Unrelated to this feature, tests pass.

Unverified (no test or command proves it):
- Real-browser layout at desktop and ~390 px width (brand left, actions right, no jump after login). jsdom applies no CSS. The `margin-left: auto` is only checked as present in the compiled CSS.
- Real pointer cursor and hover colour of the static brand, and the actual specificity cascade in a browser, including with Tailwind's layers.
- Keyboard Tab order in a real browser (jsdom focus() check only).
- Screen reader announcement of the brand as plain text.
- No lint script exists, so there was no lint run.
- No e2e/Playwright suite exists, so no e2e run.
- Backend not applicable.

Verdict: feature PASSES all automatable Validation items. The manual real-browser check from the plan has not been run and remains open for a human.

STATUS: DONE
