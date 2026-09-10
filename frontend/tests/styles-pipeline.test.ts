// Guards the styling build pipeline set up by .plan/027 (SCSS preprocessor).
//
// The failure mode these cover is silent: if the SCSS tree is reached through main.css's CSS
// `@import` chain, @tailwindcss/vite (which owns @import resolution for that file, since it
// opens with `@import "tailwindcss"`) inlines the target as raw bytes without running Sass.
// Everything still builds, the app still renders, and every Sass-only construct (@mixin,
// @include, $variable) is quietly dropped by the CSS minifier as an unknown at-rule. Nothing
// fails loudly, so only an explicit test catches it.
//
// The mirror-image failure is just as quiet: routing the token file through Sass instead hides
// its `@theme` block from @tailwindcss/vite, which silently stops generating the token-backed
// utilities (.text-primary, .bg-bg) and drops the theme variables the shared tree consumes.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as sass from 'sass'

const testDir = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(testDir, '../src')
const stylesDir = resolve(srcDir, 'styles')

const read = (path: string) => readFileSync(path, 'utf8')

describe('SCSS is actually preprocessed (.plan/027)', () => {
  it('compiles the shared tree through Sass with no Sass syntax left behind', () => {
    const { css } = sass.compile(resolve(stylesDir, 'index.scss'))

    expect(css).not.toMatch(/@(mixin|include|use|forward)\b/)
    expect(css).not.toMatch(/\$[a-z][\w-]*\s*:/i)
    // A representative rule from the deepest subtree, proving the whole graph compiled.
    expect(css).toContain('.card')
  })

  // The mixin is the canary: it exists only in the Sass source, so its declarations can only
  // appear in the output if Sass ran. Under a raw CSS inline they vanish without an error.
  it('expands the shared icon-button mixin into both consumers', () => {
    const { css } = sass.compile(resolve(stylesDir, 'index.scss'))

    for (const selector of ['.theme-toggle', '.navbar-hamburger']) {
      const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)
      expect(rule, `${selector} rule missing from compiled output`).not.toBeNull()

      const body = rule![1]
      expect(body).toMatch(/width:\s*2\.25rem/)
      expect(body).toMatch(/height:\s*2\.25rem/)
      expect(body).toMatch(/border-radius:\s*var\(--radius-full/)
      expect(body).toMatch(/border:\s*1px solid var\(--border\)/)
    }

    // Each consumer keeps its own display value — the one declaration the mixin does not set.
    expect(/\.theme-toggle\s*\{[^}]*display:\s*inline-flex/.test(css)).toBe(true)
    expect(/\.navbar-hamburger\s*\{[^}]*display:\s*none/.test(css)).toBe(true)
  })

  it('routes the SCSS tree through main.ts, never through a CSS @import', () => {
    const mainTs = read(resolve(srcDir, 'main.ts'))
    const mainCss = read(resolve(srcDir, 'main.css'))

    expect(mainTs).toContain("import './styles/index.scss'")
    // A `.scss` target reached from main.css would skip Sass entirely.
    expect(mainCss).not.toMatch(/@import\s+['"][^'"]*\.scss['"]/)
  })

  it('leaves no plain .css file in the SCSS tree', () => {
    const entries = readdirSync(stylesDir, { recursive: true, encoding: 'utf8' })
    const plainCss = entries.filter((entry) => entry.endsWith('.css'))

    // setup/tokens.css is the deliberate exception: it carries the Tailwind `@theme` block.
    expect(plainCss.map((p) => p.replace(/\\/g, '/'))).toEqual(['setup/tokens.css'])
  })
})

describe('Tailwind keeps ownership of the token layer (.plan/027)', () => {
  it('keeps main.css a plain-CSS entry that imports Tailwind and the tokens', () => {
    const mainCss = read(resolve(srcDir, 'main.css'))

    expect(mainCss).toContain('@import "tailwindcss";')
    expect(mainCss).toContain('./styles/setup/tokens.css')
  })

  // Tailwind only emits `@theme` variables it sees used. The shared SCSS tree is a separate
  // Vite module it never scans, so without `static` these are tree-shaken and rules like
  // `.card { border-radius: var(--radius-lg) }` resolve against an undefined variable.
  it('declares the tokens `static` so the shared tree can consume them', () => {
    const tokens = read(resolve(stylesDir, 'setup/tokens.css'))

    expect(tokens).toMatch(/@theme\s+static\s*\{/)

    const themeBlock = /@theme\s+static\s*\{([\s\S]*?)\n\}/.exec(tokens)
    expect(themeBlock).not.toBeNull()
    for (const token of ['--radius-lg', '--radius-full', '--shadow-card', '--color-primary']) {
      expect(themeBlock![1]).toContain(token)
    }
  })

  it('consumes those tokens from the SCSS tree, which is what makes `static` load-bearing', () => {
    const { css } = sass.compile(resolve(stylesDir, 'index.scss'))

    expect(css).toMatch(/var\(--radius-lg\)/)
    expect(css).toMatch(/var\(--shadow-card\)/)
  })
})
