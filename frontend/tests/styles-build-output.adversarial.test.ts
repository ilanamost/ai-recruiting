// QA adversarial pass over .plan/027 (SCSS preprocessor migration).
//
// Why this file exists on top of tests/styles-pipeline.test.ts: every assertion there is made
// against either the *source* text or a standalone `sass.compile()` call. Neither proves the
// thing this migration actually got wrong the first time round. `sass.compile()` invoked
// directly by a test proves only that the tree *can* be compiled by Sass — it says nothing
// about whether Vite's real pipeline ran Sass on it. That is precisely the blind spot that
// made the plan's Step 1 spike a false pass: "Sass ran" and "Sass never ran" produced
// identical output, and the build stayed green while every Sass feature was discarded.
//
// Likewise `expect(tokens).toMatch(/@theme\s+static/)` asserts a string is present in a source
// file, not that Tailwind consequently emitted the token declarations. If Tailwind's
// tree-shaking behaviour changed, that source assertion would keep passing while `.card` lost
// its radius and shadow again.
//
// So this suite asserts against the genuine build artifact — the bytes the browser receives,
// after @tailwindcss/vite and the lightningcss minifier have both had their turn. It is the
// only level at which the silent-failure modes in this migration are actually observable.

import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(testDir, '..')
// Built outside the repo so the probe never shadows or dirties the real dist/.
const outDir = mkdtempSync(join(tmpdir(), 'qa-styles-027-'))

let css = ''

// One real `vite build` for the whole suite, into a throwaway outDir so it never clobbers the
// checked-in dist. `vue-tsc` is skipped deliberately — the npm script's typecheck half is
// covered elsewhere; what is under test here is the CSS pipeline.
beforeAll(async () => {
  await build({
    root: frontendDir,
    logLevel: 'error',
    build: { outDir, emptyOutDir: true }
  })

  const assets = resolve(outDir, 'assets')
  const cssFiles = readdirSync(assets).filter((name) => name.endsWith('.css'))
  expect(cssFiles, 'build emitted no CSS at all').not.toHaveLength(0)

  css = cssFiles.map((name) => readFileSync(resolve(assets, name), 'utf8')).join('\n')
}, 180_000)

// Returns every declaration body the emitted CSS has for an exact selector. Built rather than
// regexed inline because the minifier emits a selector more than once (`.navbar-hamburger`
// appears again inside the mobile breakpoint) and a naive first-match would silently test the
// wrong block.
const bodiesFor = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The leading boundary keeps `.card` from matching inside `.card-enter`; `{` is in the set so
  // rules nested in a media query (the mobile `.navbar-hamburger`) are found too.
  const matches = css.matchAll(new RegExp(`(?:^|[{},])${escaped}\\{([^}]*)\\}`, 'g'))
  return [...matches].map((m) => m[1])
}

describe('built CSS: Sass genuinely ran in the real Vite pipeline (adversarial)', () => {
  // The failure this migration hit: raw Sass reaching the minifier, which drops @mixin/@include
  // as unknown at-rules without erroring. If any of these survive into dist, Sass never ran.
  it('ships no un-preprocessed Sass syntax', () => {
    expect(css).not.toMatch(/@mixin\b/)
    expect(css).not.toMatch(/@include\b/)
    expect(css).not.toMatch(/@use\b/)
    expect(css).not.toMatch(/\$[a-z][\w-]*\s*:/i)
  })

  // The mixin is the canary: these declarations exist nowhere in any .css source, only inside
  // `@mixin icon-button`. They can appear in the artifact if and only if Sass expanded them.
  it.each(['.theme-toggle', '.navbar-hamburger'])(
    'expands every icon-button declaration into %s',
    (selector) => {
      const bodies = bodiesFor(selector)
      expect(bodies, `${selector} missing from built CSS`).not.toHaveLength(0)

      const body = bodies.find((b) => b.includes('width'))
      expect(body, `${selector} has no block carrying the mixin declarations`).toBeDefined()

      expect(body).toMatch(/width:2\.25rem/)
      expect(body).toMatch(/height:2\.25rem/)
      expect(body).toMatch(/border-radius:var\(--radius-full/)
      expect(body).toMatch(/color:var\(--fg-muted\)/)
      expect(body).toMatch(/border:1px solid var\(--border\)/)
      expect(body).toMatch(/transition:color[^;]*border-color/)
    }
  )

  // The mixin deliberately omits `display` because — contrary to the plan's claim that the two
  // blocks were byte-identical — this is the one property where they differ. A mixin that
  // swallowed it would make the hamburger visible on desktop.
  it('leaves each consumer its own distinct display value', () => {
    const toggle = bodiesFor('.theme-toggle').find((b) => b.includes('width'))
    const hamburger = bodiesFor('.navbar-hamburger').find((b) => b.includes('width'))

    expect(toggle).toMatch(/display:inline-flex/)
    expect(hamburger).toMatch(/display:none/)
    expect(hamburger).not.toMatch(/display:inline-flex/)
  })

  // ...and the mobile breakpoint must still be able to turn the hamburger back on.
  it('still reveals the hamburger at the mobile breakpoint', () => {
    expect(bodiesFor('.navbar-hamburger').some((b) => /display:inline-flex/.test(b))).toBe(true)
  })

  it('carries the hover state the mixin defines through to both consumers', () => {
    for (const selector of ['.theme-toggle:hover', '.navbar-hamburger:hover']) {
      const [body] = bodiesFor(selector)
      expect(body, `${selector} missing from built CSS`).toBeDefined()
      expect(body).toMatch(/color:var\(--fg\)/)
      expect(body).toMatch(/border-color:var\(--border-strong\)/)
    }
  })
})

describe('built CSS: @theme static actually emits the tokens (adversarial)', () => {
  // The regression this guards is invisible in source: with a plain `@theme`, Tailwind
  // tree-shook these away because the SCSS tree is a module it never scans, leaving `.card`
  // resolving against undefined variables — square corners, no shadow, no build error.
  it.each([
    ['--radius-sm', /--radius-sm:/],
    ['--radius-lg', /--radius-lg:/],
    ['--radius-full', /--radius-full:/],
    ['--shadow-card', /--shadow-card:/],
    ['--shadow-card-md', /--shadow-card-md:/]
  ])('declares %s in the emitted stylesheet', (_token, pattern) => {
    expect(css).toMatch(pattern)
  })

  // Declared *somewhere* is not enough — it has to be on a selector the consuming rules
  // inherit from, or the var() still resolves to nothing.
  it('declares the radius tokens on :root, not on some scoped selector', () => {
    const i = css.indexOf('--radius-lg')
    const braceStart = css.lastIndexOf('{', i)
    const selector = css.slice(
      Math.max(css.lastIndexOf('}', braceStart), css.lastIndexOf(';', braceStart)) + 1,
      braceStart
    )

    expect(selector).toContain(':root')
  })

  // Closes the loop: the tokens are emitted AND something in the shared tree consumes them.
  // Either half alone would pass while the pair was broken.
  it('keeps .card consuming the radius and shadow tokens it needs', () => {
    const [body] = bodiesFor('.card')
    expect(body, '.card missing from built CSS').toBeDefined()
    expect(body).toMatch(/border-radius:var\(--radius-lg\)/)
    expect(body).toMatch(/box-shadow:var\(--shadow-card\)/)
  })
})

describe('built CSS: the two-entry split preserved the cascade (adversarial)', () => {
  // Splitting one entry into two (main.css + main.ts) is a reordering risk: the shared tree now
  // arrives as a separate module. If it landed before the tokens, or inside a Tailwind layer,
  // the rendering would shift even though every individual rule is intact.
  it('emits the token layer before the shared component rules that consume it', () => {
    expect(css.indexOf('--radius-lg')).toBeLessThan(css.indexOf('.card{'))
  })

  it('keeps the shared tree unlayered so it still beats Tailwind utilities as before', () => {
    const cardIndex = css.indexOf('.card{')
    expect(cardIndex).toBeGreaterThan(-1)

    let depth = 0
    for (let i = 0; i < cardIndex; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }

    // Depth 0 means top level — not nested inside `@layer utilities { ... }` or a media query.
    expect(depth).toBe(0)
  })

  // Tailwind's own output must still be there. Fallback A in the report built cleanly while
  // generating zero utility classes; nothing in the existing suite would have noticed.
  it('still generates token-backed Tailwind utilities', () => {
    expect(css).toMatch(/@layer utilities/)
    expect(css).toMatch(/\.text-primary\b/)
  })

  it('still bundles the vue-sonner stylesheet main.css pulls in', () => {
    expect(css).toMatch(/sonner/)
  })
})

describe('built CSS: no rule was lost in the rename of 11 files (adversarial)', () => {
  // A blunt survivorship check. Every one of these classes comes from a different converted
  // file; if any single rename dropped its content, its representative selector disappears.
  it.each([
    ['setup/reset.scss', /\*,:?:?before/],
    ['basics/base.scss', /\.btn\b/],
    ['cmps/avatar.scss', /\.avatar\b/],
    ['cmps/card.scss', /\.card\{/],
    ['cmps/dropzone.scss', /\.dropzone\b/],
    ['cmps/list.scss', /\.list\b/],
    ['cmps/navbar.scss', /\.navbar\{/],
    ['cmps/score-bar.scss', /\.score-bar\b/],
    // toast.scss defines no `.toast` class — its only rule overrides vue-sonner's own
    // positioning attribute selector, so that compound selector is the representative one.
    ['cmps/toast.scss', /\[data-sonner-toaster\]\.toaster-center/]
  ])('still ships a representative rule from %s', (_file, pattern) => {
    expect(css).toMatch(pattern)
  })
})
