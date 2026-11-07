// .plan/037 — mobile text-wrapping contract. jsdom has no layout engine, so these assert the
// compiled stylesheet: short badges and button labels stay on one row at every size, and only
// badges holding user-supplied text (.list-badge-text) may wrap below 768px.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import * as sass from 'sass'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

let css = ''

// Every top-level `@media (max-width: 767px) { … }` block, so a rule can be checked for being
// inside or outside the mobile breakpoint.
function mobileBlocks() {
  const blocks: string[] = []
  const pattern = /@media \(max-width: 767px\)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    let depth = 1
    let index = match.index + match[0].length
    while (depth > 0 && index < css.length) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      index += 1
    }
    blocks.push(css.slice(match.index, index))
  }
  return blocks
}

// The base rule for a selector, i.e. the one outside any media query.
function baseRule(selector: string) {
  const outside = mobileBlocks().reduce((rest, block) => rest.replace(block, ''), css)
  const escaped = selector.replace(/\./g, '\\.')
  return outside.match(new RegExp(`(^|\\n)${escaped} \\{[^}]*\\}`))?.[0] ?? ''
}

describe('mobile text wrapping (.plan/037)', () => {
  beforeAll(() => {
    css = sass.compile(resolve(srcDir, 'styles/index.scss')).css
  })

  it('keeps .list-badge on one row and unshrinkable at every size', () => {
    const rule = baseRule('.list-badge')

    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('flex-shrink: 0')
  })

  it('has no mobile override that lets a plain .list-badge wrap', () => {
    for (const block of mobileBlocks()) {
      expect(block).not.toMatch(/\.list-badge\s*\{/)
    }
  })

  it('lets .list-badge-text shrink and wrap anywhere below 768px', () => {
    const rule = mobileBlocks()
      .map((block) => block.match(/\.list-badge-text \{[^}]*\}/)?.[0])
      .find(Boolean) ?? ''

    expect(rule).toContain('min-width: 0')
    expect(rule).toContain('white-space: normal')
    expect(rule).toContain('overflow-wrap: anywhere')
  })

  it('does not let .list-badge-text wrap on desktop', () => {
    expect(baseRule('.list-badge-text')).toBe('')
  })

  it('keeps button and navbar labels on one row', () => {
    expect(baseRule('.btn')).toContain('white-space: nowrap')
    expect(baseRule('.navbar-link')).toContain('white-space: nowrap')
    expect(baseRule('.navbar-menu-item')).toContain('white-space: nowrap')
    expect(baseRule('.avatar-picker-placeholder')).toContain('white-space: nowrap')
  })
})
