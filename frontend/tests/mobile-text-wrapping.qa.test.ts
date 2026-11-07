// QA adversarial pass for .plan/037 (AI-115). Tries to break the badge split with edge counts,
// unbroken long user text, repeated preview open/close, and CSS cascade-order/media-query traps
// that the implementer's style-contract test does not cover.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as sass from 'sass'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { pageOf } from './helpers/page'

vi.mock('../src/lib/api', async (importOriginal) => ({
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listJobs: vi.fn(),
  listResumes: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
  duplicateJob: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

const mockUser = ref<Record<string, unknown>>({
  id: 'u1',
  name: 'Amy Admin',
  email: 'amy@example.com',
  role: 'admin',
  org_id: 'demo-org',
  has_profile_image: false
})

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import JobsListPage from '../src/pages/JobsListPage.vue'
import { listJobs, listResumes } from '../src/lib/api'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const LONG_TITLE = 'Senior' + 'X'.repeat(200)
const LONG_LOCATION = 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch-' + 'Z'.repeat(120)

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    org_id: 'demo-org',
    title: `Title ${id}`,
    description: 'Description',
    location: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

function resumesFor(jobId: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `resume-${jobId}-${index}`,
    candidate_id: `candidate-${index}`,
    candidate_name: `Candidate ${index}`,
    candidate_email: `c${index}@example.com`,
    file_name: `c${index}.pdf`,
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-03T00:00:00.000Z',
    jobs: [{ id: jobId, title: `Title ${jobId}` }],
    owner_user_id: 'u1',
    years_experience: null,
    skills: []
  }))
}

function mountPage() {
  return mount(JobsListPage, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
      stubs: { JobCvsModal: true }
    }
  })
}

function countBadge(card: ReturnType<ReturnType<typeof mountPage>['find']>) {
  return card.findAll('.list-badge').find((badge) => /\d+ CVs?$/.test(badge.text()))
}

describe('QA adversarial: mobile text wrapping (.plan/037)', () => {
  beforeEach(() => {
    vi.mocked(listJobs).mockReset()
    vi.mocked(listResumes).mockReset()
  })

  it('keeps the count badge a plain nowrap badge for 0, 1 and 25 CVs (singular/plural)', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('zero'), job('one'), job('many')]))
    vi.mocked(listResumes).mockResolvedValue(
      pageOf([...resumesFor('one', 1), ...resumesFor('many', 25)])
    )
    const wrapper = mountPage()
    await flushPromises()

    const cards = wrapper.findAll('li')
    const texts = cards.map((card) => countBadge(card)?.text())
    expect(texts).toEqual(['0 CVs', '1 CV', '25 CVs'])
    for (const card of cards) {
      const badge = countBadge(card)!
      expect(badge.classes()).toContain('list-badge')
      expect(badge.classes()).not.toContain('list-badge-text')
    }
  })

  it('lets an unbroken 200-char title give way (min-w-0 column) instead of squeezing the count badge', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('long', { title: LONG_TITLE, location: LONG_LOCATION })]))
    vi.mocked(listResumes).mockResolvedValue(pageOf(resumesFor('long', 3)))
    const wrapper = mountPage()
    await flushPromises()

    const card = wrapper.find('li')
    const titleColumn = card.find('p.font-semibold').element.parentElement!
    expect(titleColumn.className).toContain('min-w-0')
    expect(titleColumn.className).toContain('[overflow-wrap:anywhere]')

    expect(countBadge(card)!.text()).toBe('3 CVs')
    expect(countBadge(card)!.classes()).not.toContain('list-badge-text')

    const locationBadge = card.findAll('.list-badge').find((badge) => badge.text().includes('Llanfair'))!
    expect(locationBadge.classes()).toContain('list-badge-text')
  })

  it('keeps the badge split stable across rapid preview open/close cycles', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('p', { location: LONG_LOCATION })]))
    vi.mocked(listResumes).mockResolvedValue(pageOf(resumesFor('p', 1)))
    const wrapper = mountPage()
    await flushPromises()

    for (let round = 0; round < 5; round += 1) {
      await wrapper.find('li p.font-semibold').trigger('click')
      const dialog = wrapper.find('div.fixed')
      expect(dialog.exists()).toBe(true)
      const badges = dialog.findAll('.list-badge')
      expect(badges).toHaveLength(2)
      expect(badges.find((badge) => badge.text() === '1 CV')?.classes()).not.toContain('list-badge-text')
      expect(badges.find((badge) => badge.text().includes('Llanfair'))?.classes()).toContain('list-badge-text')
      await dialog.find('button[aria-label="Close preview"]').trigger('click')
      expect(wrapper.find('div.fixed').exists()).toBe(false)
    }
  })

  it('renders no location badge for an empty-string location', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([job('blank', { location: '' })]))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('.list-badge-text')).toHaveLength(0)
    expect(wrapper.findAll('li .list-badge')).toHaveLength(1)
  })
})

describe('QA adversarial: compiled stylesheet cascade (.plan/037)', () => {
  const css = sass.compile(resolve(srcDir, 'styles/index.scss')).css

  // .list-badge and .list-badge-text have equal specificity, so the mobile override only wins if
  // it comes AFTER the base rule. The implementer's contract test does not check order.
  it('places the mobile .list-badge-text rule after the base .list-badge rule', () => {
    const base = css.search(/(^|\n)\.list-badge \{/)
    const mobile = css.search(/@media \(max-width: 767px\)\s*\{\s*\.list-badge-text \{/)
    expect(base).toBeGreaterThanOrEqual(0)
    expect(mobile).toBeGreaterThan(base)
  })

  // Any media query (not only 767px) re-enabling wrap on a plain .list-badge would bring the
  // "3 CVs" bug back at some other width.
  it('has no media query of any width that lets a plain .list-badge wrap or shrink', () => {
    const plainBadgeRules = css.match(/(^|[\s,}])\.list-badge\s*\{[^}]*\}/g) ?? []
    expect(plainBadgeRules.length).toBe(1)
    expect(plainBadgeRules[0]).toContain('white-space: nowrap')
    expect(plainBadgeRules[0]).not.toMatch(/white-space: normal|flex-shrink: 1/)
  })

  it('never lets .list-badge-text wrap outside the mobile breakpoint', () => {
    const rules = css.match(/\.list-badge-text\s*\{[^}]*\}/g) ?? []
    expect(rules).toHaveLength(1)
    // Walk braces up to the rule to find the at-rule (if any) that encloses it.
    const index = css.indexOf(rules[0] ?? '')
    const open: number[] = []
    for (let i = 0; i < index; i += 1) {
      if (css[i] === '{') open.push(i)
      if (css[i] === '}') open.pop()
    }
    expect(open).toHaveLength(1)
    const headerStart = css.lastIndexOf('}', open[0]) + 1
    const header = css.slice(headerStart, open[0]).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    expect(header).toBe('@media (max-width: 767px)')
  })
})
