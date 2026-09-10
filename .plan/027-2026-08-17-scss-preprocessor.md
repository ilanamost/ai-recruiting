Status: done
Owner: Ilana
Last updated: 2026-08-17

## Goal
Introduce Sass (SCSS) as the preprocessor for this app's hand-written stylesheet tree
(`frontend/src/styles/**`) and convert every existing plain `.css` file there to `.scss`. Tailwind
utility classes remain the primary way components are styled — no `.vue` file currently has a
`<style>` block (confirmed by grep; every component styles itself with Tailwind utilities in the
template) — so this task does not touch Tailwind usage at all. It only changes the language the
*shared, hand-written* base/component CSS is authored in, per the "hybrid" direction chosen when
this plan was scoped: SCSS for hand-written CSS, Tailwind stays primary.

## Scope
In scope — add `sass` as a devDependency, then rename and convert these 12 files (all under
`frontend/src/styles/`) from `.css` to `.scss`:

| File | Lines | Notes |
|---|---|---|
| `setup/tokens.css` → `.scss` | 119 | Design tokens (`:root` custom properties + Tailwind `@theme` block). Content is CSS custom properties, not Sass variables — stays semantically identical, only the extension changes. |
| `setup/reset.css` → `.scss` | 37 | |
| `setup/index.css` → `.scss` | 2 | `@import` aggregator for the two files above — update its own `@import` targets to the new `.scss` filenames. |
| `basics/base.css` → `.scss` | 255 | |
| `basics/index.css` → `.scss` | 1 | `@import` aggregator — same treatment. |
| `cmps/avatar.css` → `.scss` | 75 | |
| `cmps/card.css` → `.scss` | 7 | |
| `cmps/dropzone.css` → `.scss` | 81 | |
| `cmps/list.css` → `.scss` | 24 | |
| `cmps/navbar.css` → `.scss` | 171 | Already uses native CSS nesting (`&:hover`, `&.is-active`) — that continues to work unchanged under Sass, which is a superset of nesting syntax. |
| `cmps/score-bar.css` → `.scss` | 83 | |
| `cmps/toast.css` → `.scss` | 12 | |
| `cmps/index.css` → `.scss` | 7 | `@import` aggregator for the 7 `cmps/*.css` files — same treatment. |

`frontend/src/main.css` (the true entry point, imported once from `main.ts`) **stays a `.css`
file, unrenamed** — it opens with `@import "tailwindcss";`, which must be processed by the
`@tailwindcss/vite` plugin, not by Sass (Sass would try to resolve `"tailwindcss"` as its own
partial import and fail, since it doesn't end in `.css`/`.scss` and isn't a URL). Only its three
`@import` lines pointing at the subtree aggregators get their extensions updated to `.scss`:

```css
@import "tailwindcss";
@import "vue-sonner/style.css";
@import "./styles/setup/index.scss";
@import "./styles/basics/index.scss";
@import "./styles/cmps/index.scss";
```

Where SCSS features earn their place (apply only where an *exact*, already-existing duplicate
justifies it — this is a preprocessor migration, not a styling refactor):
- `cmps/navbar.css`'s `.theme-toggle` and `.navbar-hamburger` blocks are byte-for-byte identical
  (same size, color, border, transition, and `&:hover` rule) — a good candidate for one SCSS
  `@mixin icon-button { ... }` consumed by both, if the implementing engineer judges it a clean
  win. Not mandatory; call out as the one clear DRY opportunity already present in the files being
  converted.
- The `0.15s ease` transition timing and `var(--radius-full, 9999px)` pattern repeat across
  several `cmps/*.css` files — an SCSS variable (e.g. `$transition-fast: 0.15s ease;`) is
  reasonable if it removes real duplication, but do not go hunting for near-duplicates beyond what
  a straight read of these 12 files already surfaces.

Out of scope:
- `frontend/src/main.css` itself (extension unchanged, only import paths updated, as above).
- Any `.vue` component file — none has a `<style>` block today; this task does not add any.
- Tailwind config, tokens' *values*, or visual output — this is a lossless format migration. The
  computed CSS Vite ships to the browser should be unchanged (mixins/variables introduced per the
  DRY note above compile back to the exact same declarations).
- The backlog's other open line (none currently — this is the last item in `.plan/000-backlog.md`
  at time of writing).

## Assumptions
- Frontend-only; no backend involved, no `stack:full`.
- Vite has built-in Sass support the moment the `sass` npm package is present as a devDependency —
  no `vite.config.ts` changes are needed for `.scss` files to be preprocessed automatically.
- `.claude/rules/ui-and-styling.md` is updated **by the orchestrator, not the frontend agent** —
  the `frontend` role's write boundary (enforced by `.claude/hooks/enforce-agent-boundaries.js`) is
  limited to `frontend/` plus its own report file, and does not include `.claude/`. The rule update
  lands as part of this plan's approval, before the frontend agent starts, so the agent works
  against an already-updated rule rather than one that contradicts its task.
- The new rule text (already applied to `.claude/rules/ui-and-styling.md` as of this plan's
  approval): the "Styling engine" section keeps Tailwind utility classes as the default for
  component markup, and adds that `frontend/src/styles/**` (base/reset/tokens/shared component
  CSS with no Tailwind utility equivalent) is authored in SCSS (`.scss`), with `sass` as the
  preprocessor. `frontend/src/main.css` remains the single plain-CSS Tailwind entry point and is
  not itself SCSS. The existing "do not add new `.css` files" line is narrowed to apply outside
  that styles tree — new shared stylesheets go in `frontend/src/styles/` as `.scss`; inline styles
  remain forbidden.

## Open Questions
- **Does a plain-`.css` file's `@import` of a `.scss` target get preprocessed by Sass before
  Vite/PostCSS inlines it?** This is the one real technical unknown — everything else here is
  mechanical. Recommended approach (verify empirically, cheaply, before converting all 12 files):
  convert just `setup/tokens.css` and `setup/index.css` first (Step 1 below), update `main.css`'s
  corresponding `@import` line, and confirm both `npm run dev` (visually, via the `run` skill) and
  `npm run build` produce unchanged output. If that spike fails, fall back to making `main.css`
  itself `main.scss` and moving the two non-Sass-resolvable imports (`@import "tailwindcss";`,
  `@import "vue-sonner/style.css";`) to the top of that file as literal passthrough imports (both
  already qualify as Sass passthrough syntax: `vue-sonner/style.css` ends in `.css` so Sass leaves
  it alone; `"tailwindcss"` does not and would still need the `@tailwindcss/vite` plugin to see it
  before Sass tries to resolve it as a partial — if that ordering doesn't hold either, the
  fallback-of-the-fallback is a `sass:pkg-importer`-style resolver or keeping `main.css` a thin
  unchanged shim that imports one pre-aggregated `styles.scss`). Recommended: try the direct
  approach first; only reach for a fallback if the spike in Step 1 actually fails.

## Steps
1. **Spike**: add `sass` to `frontend/package.json` devDependencies, run `npm install`. Convert
   only `setup/tokens.css` → `setup/tokens.scss` and `setup/index.css` → `setup/index.scss`
   (updating its `@import './tokens.css'` → `'./tokens.scss'`), then update `main.css`'s matching
   `@import` line to `./styles/setup/index.scss`. Run `npm run dev` and load the app (via the
   `run` skill) to confirm styles still render (tokens/colors/radii unchanged) and `npm run build`
   succeeds. This resolves the Open Question before the remaining 10 files are converted.
2. Convert the remaining `setup/reset.css`, `basics/*.css` (2 files), and `cmps/*.css` (7 files)
   to `.scss` the same way — rename, fix each subtree's own internal `@import` paths (`basics/
   index.scss` → `./base.scss`; `cmps/index.scss` → its 7 `./*.scss` targets), and update
   `main.css`'s remaining two `@import` lines (`basics/index.scss`, `cmps/index.scss`).
3. Apply the one clear DRY opportunity noted in Scope (`.theme-toggle` / `.navbar-hamburger`
   mixin) if it reads as a clean win once inside `navbar.scss` — optional, not required for this
   task to be complete.
4. Grep `frontend/src/**` for `.css` under `styles/` to confirm zero plain `.css` files remain
   there (only `frontend/src/main.css` itself, by design, should still be `.css`).
5. Run `npx vitest run` and `npx vue-tsc --noEmit` — neither should be affected by a CSS-only
   change, but confirm both stay clean (a broken `@import` chain would surface as a build error,
   not a type error, so also run `npm run build`).

## Validation
- `cd frontend && npm run build` succeeds (this is the strongest signal: it runs `vue-tsc -b` and
  a full `vite build`, which fails loudly if any `.scss` file fails to compile or an `@import`
  chain is broken).
- `cd frontend && npx vitest run` — 100% pass (no test should reference these files by content;
  this just confirms nothing else broke).
- Manual check via the `run` skill: load the app in both light and dark theme
  (`data-theme="light"`/`"dark"`, per `artifact-design`-style token conventions already in
  `tokens.css`) and spot-check a page that exercises several converted files at once — e.g. the
  Jobs list (`cmps/card.css`, `cmps/list.css`) with the navbar (`cmps/navbar.css`) and a toast
  triggered (`cmps/toast.css`) — confirm pixel-identical rendering to before this change.
- Confirm `.claude/rules/ui-and-styling.md` reads coherently and no longer contradicts the
  presence of `frontend/src/styles/**/*.scss`.

## Risks
- The Open Question above (cross-extension `@import` from `.css` into `.scss`) is the one place
  this migration could stall partway through — mitigated by spiking it first on two small files
  (Step 1) rather than discovering a wiring problem after all 12 files are renamed.
- Sass's classic `@import` (used throughout, matching the existing files' own `@import` style) is
  a deprecated Sass feature (superseded by `@use`/`@forward`) but is not removed from Dart Sass and
  works today — flagged so a future Sass major-version bump that drops `@import` support isn't a
  surprise; not a reason to use `@use` now, since that would change how every token/variable is
  referenced across files for no behavioral gain in this task.
- None of the 12 files have snapshot/visual regression tests today (confirmed no `.vue` file has a
  `<style>` block and no test asserts on computed CSS), so the manual spot-check in Validation is
  the only real safety net against a subtly broken selector during conversion — copy-paste the
  content into the new file rather than retyping it, to remove that risk almost entirely.

## Rollout Order
Single frontend ticket — no backend involved. The rule-doc update lands first (orchestrator,
before the frontend agent starts) since the frontend agent's task description depends on the rule
already permitting SCSS; the 12-file conversion then lands as one commit (a half-converted
`styles/` tree, with some subtree `@import`s pointing at `.scss` and others still at `.css`, is not
a coherent intermediate state worth its own commit).

## Rollback
Revert the commit touching `frontend/package.json` (drop the `sass` devDependency),
`frontend/src/main.css`, every renamed file under `frontend/src/styles/`, and (separately, since it
was an orchestrator-level change) `.claude/rules/ui-and-styling.md`.
