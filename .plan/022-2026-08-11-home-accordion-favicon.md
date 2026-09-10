Status: done
Owner: Ilana
Last updated: 2026-08-11

## Goal
Two independent, small frontend changes bundled from one backlog line: `HomePage.vue`'s three
section titles ("What it does," "How it works," "Key features") become independently
collapsible accordions, and the application gets a favicon (currently none).

## Scope
In scope:
- `frontend/src/pages/HomePage.vue`: each of the three `<section class="card ...">` blocks gets
  a clickable header (title + chevron icon) toggling that section's own content open/closed —
  see Open Question 1 for whether sections are independent or mutually exclusive, and Open
  Question 2 for the default (open/closed) state.
- A new favicon asset plus the `<link rel="icon">` tag in `frontend/index.html` — see Open
  Question 3 for the asset itself (no image-generation tool is available; this has to be a
  hand-authored SVG, not a rendered PNG).
- Tests: `frontend/tests/HomePage.test.ts` — each section's content is visible by default (or
  hidden, per Open Question 2's answer), clicking a header toggles that section's content and
  its `aria-expanded` state, and toggling one section doesn't affect the other two's state.

Out of scope:
- Any change to the sections' actual content (copy, icons, the role-aware action row below
  them) — this task only adds show/hide behavior to titles that already exist.
- Any other page — the backlog names the home page specifically.
- A "favicon package" (multiple sizes, `apple-touch-icon`, manifest icons, etc.) — a single SVG
  favicon referenced once in `index.html` is what's asked for; a full multi-format icon set
  is a larger, unrequested task.

## Assumptions
- Frontend-only, no backend involved.
- No image-generation or design tool is available in this environment — the favicon must be a
  hand-authored inline SVG shape (not a rasterized brand mark), kept simple enough to read at
  16-32px, the sizes a browser tab actually renders a favicon at.

## Open Questions
1. **Independent per-section toggles, or strict single-open accordion (opening one closes the
   others)?** "Accordion" sometimes implies the latter, but there are only three short sections
   on a page meant to be skimmed, not a long list where showing one at a time reduces clutter.
   **Recommended:** independent toggles — a visitor comparing "Key features" against "How it
   works" shouldn't have to reopen one after checking the other.
2. **Default state: open or collapsed on first load?** Decided: all three start **closed** —
   the page loads as three collapsed headers, and a visitor opens whichever section they want to
   read.
3. **What does the favicon actually look like?** This app's only existing brand mark is the
   `Sparkles` icon (from `@lucide/vue`) used in `NavBar.vue`. **Recommended:** a simple SVG — a
   rounded-square background in this app's `--primary` brand color (the light-theme value,
   since a static favicon can't respond to the viewer's app theme the way in-app CSS variables
   do) with a white four-point sparkle/star shape centered on it, echoing the existing brand
   icon without needing pixel-exact reproduction of the lucide asset.

Proceeding with the recommended answers on Open Questions 1 and 3; Open Question 2 is decided
above (closed by default), overriding the plan's original recommendation.

## Steps
1. **`HomePage.vue`**: add three boolean refs (e.g. `whatItDoesOpen`, `howItWorksOpen`,
   `keyFeaturesOpen`), each starting `false` per Open Question 2. Wrap each section's `<h1>`/`<h2>`
   in a `<button type="button">` (full-width, `justify-between`, left-aligned text) that also
   renders a `ChevronDown` icon (`@lucide/vue`) rotated 180° when that section's ref is `true`
   (`class="transition-transform"` plus a conditional `rotate-180`), toggling the ref on click,
   with `:aria-expanded="<ref>"` on the button. The existing content below each header (the
   three `<p>`s, the `<ol>`, the `<ul>`) becomes `v-if="<ref>"` (implementer's call whether three
   near-identical accordion header blocks are worth a small local sub-component vs. inlined
   three times — either is fine, don't over-engineer a fourth option).
2. **Favicon**: create `frontend/public/favicon.svg` (new `public/` directory — Vite serves its
   contents at the site root unprocessed) with the SVG described in Open Question 3's answer.
   Add `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` to `frontend/index.html`'s
   `<head>`.
3. **Tests**: per Scope's Tests bullet above.

## Validation
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: load the home page, confirm all three sections are
  collapsed by default; click each header and confirm its content expands and the chevron
  rotates, click again to collapse; confirm opening one section leaves the other two untouched;
  confirm the browser tab shows the new favicon instead of the default blank/globe icon.

## Risks
- SVG favicons are broadly supported in current browsers but not universally (older
  Safari/legacy browsers fall back to no icon rather than erroring) — acceptable given this
  app targets current browsers already (Tailwind v4, CSS nesting used throughout).
- None of note for the accordion — additive interactivity on existing, already-tested content.

## Rollout Order
Single frontend ticket — no backend involved, the two changes are independent of each other and
can land in any order within the same PR.

## Rollback
Revert the commit touching `frontend/src/pages/HomePage.vue`, `frontend/index.html`, the new
`frontend/public/favicon.svg`, and the test file.
