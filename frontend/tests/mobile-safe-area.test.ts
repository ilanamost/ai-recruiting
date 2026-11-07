// .plan/036 — iPhone layout contract. jsdom has no layout engine, so these assert the pieces
// that make safe-area padding work at all: viewport-fit=cover (without it every
// env(safe-area-inset-*) resolves to 0), the compiled navbar padding, and the <main> padding.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as sass from 'sass'

const testDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(testDir, '..')
const srcDir = resolve(rootDir, 'src')

const read = (path: string) => readFileSync(path, 'utf8')

describe('mobile safe-area layout (.plan/036)', () => {
  it('index.html opts into viewport-fit=cover', () => {
    const html = read(resolve(rootDir, 'index.html'))
    const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/)

    expect(meta).not.toBeNull()
    expect(meta![1]).toContain('width=device-width')
    expect(meta![1]).toContain('viewport-fit=cover')
  })

  it('declares the layout spacing tokens in tokens.css', () => {
    const tokens = read(resolve(srcDir, 'styles/setup/tokens.css'))

    expect(tokens).toMatch(/--navbar-pad-x:\s*1\.5rem/)
    expect(tokens).toMatch(/--navbar-pad-y:\s*0\.875rem/)
    expect(tokens).toMatch(/--page-pad:\s*1\.5rem/)
    expect(tokens).toMatch(/@media \(min-width: 640px\)\s*\{\s*:root\s*\{\s*--page-pad:\s*2rem/)
  })

  it('pads the navbar by max(token, safe-area inset) on top and both sides', () => {
    const { css } = sass.compile(resolve(srcDir, 'styles/index.scss'))
    const navbar = css.match(/\.navbar \{[^}]*\}/)?.[0] ?? ''

    expect(navbar).toContain('padding-top: max(var(--navbar-pad-y), env(safe-area-inset-top))')
    expect(navbar).toContain('padding-left: max(var(--navbar-pad-x), env(safe-area-inset-left))')
    expect(navbar).toContain('padding-right: max(var(--navbar-pad-x), env(safe-area-inset-right))')
  })

  it('keeps the brand and actions from shrinking out of a 390px navbar', () => {
    const { css } = sass.compile(resolve(srcDir, 'styles/index.scss'))

    expect(css.match(/\.navbar-brand \{[^}]*\}/)?.[0]).toContain('flex-shrink: 0')
    expect(css.match(/\.navbar-actions \{[^}]*\}/)?.[0]).toContain('flex-shrink: 0')
  })

  it('lets list badges wrap on mobile instead of forcing horizontal overflow', () => {
    const { css } = sass.compile(resolve(srcDir, 'styles/index.scss'))

    expect(css).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.list-badge\s*\{[^}]*white-space: normal/)
  })

  it('<main> uses the page-pad token widened to the side and bottom safe-area insets', () => {
    const app = read(resolve(srcDir, 'App.vue'))
    const main = app.match(/<main\s+class="([^"]+)"/)?.[1] ?? ''

    expect(main).toContain('pt-(--page-pad)')
    expect(main).toContain('pl-[max(var(--page-pad),env(safe-area-inset-left))]')
    expect(main).toContain('pr-[max(var(--page-pad),env(safe-area-inset-right))]')
    expect(main).toContain('pb-[max(var(--page-pad),env(safe-area-inset-bottom))]')
    // The old fixed padding must not sit alongside and override the token-based one.
    expect(main).not.toMatch(/(^|\s)(sm:)?p-\d/)
    expect(app).toContain('overflow-x-clip')
  })
})
