import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

// QA adversarial pass for .plan/022 (home page collapsible sections). The delivered suite proves
// open/close and per-section independence; this file attacks what it does not touch:
// the chevron's rotate-180 binding (all three sections, both directions), a third toggle and
// synchronous rapid clicking, structural parity between the two different v-if wrappings, and
// the action row's independence from accordion state.
const mockUser = ref<Record<string, unknown> | null>(null)

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import HomePage from '../src/pages/HomePage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/jobs', name: 'jobs-list', component: { template: '<div />' } },
      { path: '/jobs/new', name: 'job-new', component: { template: '<div />' } },
      { path: '/cvs', name: 'cvs-list', component: { template: '<div />' } }
    ]
  })
}

async function mountHome() {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  return mount(HomePage, { global: { plugins: [router] } })
}

type Wrapper = Awaited<ReturnType<typeof mountHome>>

// Document order: 0 = "What it does", 1 = "How it works", 2 = "Key features".
const sections = [
  { index: 0, title: 'What it does', contentSelector: 'div.flex-col > p' },
  { index: 1, title: 'How it works', contentSelector: 'ol > li' },
  { index: 2, title: 'Key features', contentSelector: 'ul > li' }
]

function headers(wrapper: Wrapper) {
  return wrapper.findAll('section.card button[aria-expanded]')
}

function isExpanded(wrapper: Wrapper, index: number) {
  return headers(wrapper)[index].attributes('aria-expanded')
}

// The chevron is the ONLY svg inside a header button — scoping to the button keeps the feature
// list's own item icons (section 2, when open) out of this selector.
function chevron(wrapper: Wrapper, index: number) {
  return headers(wrapper)[index].find('svg')
}

// Content = whatever that section's v-if actually toggles, regardless of how it is wrapped.
function contentNodes(wrapper: Wrapper, index: number) {
  return wrapper.findAll('section.card')[index].findAll(sections[index].contentSelector)
}

async function clickHeader(wrapper: Wrapper, index: number) {
  await headers(wrapper)[index].trigger('click')
}

function setRole(role: string | null) {
  mockUser.value = role === null ? null : { id: 'u1', name: 'T', email: 't@e.com', role, org_id: 'demo-org' }
}

function actionLinks(wrapper: Wrapper) {
  return wrapper.findAll('a.btn').map((link) => ({ text: link.text(), href: link.attributes('href') }))
}

describe('HomePage accordion (adversarial)', () => {
  beforeEach(() => {
    setRole('recruiter')
  })

  describe('chevron rotation binding', () => {
    // The delivered suite asserts aria-expanded but never the chevron class, so a section whose
    // chevron was wired to the wrong ref (or to no ref) would ship green.
    it.each(sections)('un-rotates only "$title" chevron when only that section is closed', async ({ index, title }) => {
      const wrapper = await mountHome()

      for (const section of sections) {
        expect(chevron(wrapper, section.index).classes()).toContain('rotate-180')
      }

      await clickHeader(wrapper, index)

      expect(chevron(wrapper, index).classes(), `${title} chevron should not be rotated when closed`).not.toContain('rotate-180')
      for (const other of sections.filter((section) => section.index !== index)) {
        expect(
          chevron(wrapper, other.index).classes(),
          `${other.title} chevron must stay rotated when only ${title} closes`
        ).toContain('rotate-180')
      }
    })

    it.each(sections)('re-rotates "$title" chevron when the section is reopened', async ({ index }) => {
      const wrapper = await mountHome()

      await clickHeader(wrapper, index)
      expect(chevron(wrapper, index).classes()).not.toContain('rotate-180')

      await clickHeader(wrapper, index)
      expect(chevron(wrapper, index).classes()).toContain('rotate-180')
    })

    // Rotation is a transform on a persistent element, so the transition class must survive
    // every state change — otherwise the icon snaps instead of animating on the second open.
    it.each(sections)('keeps the transition and sizing classes on "$title" chevron in both states', async ({ index }) => {
      const wrapper = await mountHome()

      for (const _ of [0, 1]) {
        const classes = chevron(wrapper, index).classes()
        expect(classes).toContain('transition-transform')
        expect(classes).toContain('size-4')
        await clickHeader(wrapper, index)
      }
    })
  })

  describe('aria-expanded / content / chevron stay in sync', () => {
    // open -> close -> open. The delivered suite stops at close, so a ref that latched after one
    // round trip (or content that failed to re-mount) would go unnoticed.
    it.each(sections)('survives a third toggle of "$title" with all three signals agreeing', async ({ index }) => {
      const wrapper = await mountHome()
      const expected = [false, true, false]

      for (const open of expected) {
        await clickHeader(wrapper, index)

        expect(isExpanded(wrapper, index)).toBe(String(open))
        expect(contentNodes(wrapper, index).length > 0).toBe(open)
        expect(chevron(wrapper, index).classes().includes('rotate-180')).toBe(open)
      }
    })

    // Synchronous clicks inside one tick: Vue batches the re-render, so the final DOM must match
    // the parity of the click count, not some intermediate state.
    it.each([
      { clicks: 1, open: false },
      { clicks: 2, open: true },
      { clicks: 5, open: false },
      { clicks: 8, open: true }
    ])('settles correctly after $clicks rapid synchronous clicks', async ({ clicks, open }) => {
      const wrapper = await mountHome()
      const button = headers(wrapper)[1].element as HTMLButtonElement

      for (let i = 0; i < clicks; i++) button.click()
      await nextTick()

      expect(isExpanded(wrapper, 1)).toBe(String(open))
      expect(contentNodes(wrapper, 1).length > 0).toBe(open)
      expect(chevron(wrapper, 1).classes().includes('rotate-180')).toBe(open)
    })

    // Interleaving two sections must not let one section's re-render clobber the other's state.
    it('keeps two sections in independent, correct states through interleaved toggling', async () => {
      const wrapper = await mountHome()

      await clickHeader(wrapper, 0)
      await clickHeader(wrapper, 2)
      await clickHeader(wrapper, 0)
      await clickHeader(wrapper, 1)

      const expected = [true, false, false]
      for (const { index } of sections) {
        expect(isExpanded(wrapper, index)).toBe(String(expected[index]))
        expect(contentNodes(wrapper, index).length > 0).toBe(expected[index])
        expect(chevron(wrapper, index).classes().includes('rotate-180')).toBe(expected[index])
      }
    })
  })

  describe('structural parity across the two wrapping approaches', () => {
    // "What it does" wraps three <p>s in one <div v-if>; the other two put v-if on the <ol>/<ul>.
    // The header contract must be identical regardless of which shape sits below it.
    it.each([false, true])('gives every section the same header contract (open=%s)', async (open) => {
      const wrapper = await mountHome()

      if (!open) for (const { index } of sections) await clickHeader(wrapper, index)

      expect(headers(wrapper)).toHaveLength(3)

      for (const { index, title } of sections) {
        const header = headers(wrapper)[index]

        expect(header.attributes('type')).toBe('button')
        expect(header.attributes('aria-expanded')).toBe(String(open))
        // Exactly one chevron per header — the feature list's item icons must not leak in.
        expect(header.findAll('svg')).toHaveLength(1)
        // The heading wraps the button (not the reverse) — a <button> is phrasing content and
        // can't validly contain a heading, which is flow content. So the heading is an ancestor
        // of the button, not a descendant: .find() only searches descendants, hence closest().
        expect(header.element.closest('h1, h2')).not.toBeNull()
        expect(header.text()).toContain(title)
      }
    })

    // Collapsed must mean *nothing* renders below the header for that section, not merely that
    // the one element the delivered helper looks for is gone.
    it.each(sections)('leaves no residual content below the "$title" header when closed', async ({ index }) => {
      const wrapper = await mountHome()
      const section = () => wrapper.findAll('section.card')[index]

      const openText = section().text()
      expect(contentNodes(wrapper, index).length).toBeGreaterThan(0)

      await clickHeader(wrapper, index)
      const closedText = section().text()

      expect(contentNodes(wrapper, index).length).toBe(0)
      expect(section().findAll('p, ol, ul, li')).toHaveLength(0)
      // Closed section renders only its own title, nothing of the body copy.
      expect(closedText.trim()).toBe(sections[index].title)
      expect(openText.length).toBeGreaterThan(closedText.length)
    })

    // Section titles are always reachable as headings, open or closed — the backlog asks for
    // collapsible titles, not disappearing ones.
    it.each([false, true])('always exposes all three headings (open=%s)', async (open) => {
      const wrapper = await mountHome()

      if (!open) for (const { index } of sections) await clickHeader(wrapper, index)

      expect(wrapper.findAll('h1, h2').map((heading) => heading.text())).toEqual([
        'What it does',
        'How it works',
        'Key features'
      ])
    })
  })

  describe('action row is independent of accordion state', () => {
    const combos = [
      [], [0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]
    ]

    it.each([
      { role: 'recruiter', expected: [{ text: 'Post a job', href: '/jobs/new' }, { text: 'View jobs', href: '/jobs' }] },
      { role: 'admin', expected: [{ text: 'Post a job', href: '/jobs/new' }, { text: 'View jobs', href: '/jobs' }] },
      { role: 'candidate', expected: [{ text: 'Browse jobs', href: '/jobs' }, { text: 'Upload a CV', href: '/cvs' }] }
    ])('renders the same action row for $role in all 8 open/closed combinations', async ({ role, expected }) => {
      for (const combo of combos) {
        setRole(role)
        const wrapper = await mountHome()

        for (const index of combo) await clickHeader(wrapper, index)

        expect(actionLinks(wrapper), `role=${role} open=[${combo.join(',')}]`).toEqual(expected)
      }
    })

    // Fail-closed check repeated under accordion state: opening sections must never surface a
    // job-creation CTA to a Candidate or an unresolved user.
    it.each([null, 'candidate', 'auditor'])('never leaks a job-creation link to %s with every section open', async (role) => {
      setRole(role)
      const wrapper = await mountHome()

      expect(wrapper.find('a[href="/jobs/new"]').exists()).toBe(false)
      expect(wrapper.findAll('a.btn').map((link) => link.text())).not.toContain('Post a job')
    })
  })

  describe('content integrity once opened', () => {
    // The three pre-existing content tests now open their section first; this guards the reverse
    // risk — that opening yields a shell with the copy lost in the re-wrapping.
    it('restores the full intro copy every time "What it does" is reopened', async () => {
      const wrapper = await mountHome()

      for (const _ of [0, 1]) {
        await clickHeader(wrapper, 0) // close
        await clickHeader(wrapper, 0) // reopen
        const paragraphs = wrapper.findAll('section.card')[0].findAll('p')

        expect(paragraphs).toHaveLength(3)
        for (const paragraph of paragraphs) expect(paragraph.text().length).toBeGreaterThan(40)
      }
    })

    it('restores every step and feature row on reopen', async () => {
      const wrapper = await mountHome()

      for (const _ of [0, 1]) {
        await clickHeader(wrapper, 1) // close
        await clickHeader(wrapper, 2) // close
        await clickHeader(wrapper, 1) // reopen
        await clickHeader(wrapper, 2) // reopen

        expect(wrapper.findAll('section.card')[1].findAll('ol > li')).toHaveLength(4)
        expect(wrapper.findAll('section.card')[2].findAll('ul > li')).toHaveLength(4)
      }
    })
  })
})
