// QA adversarial pass over .plan/014 (UI/UX polish). These are deliberately the cases the
// implementing agent's own suite does not already prove: the exact threshold boundaries, the
// stagger cap far past its cap index, the brand mark actually not navigating, and the
// prefers-reduced-motion opt-out actually winning the cascade.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createTestingPinia } from '@pinia/testing'

import { cardEnterDelay } from '../src/lib/animation'

const testDir = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(testDir, '../src')

// ---------------------------------------------------------------------------
// cardEnterDelay — the cap, at and well past its boundary
// ---------------------------------------------------------------------------

describe('cardEnterDelay (adversarial)', () => {
  it('steps by a fixed increment for the first cards', () => {
    expect(cardEnterDelay(0)).toBe('0ms')
    expect(cardEnterDelay(1)).toBe('40ms')
    expect(cardEnterDelay(2)).toBe('80ms')
  })

  it('caps at index 8 and returns that same delay for every later index', () => {
    const capped = cardEnterDelay(8)
    expect(capped).toBe('320ms')
    expect(cardEnterDelay(9)).toBe(capped)
    // The case the task calls out explicitly: a 20th card must not wait longer than the 9th.
    expect(cardEnterDelay(20)).toBe(capped)
    expect(cardEnterDelay(500)).toBe(capped)
  })

  it('never exceeds a delay a user would perceive as a stall', () => {
    for (const index of [0, 3, 8, 25, 1000]) {
      const ms = Number(cardEnterDelay(index).replace('ms', ''))
      expect(ms).toBeGreaterThanOrEqual(0)
      expect(ms).toBeLessThanOrEqual(400)
    }
  })
})

// ---------------------------------------------------------------------------
// MatchResult — "over 80" means strictly greater, and the low/mid seam
// ---------------------------------------------------------------------------

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  createMatch: vi.fn()
}))

import MatchResult from '../src/components/MatchResult.vue'
import { createMatch } from '../src/lib/api'

describe('MatchResult score-reveal thresholds (adversarial)', () => {
  beforeEach(() => {
    vi.mocked(createMatch).mockReset()
  })

  async function mountWithScore(score: number) {
    vi.mocked(createMatch).mockResolvedValue({
      id: 'match-1',
      resume_id: 'resume-1',
      job_id: 'job-1',
      score,
      explanation: 'Explanation.',
      created_at: new Date().toISOString()
    })
    // .plan/018: MatchResult calls the match store, which is the only caller of lib/api.
    const wrapper = mount(MatchResult, {
      props: { resumeId: 'resume-1', jobId: 'job-1' },
      global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
    })
    await flushPromises()
    return wrapper
  }

  // The plan says "over 80" — strictly greater. 81 is the first score that celebrates.
  it('celebrates a score of exactly 81, the first score over 80', async () => {
    const wrapper = await mountWithScore(81)

    expect(wrapper.find('.score-reveal-pop').exists()).toBe(true)
    expect(wrapper.find('.score-bar-fill.score-reveal-glow').exists()).toBe(true)
    expect(wrapper.find('.fade-in').exists()).toBe(false)
  })

  it('does not celebrate a score of exactly 80 (>= would be the bug)', async () => {
    const wrapper = await mountWithScore(80)

    expect(wrapper.find('.score-reveal-pop').exists()).toBe(false)
    expect(wrapper.find('.score-reveal-glow').exists()).toBe(false)
    expect(wrapper.find('.fade-in').exists()).toBe(false)
  })

  it('fades a score of exactly 49, the top of the low band', async () => {
    const wrapper = await mountWithScore(49)

    expect(wrapper.find('.score-bar-fill.fade-in').exists()).toBe(true)
    expect(wrapper.find('.score-reveal-pop').exists()).toBe(false)
    expect(wrapper.find('.score-reveal-glow').exists()).toBe(false)
    expect(wrapper.find('.score-bar-fill').classes()).toContain('score-low')
  })

  it('gives a score of exactly 50 neither the celebration nor the fade', async () => {
    const wrapper = await mountWithScore(50)

    expect(wrapper.find('.score-reveal-pop').exists()).toBe(false)
    expect(wrapper.find('.score-reveal-glow').exists()).toBe(false)
    expect(wrapper.find('.fade-in').exists()).toBe(false)
    expect(wrapper.find('.score-bar-fill').classes()).toContain('score-mid')
  })

  // Degenerate scores must not fall through into the celebratory branch.
  it('treats 0 and 100 as low and high respectively, with no class overlap', async () => {
    const zero = await mountWithScore(0)
    expect(zero.find('.score-bar-fill.fade-in').exists()).toBe(true)
    expect(zero.find('.score-reveal-pop').exists()).toBe(false)

    const hundred = await mountWithScore(100)
    expect(hundred.find('.score-reveal-pop').exists()).toBe(true)
    expect(hundred.find('.fade-in').exists()).toBe(false)
  })

  // The reveal classes must never coexist — pop/glow and fade are mutually exclusive by design.
  it('never applies both the celebratory and the fade treatment to one score', async () => {
    for (const score of [0, 10, 49, 50, 74, 75, 80, 81, 99, 100]) {
      const wrapper = await mountWithScore(score)
      const celebrated = wrapper.find('.score-reveal-pop').exists()
      const faded = wrapper.find('.fade-in').exists()
      expect(celebrated && faded).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// NavBar brand mark — interactive again as of .plan/017, which reverses .plan/014's
// non-interactive decision now that "/" is a real destination (the home page). These cases
// are kept and inverted rather than deleted: they are still the behaviour a user notices.
// ---------------------------------------------------------------------------

const mockUser = ref<Record<string, unknown> | null>(null)
const mockProfileImageUrl = ref<string | null>(null)
const mockLogout = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser, profileImageUrl: mockProfileImageUrl, logout: mockLogout })
}))

import NavBar from '../src/components/NavBar.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/jobs', name: 'jobs-list', component: { template: '<div />' } },
      { path: '/jobs/new', name: 'job-new', component: { template: '<div />' } },
      { path: '/cvs', name: 'cvs-list', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } }
    ]
  })
}

describe('NavBar brand mark (adversarial, .plan/017)', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Rita Recruiter',
      email: 'rita@example.com',
      role: 'recruiter',
      org_id: 'demo-org',
      has_profile_image: false
    }
    mockProfileImageUrl.value = null
  })

  // The behaviour a user actually notices: clicking the wordmark from anywhere lands on home.
  it('navigates home when the brand mark is clicked from another route', async () => {
    const router = makeRouter()
    await router.push('/jobs')
    await router.isReady()
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('.navbar-brand').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/')
    expect(router.currentRoute.value.name).toBe('home')
  })

  // Clicking it while already on home must be a no-op, not a rejected duplicate navigation.
  it('stays on home without throwing when the brand mark is clicked from home', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    await wrapper.find('.navbar-brand').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('exposes a real, focusable link affordance on the brand mark', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const brand = wrapper.find('.navbar-brand')
    expect(brand.element.tagName).toBe('A')
    expect(brand.attributes('href')).toBe('/')
    // A single anchor — the wordmark itself, not an anchor nested inside a wrapper.
    expect(brand.element.querySelector('a')).toBeNull()
  })

  // Every role reaches home, including a Candidate — .plan/017 removed the '/' role gate.
  it('renders the brand link for a candidate too', async () => {
    mockUser.value = { ...mockUser.value, role: 'candidate' }
    const router = makeRouter()
    await router.push('/jobs')
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    expect(wrapper.find('.navbar-brand').attributes('href')).toBe('/')
  })

  // Admin, because .plan/015 removed the CVs link for a recruiter — this test is about the
  // brand-mark change not breaking ordinary nav links, so it needs a role that still has one.
  it('leaves the real nav links navigating normally', async () => {
    mockUser.value = { ...mockUser.value, role: 'admin' }
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const cvsLink = wrapper.findAll('.navbar-link').find((link) => link.text().includes('CVs'))
    expect(cvsLink?.attributes('href')).toBe('/cvs')

    await cvsLink?.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/cvs')
  })

  // .plan/017 moved the job-creation form from '/' to '/jobs/new'; the New job link follows it,
  // and must not collide with the brand link that now owns '/'.
  it('routes to /jobs/new from the New job link, not to the brand destination', async () => {
    const router = makeRouter()
    await router.push('/jobs')
    await router.isReady()
    const wrapper = mount(NavBar, { global: { plugins: [router] } })

    const newJob = wrapper.findAll('.navbar-link').find((link) => link.text().includes('New job'))
    await newJob?.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/jobs/new')
  })
})

// ---------------------------------------------------------------------------
// prefers-reduced-motion opt-out — cascade order, not just presence
// ---------------------------------------------------------------------------

// Media queries add no specificity. `@media (prefers-reduced-motion: reduce) { .x {…} }` and a
// plain `.x {…}` are both (0,1,0), so whichever comes LAST in the concatenated stylesheet wins.
// Asserting the block merely exists is not enough — this resolves the real import graph and
// checks that the opt-out is downstream of every rule it is meant to override.
function concatStylesheet(entry: string, seen = new Set<string>()): string {
  if (seen.has(entry)) return ''
  seen.add(entry)

  const source = readFileSync(entry, 'utf8')
  return source.replace(/@import\s+['"]([^'"]+)['"]\s*;/g, (whole, specifier: string) => {
    if (!specifier.startsWith('.')) return ''
    return concatStylesheet(resolve(dirname(entry), specifier), seen)
  })
}

// The app loads its CSS as two entries, in this order (see src/main.ts):
//   1. main.css        — the Tailwind entry (plain CSS, so @tailwindcss/vite processes
//                        `@import "tailwindcss"` and the `@theme` block in setup/tokens.css).
//   2. styles/index.scss — the hand-written SCSS tree (.plan/027). It is imported from main.ts
//                        rather than from main.css because a CSS `@import` of a .scss target is
//                        inlined without running Sass, which silently drops mixins/variables.
// Concatenating in that same order is what makes the source-order assertions below meaningful:
// the reduced-motion opt-out in cmps/score-bar.scss must land after basics/base.scss's rules.
function appStylesheet() {
  const seen = new Set<string>()
  return (
    concatStylesheet(resolve(srcDir, 'main.css'), seen) +
    '\n' +
    concatStylesheet(resolve(srcDir, 'styles/index.scss'), seen)
  )
}

// Every `@media (prefers-reduced-motion: reduce) { ... }` block in the concatenated stylesheet
// (there can be more than one — .plan/014's fix deliberately splits the opt-out across
// base.css and score-bar.css rather than using one block naming all four classes, since a
// single block positioned before score-bar.css's rules would be overridden the same way the
// original bug was). Comments are stripped first so a class name merely *mentioned* in prose
// cannot be mistaken for a declaration.
function findReducedMotionBlocks(css: string) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks: { start: number; end: number; text: string }[] = []
  let searchFrom = 0

  while (true) {
    const marker = stripped.indexOf('prefers-reduced-motion', searchFrom)
    if (marker === -1) break

    const start = stripped.lastIndexOf('@media', marker)
    let depth = 0
    let end = -1
    for (let i = stripped.indexOf('{', start); i < stripped.length; i += 1) {
      if (stripped[i] === '{') depth += 1
      else if (stripped[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }

    blocks.push({ start, end, text: stripped.slice(start, end) })
    searchFrom = end
  }

  return { stripped, blocks }
}

// A real `animation:` declaration for this class, as opposed to the opt-out's `animation: none`.
function declaresAnimation(css: string, className: string) {
  const pattern = new RegExp(`\\${className}\\s*\\{[^}]*animation:\\s*(?!none)\\S`)
  return pattern.test(css)
}

// Every occurrence of a real (non-"none") animation declaration for this class, as a source
// offset into `stripped`.
function realDeclarationOffsets(stripped: string, className: string) {
  const pattern = new RegExp(`\\${className}\\s*\\{[^}]*\\}`, 'g')
  const offsets: number[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(stripped))) {
    if (/animation:\s*(?!none)\S/.test(match[0])) {
      offsets.push(match.index)
    }
  }
  return offsets
}

describe('prefers-reduced-motion opt-out (adversarial)', () => {
  const css = appStylesheet()
  const { stripped, blocks } = findReducedMotionBlocks(css)

  const animationClasses = ['.fade-in', '.card-enter', '.score-reveal-pop', '.score-reveal-glow']

  it('declares at least one reduced-motion block', () => {
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block.text).toContain('animation: none')
    }
  })

  it('names every animation class across the opt-out block(s), combined', () => {
    const allNamedClasses = blocks.map((block) => block.text).join('\n')
    for (const className of animationClasses) {
      expect(allNamedClasses).toContain(className)
    }
  })

  // Each animated class must have every one of its real `animation:` declarations followed, in
  // source order, by a reduced-motion block that names it. A real declaration positioned after
  // every block that names it wins on source order (media queries add no specificity), so its
  // `animation: none` never applies to that declaration.
  it.each(animationClasses)('every %s animation declaration is overridden by a later opt-out block', (className) => {
    const declarationOffsets = realDeclarationOffsets(stripped, className)
    expect(declarationOffsets.length, `no standalone ${className} animation rule found in the stylesheet`).toBeGreaterThan(
      0
    )

    const blocksNamingClass = blocks.filter((block) => block.text.includes(className))
    expect(
      blocksNamingClass.length,
      `no prefers-reduced-motion block names ${className}`
    ).toBeGreaterThan(0)

    for (const offset of declarationOffsets) {
      const hasLaterOptOut = blocksNamingClass.some((block) => block.start > offset)
      expect(
        hasLaterOptOut,
        `${className} has a real animation declaration at offset ${offset} with no ` +
          'prefers-reduced-motion block naming it later in the cascade. Equal specificity means ' +
          'the later rule wins, so reduced-motion users still get this animation.'
      ).toBe(true)
    }
  })

  // declaresAnimation is still used by nothing else in this suite — keep it exercised directly
  // so a future refactor of realDeclarationOffsets can't silently diverge from it.
  it('declaresAnimation and realDeclarationOffsets agree on which classes have a real rule', () => {
    for (const className of animationClasses) {
      expect(declaresAnimation(stripped, className)).toBe(realDeclarationOffsets(stripped, className).length > 0)
    }
  })
})

// ---------------------------------------------------------------------------
// Global scrollbar rules — both browser APIs present in source
// ---------------------------------------------------------------------------

describe('global scrollbar styling (adversarial)', () => {
  const css = appStylesheet()

  it('covers the Firefox API', () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/)
    expect(css).toMatch(/scrollbar-color:\s*var\(--[\w-]+\)/)
  })

  it('covers the WebKit/Blink API for both the bar and the thumb', () => {
    expect(css).toContain('::-webkit-scrollbar')
    expect(css).toContain('::-webkit-scrollbar-thumb')
    expect(css).toContain('::-webkit-scrollbar-track')
  })

  it('uses a theme token rather than a hardcoded colour for the thumb', () => {
    const thumbRule = /::-webkit-scrollbar-thumb\s*\{([^}]*)\}/.exec(css)
    expect(thumbRule).not.toBeNull()
    expect(thumbRule![1]).toMatch(/background:\s*var\(--[\w-]+\)/)
    expect(thumbRule![1]).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  // The universal selector is what carries the Firefox API into internal scroll regions
  // (JobCvsModal's preview pane) without per-component repetition.
  it('applies the Firefox API globally, not only to html/body', () => {
    expect(css).toMatch(/(^|})\s*\*\s*\{[^}]*scrollbar-width:\s*thin/m)
  })
})
