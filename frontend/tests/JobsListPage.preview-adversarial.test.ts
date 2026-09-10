import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// QA adversarial pass for .plan/020-2026-08-11-job-preview-dialog.md.
//
// JobsListPage.test.ts already covers the happy path: click the description, the dialog opens
// with the untruncated text, and it closes via the X button and via the backdrop. These are the
// cases it does not exercise:
//   - opening previews for different jobs in sequence (stale-snapshot risk)
//   - the description <p> while that card is swapped to the inline edit form
//   - an unrelated page action (search/filter) firing while the dialog is open
//   - a job with neither a location nor any CV (empty/zero state)
//   - a description carrying markup, newlines, or 5000 characters
//   - Escape, which is deliberately NOT wired up (matching JobCvsModal's own preview dialog)

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
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
import { duplicateJob, listJobs, listResumes } from '../src/lib/api'

// Longer than descriptionSnippet's 140-character threshold, so "the dialog shows the full text"
// can never be satisfied by the card's snippet.
const longDescription =
  'We are hiring a backend engineer to own the matching pipeline end to end, from CV ingestion ' +
  'through scoring and explanation.\nYou will work in Node and TypeScript against Postgres.'

// Exactly 140 characters — the boundary descriptionSnippet does NOT truncate ( > 140 ).
const boundaryDescription = 'x'.repeat(140)

// Markup plus a tab and CRLF: Vue text interpolation must escape it rather than parse it, and
// whitespace-pre-wrap must not turn it into DOM.
const hostileDescription = '<script>alert(1)</script>\r\n\tLine two & "quoted" <b>bold</b>'

const jobs = [
  {
    id: 'job-1',
    org_id: 'demo-org',
    title: 'Backend Engineer',
    description: longDescription,
    location: 'Berlin, Germany',
    created_at: '2026-07-01T00:00:00.000Z'
  },
  // Neither a location nor any attached CV — the zero state for both dialog badges.
  {
    id: 'job-2',
    org_id: 'demo-org',
    title: 'Frontend Engineer',
    description: 'Vue and Tailwind',
    location: null,
    created_at: '2026-07-02T00:00:00.000Z'
  },
  {
    id: 'job-3',
    org_id: 'demo-org',
    title: 'Data Engineer',
    description: hostileDescription,
    location: 'Remote',
    created_at: '2026-07-03T00:00:00.000Z'
  }
]

// resume-1 and resume-2 are on job-1 (2 CVs), resume-3 is on job-3 (1 CV, singular), and job-2
// has none (0 CVs, plural).
const resumes = [
  {
    id: 'resume-1',
    candidate_id: 'candidate-1',
    candidate_name: 'Jane Doe',
    candidate_email: 'jane@example.com',
    file_name: 'jane.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-03T00:00:00.000Z',
    jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
    owner_user_id: 'u1',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  },
  {
    id: 'resume-2',
    candidate_id: 'candidate-2',
    candidate_name: 'John Smith',
    candidate_email: 'john@example.com',
    file_name: 'john.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-04T00:00:00.000Z',
    jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
    owner_user_id: 'u1',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  },
  {
    id: 'resume-3',
    candidate_id: 'candidate-3',
    candidate_name: 'Rita Roe',
    candidate_email: 'rita@example.com',
    file_name: 'rita.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-05T00:00:00.000Z',
    jobs: [{ id: 'job-3', title: 'Data Engineer' }],
    owner_user_id: 'u1',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  }
]

// .plan/018: the page reads the job and resume stores rather than lib/api directly, so every
// mount installs its own testing Pinia running the real store actions against the mocked
// lib/api above.
function mountPage() {
  return mount(JobsListPage, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
      stubs: { JobCvsModal: true }
    }
  })
}

// The preview dialog is the only `.fixed.inset-0` this page renders itself — JobCvsModal is
// stubbed, so it contributes no backdrop of its own.
function dialog(wrapper: VueWrapper) {
  return wrapper.find('.fixed.inset-0')
}

// The clickable description paragraphs, in rendered list order. A card in edit mode renders no
// description paragraph at all, so this list is intentionally index-unstable — every test that
// uses it re-reads it after the state change it is asserting on.
function descriptions(wrapper: VueWrapper) {
  return wrapper.findAll('li p.cursor-pointer.text-fg-muted')
}

function cardButton(wrapper: VueWrapper, index: number, label: string) {
  return wrapper
    .findAll('li')[index]
    .findAll('button')
    .find((button) => button.text().includes(label))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listJobs).mockResolvedValue(pageOf(jobs))
  vi.mocked(listResumes).mockResolvedValue(pageOf(resumes))
})

describe('job preview dialog — adversarial (.plan/020)', () => {
  describe('correct job, in sequence', () => {
    // The single reused dialog node is the stale-data risk: `previewJob` is one ref and Vue
    // patches the same DOM in place, so every field has to be re-read from the new job.
    it('shows the second job in full after previewing a different job first', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      expect(dialog(wrapper).find('h2').text()).toBe('Backend Engineer')

      await wrapper.find('button[aria-label="Close preview"]').trigger('click')
      await descriptions(wrapper)[2].trigger('click')

      const opened = dialog(wrapper)
      expect(opened.find('h2').text()).toBe('Data Engineer')
      expect(opened.text()).toContain('Remote')
      expect(opened.text()).toContain('1 CV')
      // Not one character of the previously previewed job may survive.
      expect(opened.text()).not.toContain('Backend Engineer')
      expect(opened.text()).not.toContain('Berlin')
      expect(opened.text()).not.toContain('matching pipeline')
    })

    it('walks all three jobs and never mixes fields between them', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const expected = [
        { title: 'Backend Engineer', badges: 2, count: '2 CVs' },
        { title: 'Frontend Engineer', badges: 1, count: '0 CVs' },
        { title: 'Data Engineer', badges: 2, count: '1 CV' }
      ]

      for (const [index, job] of expected.entries()) {
        await descriptions(wrapper)[index].trigger('click')
        const opened = dialog(wrapper)
        expect(opened.find('h2').text()).toBe(job.title)
        // Location badge + CV badge, or CV badge alone when there is no location.
        expect(opened.findAll('.list-badge')).toHaveLength(job.badges)
        expect(opened.text()).toContain(job.count)
        await wrapper.find('button[aria-label="Close preview"]').trigger('click')
      }
    })

    // Reopening the same job after a close must re-render it, not leave a torn-down node.
    it('reopens the same job after closing it', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      await wrapper.find('button[aria-label="Close preview"]').trigger('click')
      expect(dialog(wrapper).exists()).toBe(false)

      await descriptions(wrapper)[0].trigger('click')
      expect(dialog(wrapper).find('h2').text()).toBe('Backend Engineer')
      expect(dialog(wrapper).text()).toContain(longDescription)
    })
  })

  describe('interaction with the inline edit form', () => {
    // `editingId === job.id` swaps the whole card body to the edit form via v-if/v-else, so the
    // clickable description is not merely hidden — it is not rendered, and the handler is
    // unreachable. This pins that so a future refactor to v-show would fail here.
    it('removes the clickable description from a card that is in edit mode', async () => {
      const wrapper = mountPage()
      await flushPromises()
      expect(descriptions(wrapper)).toHaveLength(3)

      await cardButton(wrapper, 0, 'Edit')?.trigger('click')

      const remaining = descriptions(wrapper)
      expect(remaining).toHaveLength(2)
      // The editing card's own paragraph is gone; the two survivors belong to the other jobs.
      expect(remaining.map((paragraph) => paragraph.text())).not.toContain(
        `${longDescription.slice(0, 140)}…`
      )
      expect(wrapper.findAll('li')[0].find('textarea').exists()).toBe(true)
    })

    // The index shift caused by the missing paragraph must not misroute the click.
    it('opens the correct job when another card is previewed while the first is being edited', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await cardButton(wrapper, 0, 'Edit')?.trigger('click')
      // Index 0 of the remaining descriptions is now job-2, not job-1.
      await descriptions(wrapper)[0].trigger('click')

      const opened = dialog(wrapper)
      expect(opened.exists()).toBe(true)
      expect(opened.find('h2').text()).toBe('Frontend Engineer')
      expect(opened.text()).not.toContain('Backend Engineer')
    })

    // Typing in the edit form must not be interpreted as a preview click, and the form must
    // survive the interaction intact.
    it('leaves the edit form usable and closed-over-by-nothing while editing', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await cardButton(wrapper, 0, 'Edit')?.trigger('click')
      const textarea = wrapper.findAll('li')[0].find('textarea')
      await textarea.setValue('rewritten description')
      await textarea.trigger('click')

      expect(dialog(wrapper).exists()).toBe(false)
      expect((textarea.element as HTMLTextAreaElement).value).toBe('rewritten description')
    })
  })

  describe('unrelated page actions while the dialog is open', () => {
    // In a real browser the z-50 backdrop covers the filter strip, so this is only reachable
    // programmatically — but the dialog must still not tear or blank out if it happens.
    it('keeps showing the previewed job when a title search excludes it from the list', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      await wrapper.find('input[aria-label="Search jobs by title"]').setValue('Frontend')

      const opened = dialog(wrapper)
      expect(opened.exists()).toBe(true)
      expect(opened.find('h2').text()).toBe('Backend Engineer')
      expect(opened.text()).toContain(longDescription)
      // The list behind it narrowed as usual — the dialog did not interfere with filtering.
      expect(wrapper.findAll('li')).toHaveLength(1)
    })

    // The filtered-empty card replaces the whole <ul>; the dialog is its sibling and must
    // survive that branch swap rather than unmounting with the list.
    it('survives a filter that matches no job at all', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      await wrapper.find('input[aria-label="Search jobs by title"]').setValue('zzzz-no-match')

      expect(wrapper.text()).toContain('No jobs match your filters')
      const opened = dialog(wrapper)
      expect(opened.exists()).toBe(true)
      expect(opened.find('h2').text()).toBe('Backend Engineer')

      // And it still closes cleanly from that state.
      await wrapper.find('button[aria-label="Close preview"]').trigger('click')
      expect(dialog(wrapper).exists()).toBe(false)
    })

    // Documents a real seam: `previewJob` holds a snapshot of the job object, while cvCount()
    // is recomputed from the live resume store. A reload that replaces the job objects
    // therefore refreshes the count but NOT the title/description. Not reachable through the
    // UI (the backdrop covers Duplicate), but it is the behavior a future keyboard path or a
    // background refresh would expose.
    it('holds a frozen job snapshot when the underlying list is reloaded', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      expect(dialog(wrapper).find('h2').text()).toBe('Backend Engineer')

      vi.mocked(duplicateJob).mockResolvedValue({ ...jobs[0], id: 'job-1-copy' })
      vi.mocked(listJobs).mockResolvedValue(pageOf([
        { ...jobs[0], title: 'Backend Engineer (renamed)' },
        jobs[1],
        jobs[2]
      ]))
      await cardButton(wrapper, 0, 'Duplicate')?.trigger('click')
      await flushPromises()

      // The card behind it picked the rename up; the dialog kept its snapshot.
      expect(wrapper.findAll('li p.font-semibold')[0].text()).toBe('Backend Engineer (renamed)')
      expect(dialog(wrapper).find('h2').text()).toBe('Backend Engineer')
    })
  })

  describe('empty and zero states', () => {
    // job-2: location null AND zero CVs — neither may render an empty badge, a stray "null",
    // or a dangling separator.
    it('renders a job with no location and no CVs without an empty badge or a null', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[1].trigger('click')

      const opened = dialog(wrapper)
      expect(opened.find('h2').text()).toBe('Frontend Engineer')
      // Exactly one badge — the CV count. The location block is absent, not empty.
      const badges = opened.findAll('.list-badge')
      expect(badges).toHaveLength(1)
      expect(badges[0].text()).toBe('0 CVs')
      expect(opened.text()).not.toContain('null')
      expect(opened.text()).not.toContain('undefined')
      expect(opened.text()).toContain('Created')
    })

    it('pluralizes the CV count correctly at 0, 1, and 2', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const counts: string[] = []
      for (const index of [0, 1, 2]) {
        await descriptions(wrapper)[index].trigger('click')
        counts.push(
          dialog(wrapper)
            .findAll('.list-badge')
            .map((badge) => badge.text())
            .filter((text) => text.includes('CV'))[0]
        )
        await wrapper.find('button[aria-label="Close preview"]').trigger('click')
      }

      expect(counts).toEqual(['2 CVs', '0 CVs', '1 CV'])
    })

    // A job whose location is '' rather than null (the state if the server-side ''→null
    // normalization regressed) must behave like null, not render an empty pill.
    it('treats an empty-string location the same as a missing one', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf([{ ...jobs[0], location: '' }]))
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')

      expect(dialog(wrapper).findAll('.list-badge')).toHaveLength(1)
    })
  })

  describe('hostile description content', () => {
    it('escapes markup in the description instead of rendering it', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[2].trigger('click')

      const opened = dialog(wrapper)
      expect(opened.text()).toContain('<script>alert(1)</script>')
      expect(opened.text()).toContain('<b>bold</b>')
      // Interpolation, not v-html — no element may have been created from that text.
      expect(opened.find('script').exists()).toBe(false)
      expect(opened.find('b').exists()).toBe(false)
    })

    // The plan's Step 2 requires whitespace-pre-wrap so authored line breaks survive. jsdom
    // resolves no stylesheets, so the class presence is what is assertable here; the rendered
    // result needs a live browser.
    it('keeps the raw newlines and applies whitespace-pre-wrap to the description', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')

      const body = dialog(wrapper).find('p.whitespace-pre-wrap')
      expect(body.exists()).toBe(true)
      expect(body.element.textContent).toContain('\n')
      expect(body.element.textContent).toBe(longDescription)
    })

    it('renders a 5000-character description in full', async () => {
      const huge = 'a'.repeat(5000)
      vi.mocked(listJobs).mockResolvedValue(pageOf([{ ...jobs[0], description: huge }]))
      const wrapper = mountPage()
      await flushPromises()

      // The card still truncates.
      expect(descriptions(wrapper)[0].text()).toHaveLength(141)
      await descriptions(wrapper)[0].trigger('click')

      expect(dialog(wrapper).find('p.whitespace-pre-wrap').text()).toHaveLength(5000)
    })

    // 140 characters is not > 140, so the card shows it unabridged and the dialog must match
    // it exactly — no phantom ellipsis on either side.
    it('matches the card exactly at the 140-character truncation boundary', async () => {
      vi.mocked(listJobs).mockResolvedValue(pageOf([{ ...jobs[0], description: boundaryDescription }]))
      const wrapper = mountPage()
      await flushPromises()

      expect(descriptions(wrapper)[0].text()).toBe(boundaryDescription)
      await descriptions(wrapper)[0].trigger('click')

      expect(dialog(wrapper).find('p.whitespace-pre-wrap').text()).toBe(boundaryDescription)
    })
  })

  describe('close affordances', () => {
    // Escape is deliberately NOT wired up: JobCvsModal's own preview dialog does not handle it
    // either, and `grep -rn "keydown|Escape" frontend/src` finds nothing app-wide. This test
    // pins the current, consistent behavior — if Escape is added later it should be added to
    // both dialogs, and this expectation flipped with it.
    it('does not close on Escape, matching JobCvsModal preview', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      await dialog(wrapper).trigger('keydown', { key: 'Escape' })
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()

      expect(dialog(wrapper).exists()).toBe(true)
    })

    // Guards @click.self: a click that originates on the description body inside the panel
    // bubbles to the backdrop and must not be read as a backdrop click.
    it('stays open when a click starts on the description text inside the panel', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')
      await dialog(wrapper).find('p.whitespace-pre-wrap').trigger('click')

      expect(dialog(wrapper).exists()).toBe(true)
    })

    // The preview must not double as a card click target: the card's own action buttons live
    // outside it, and clicking the description must not, for instance, also start an edit.
    it('does not disturb card state when the description is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await descriptions(wrapper)[0].trigger('click')

      expect(wrapper.find('li textarea').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Confirm delete')
      expect(wrapper.findComponent({ name: 'JobCvsModal' }).exists()).toBe(false)
    })
  })
})
