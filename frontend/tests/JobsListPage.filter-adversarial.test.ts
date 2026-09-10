import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// QA adversarial pass for .plan/013-2026-08-10-job-search-filter.md.
// JobsListPage.test.ts covers each filter dimension narrowing correctly and title+location
// / applied+title combining with AND. These are the hostile combinations it does not
// exercise: an all-caps search term, an inverted date range, a whitespace-only term, an
// empty-string location (vs null), a role switch mid-session leaving a stale applied
// filter, and every dimension stacked at once.

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
import { listJobs, listResumes } from '../src/lib/api'

// .plan/018: the page reads the job and resume stores rather than lib/api directly, so every
// mount installs its own testing Pinia running the real store actions against the mocked
// lib/api below.
function mountPage() {
  return mount(JobsListPage, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
      stubs: { JobCvsModal: true }
    }
  })
}

function renderedTitles(wrapper: VueWrapper) {
  return wrapper.findAll('li p.font-semibold').map((title) => title.text())
}

// The value <input type="date"> holds for a given timestamp, in the runner's local timezone —
// the same local calendar key the page filters on (localDateKey).
function localKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA')
}

// job-4 carries location: '' — the state that would exist if the server-side ''→null
// normalization ever regressed. It must behave exactly like job-3's null, not like a
// matchable location.
const jobs = [
  {
    id: 'job-1',
    org_id: 'demo-org',
    title: 'Backend Engineer',
    description: 'Node and TypeScript',
    location: 'Berlin, Germany',
    created_at: '2026-07-01T00:00:00.000Z'
  },
  {
    id: 'job-2',
    org_id: 'demo-org',
    title: 'Frontend Engineer',
    description: 'Vue and Tailwind',
    location: 'BERLIN, GERMANY',
    created_at: '2026-07-10T00:00:00.000Z'
  },
  {
    id: 'job-3',
    org_id: 'demo-org',
    title: 'Backend Architect',
    description: 'Distributed systems',
    location: null,
    created_at: '2026-07-20T00:00:00.000Z'
  },
  {
    id: 'job-4',
    org_id: 'demo-org',
    title: 'Data Engineer',
    description: 'Pipelines',
    location: '',
    created_at: '2026-07-25T00:00:00.000Z'
  }
]

const resumes = [
  {
    id: 'resume-own',
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
    id: 'resume-other',
    candidate_id: 'candidate-2',
    candidate_name: 'John Smith',
    candidate_email: 'john@example.com',
    file_name: 'john.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-04T00:00:00.000Z',
    jobs: [{ id: 'job-2', title: 'Frontend Engineer' }],
    owner_user_id: 'u2',
    // .plan/029 added these to Resume. Unused here — this suite predates the
    // recruiter filters and does not exercise them.
    years_experience: null,
    skills: []
  }
]

describe('JobsListPage search/filter — adversarial (.plan/013)', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Amy Admin',
      email: 'amy@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listJobs).mockReset().mockResolvedValue(pageOf(jobs))
    vi.mocked(listResumes).mockReset().mockResolvedValue(pageOf(resumes))
  })

  // Backlog: "The search and filter bar should appear below the 'Jobs' title and fit the
  // general application design."
  // Revised 2026-08-10: the single `.card` bar became two rows — a full-width title search
  // with an inline icon, then a filter strip on the page-background token — both still sitting
  // directly under the heading and above the list.
  it('renders the two filter rows directly after the Jobs heading, above the list', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const children = Array.from(wrapper.element.children)
    const heading = wrapper.find('h1')

    expect(heading.text()).toBe('Jobs')
    expect(children[0]).toBe(heading.element)

    const searchRow = children[1] as HTMLElement
    const filterRow = children[2] as HTMLElement

    // Row 1: the search input, full width, with the icon rendered inside it.
    const searchInput = searchRow.querySelector('input[type=text]') as HTMLInputElement
    expect(searchInput.getAttribute('placeholder')).toBe('Search by title')
    expect(searchInput.classList.contains('w-full')).toBe(true)
    expect(searchRow.querySelectorAll('input')).toHaveLength(1)
    expect(searchRow.querySelector('svg')).not.toBeNull()
    // No `.card` wrapper on either row any more.
    expect(searchRow.classList.contains('card')).toBe(false)
    expect(filterRow.classList.contains('card')).toBe(false)

    // Row 2: location + the single creation-date filter, on a background distinguishable
    // from the `.card` surface the job list below uses.
    expect(filterRow.querySelectorAll('input[type=text]')).toHaveLength(1)
    expect(filterRow.querySelector('input[type=text]')?.getAttribute('placeholder')).toBe('Search by location')
    expect(filterRow.querySelectorAll('input[type=date]')).toHaveLength(1)
    expect(filterRow.classList.contains('bg-bg')).toBe(true)

    // The whole list (and both empty states) sits after both rows, never above them.
    expect(children.indexOf(wrapper.find('ul').element)).toBeGreaterThan(2)
  })

  // The global input:focus rule in base.css already turns the input's border primary; the
  // icon has to follow it, which is why row 1 is a `group` and the icon carries
  // group-focus-within:text-primary. jsdom doesn't evaluate Tailwind, so assert the wiring.
  it('links the search icon colour to the input focus state via group-focus-within', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const searchRow = wrapper.element.children[1] as HTMLElement
    expect(searchRow.classList.contains('group')).toBe(true)
    // The icon is positioned inside the input, so the row must be a positioning context.
    expect(searchRow.classList.contains('relative')).toBe(true)

    const icon = searchRow.querySelector('svg') as SVGElement
    const iconClasses = icon.getAttribute('class') ?? ''
    expect(iconClasses).toContain('absolute')
    expect(iconClasses).toContain('text-fg-muted')
    expect(iconClasses).toContain('group-focus-within:text-primary')

    // Left-side icon means the input needs matching left padding, not right.
    const searchInput = searchRow.querySelector('input[type=text]') as HTMLInputElement
    expect(iconClasses).toContain('left-3')
    // pl-9! (with the Tailwind important modifier), not pl-9: base.css's shared
    // input[type='text'] padding rule is unlayered plain CSS and overrides a same-or-lower
    // specificity utility regardless of layer order, so the plain pl-9 utility was silently
    // discarded and the icon sat under the placeholder text before this fix.
    expect(searchInput.classList.contains('pl-9!')).toBe(true)
  })

  // QA Finding 2 (fixed, post-report): the filter bar used to render even while jobs were
  // still loading or had failed to load, sitting above the loading spinner / error card with
  // nothing meaningful to filter yet. It's now gated the same way the list itself is.
  // Both rows are gated together, so each of these asserts neither row rendered — not just
  // the search input.
  function expectNoFilterRows(wrapper: VueWrapper) {
    expect(wrapper.find('input[placeholder="Search by title"]').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="Search by location"]').exists()).toBe(false)
    expect(wrapper.find('input[type=date]').exists()).toBe(false)
  }

  it('hides the filter rows while jobs are loading', () => {
    vi.mocked(listJobs).mockReturnValue(new Promise(() => {}))
    const wrapper = mountPage()

    expect(wrapper.text()).toContain('Loading jobs')
    expectNoFilterRows(wrapper)
  })

  it('hides the filter rows when loading jobs fails', async () => {
    vi.mocked(listJobs).mockRejectedValue(new Error('Failed to load jobs'))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load jobs')
    expectNoFilterRows(wrapper)
  })

  it('hides the filter rows when there are no jobs at all', async () => {
    vi.mocked(listJobs).mockResolvedValue(pageOf([]))
    vi.mocked(listResumes).mockResolvedValue(pageOf([]))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No jobs yet')
    expectNoFilterRows(wrapper)
  })

  it('matches an all-caps location term against a mixed-case stored location and vice versa', async () => {
    const wrapper = mountPage()
    await flushPromises()

    // Term is uppercase, one stored value is title-case and the other is uppercase — both hit.
    await wrapper.find('input[placeholder="Search by location"]').setValue('BERLIN')
    expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Frontend Engineer'])

    // Lowercase term, same two.
    await wrapper.find('input[placeholder="Search by location"]').setValue('germany')
    expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Frontend Engineer'])
  })

  it('matches an all-caps title term case-insensitively', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('input[placeholder="Search by title"]').setValue('ENGINEER')

    expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Frontend Engineer', 'Data Engineer'])
  })

  // Was "dateFrom after dateTo" before the single-date revision (2026-08-10). The equivalent
  // hostile input for one exact-match input is a day nothing was created on — plus the far
  // past/future, where a range filter's inequalities would have silently kept everything.
  it('returns zero results gracefully for a date no job was created on, and recovers', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const dateInput = wrapper.find('input[type=date]')
    await dateInput.setValue(localKey('2026-07-15T12:00:00.000Z'))

    expect(renderedTitles(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('No jobs match your filters')
    expect(wrapper.text()).not.toContain('No jobs yet')

    // A far-past and a far-future day both match nothing — an exact day, not an open bound.
    await dateInput.setValue('1970-01-01')
    expect(renderedTitles(wrapper)).toHaveLength(0)
    await dateInput.setValue('2999-12-31')
    expect(renderedTitles(wrapper)).toHaveLength(0)

    // And it recovers: a real creation day brings that job back.
    await dateInput.setValue(localKey(jobs[3].created_at))
    expect(renderedTitles(wrapper)).toEqual(['Data Engineer'])

    // Clearing it brings the whole list back.
    await dateInput.setValue('')
    expect(renderedTitles(wrapper)).toHaveLength(4)
  })

  it('treats a whitespace-only search term as empty, matching every job', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('input[placeholder="Search by title"]').setValue('   ')
    await wrapper.find('input[placeholder="Search by location"]').setValue('  \t ')

    expect(renderedTitles(wrapper)).toHaveLength(4)
  })

  it('excludes a job with an empty-string location from a location search, same as a null one', async () => {
    const wrapper = mountPage()
    await flushPromises()

    // Both the null-location and ''-location jobs are present with no location term.
    expect(renderedTitles(wrapper)).toContain('Backend Architect')
    expect(renderedTitles(wrapper)).toContain('Data Engineer')

    await wrapper.find('input[placeholder="Search by location"]').setValue('Berlin')

    expect(renderedTitles(wrapper)).not.toContain('Backend Architect')
    expect(renderedTitles(wrapper)).not.toContain('Data Engineer')
  })

  it('renders no location badge for an empty-string location, same as a null one', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const cards = wrapper.findAll('li')
    const emptyStringCard = cards.find((li) => li.text().includes('Data Engineer'))
    const nullCard = cards.find((li) => li.text().includes('Backend Architect'))

    // The CV-count badge is always present; a location badge would be a second one.
    expect(emptyStringCard?.findAll('.list-badge')).toHaveLength(1)
    expect(nullCard?.findAll('.list-badge')).toHaveLength(1)
    expect(cards.find((li) => li.text().includes('Backend Engineer'))?.findAll('.list-badge')).toHaveLength(2)
  })

  it('returns no matches for a long, malformed search term without erroring', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('input[placeholder="Search by title"]').setValue('%%(.*)+'.repeat(500))

    expect(renderedTitles(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('No jobs match your filters')
  })

  it('stacks title, location and the creation date with AND', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('input[placeholder="Search by title"]').setValue('Engineer')
    expect(renderedTitles(wrapper)).toHaveLength(3)

    await wrapper.find('input[placeholder="Search by location"]').setValue('Berlin')
    expect(renderedTitles(wrapper)).toEqual(['Backend Engineer', 'Frontend Engineer'])

    await wrapper.find('input[type=date]').setValue(localKey(jobs[1].created_at))

    // OR at any layer would have kept more than this one job.
    expect(renderedTitles(wrapper)).toEqual(['Frontend Engineer'])

    // Every layer still binds: a date that only the excluded-by-location job was created on
    // empties the list rather than resurrecting it.
    await wrapper.find('input[type=date]').setValue(localKey(jobs[3].created_at))
    expect(renderedTitles(wrapper)).toHaveLength(0)
  })

  // QA Finding 1 (fixed, post-report): the date filter used to key off
  // created_at.slice(0, 10) — the UTC calendar date — while the card's "Created …" line uses
  // toLocaleDateString (local), so a job created near midnight could display one calendar day
  // and filter as the adjacent one. Both sides now use the same local-time key
  // (localDateKey, en-CA), so they agree everywhere, including near midnight. The single-date
  // revision (2026-08-10) makes this stricter, not looser: an exact-day match has no bound to
  // absorb an off-by-one-day key.
  describe('creation-date filter agrees with the local "Created" display near midnight', () => {
    const nearMidnightJob = {
      id: 'job-late',
      org_id: 'demo-org',
      title: 'Night Shift Engineer',
      description: 'Created just before UTC midnight',
      location: 'Berlin, Germany',
      created_at: '2026-07-01T23:30:00.000Z'
    }

    beforeEach(() => {
      vi.mocked(listJobs).mockResolvedValue(pageOf([nearMidnightJob]))
      vi.mocked(listResumes).mockResolvedValue(pageOf([]))
    })

    it('filters on the same local calendar date the card displays', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const localDay = new Date(nearMidnightJob.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
      expect(wrapper.text()).toContain(`Created ${localDay}`)

      const dateInput = wrapper.find('input[type=date]')

      // The exact day the card displays always includes it — no divergence, any timezone.
      await dateInput.setValue(localKey(nearMidnightJob.created_at))
      expect(renderedTitles(wrapper)).toEqual(['Night Shift Engineer'])

      // The adjacent local day excludes it.
      const nextDay = new Date(nearMidnightJob.created_at)
      nextDay.setDate(nextDay.getDate() + 1)
      await dateInput.setValue(nextDay.toLocaleDateString('en-CA'))
      expect(renderedTitles(wrapper)).toHaveLength(0)

      // And the day before, which a UTC-keyed comparison would have hit in a timezone
      // behind UTC.
      const prevDay = new Date(nearMidnightJob.created_at)
      prevDay.setDate(prevDay.getDate() - 1)
      await dateInput.setValue(prevDay.toLocaleDateString('en-CA'))
      expect(renderedTitles(wrapper)).toHaveLength(0)
    })
  })

  describe('as a candidate', () => {
    beforeEach(() => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
    })

    it('combines the applied filter with a location search using AND', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('select').setValue('not_applied')
      // job-2/3/4 are "not applied" for u1 (job-2's attached CV belongs to u2).
      expect(renderedTitles(wrapper)).toEqual(['Frontend Engineer', 'Backend Architect', 'Data Engineer'])

      await wrapper.find('input[placeholder="Search by location"]').setValue('Berlin')

      expect(renderedTitles(wrapper)).toEqual(['Frontend Engineer'])
    })

    it('produces disjoint, exhaustive Applied / Not applied sets over the same job list', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('select').setValue('applied')
      const applied = renderedTitles(wrapper)

      await wrapper.find('select').setValue('not_applied')
      const notApplied = renderedTitles(wrapper)

      expect(applied).toEqual(['Backend Engineer'])
      expect(applied.some((title) => notApplied.includes(title))).toBe(false)
      expect([...applied, ...notApplied].sort()).toEqual(jobs.map((job) => job.title).sort())
    })

    it('drops the applied control and stops applying a stale applied filter after a mid-session role switch', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.find('select').setValue('applied')
      expect(renderedTitles(wrapper)).toEqual(['Backend Engineer'])

      // Same mounted page, user is now a recruiter (e.g. re-auth into another account).
      mockUser.value = { ...mockUser.value, role: 'recruiter' }
      await flushPromises()

      expect(wrapper.find('select').exists()).toBe(false)
      // The stale 'applied' value must not keep hiding jobs from a role that has no such concept.
      expect(renderedTitles(wrapper)).toHaveLength(4)
    })
  })
})
