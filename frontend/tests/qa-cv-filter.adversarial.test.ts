import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// QA adversarial pass on .plan/029-2026-09-07-cv-recruiter-filter.md.
//
// JobCvsModal.test.ts and JobCvsModal.adversarial.test.ts already cover the level tabs, the
// skills AND, the picker's option source, the filtered-empty state, and the star-vs-LEVEL-filter
// invariant. This file deliberately only probes what those cannot fail on:
//
//   1. The Open Question 3 invariant under the SKILLS filter and under a long toggle SEQUENCE —
//      the existing regression tests only click level tabs once.
//   2. A filtered-out CV's duplicate match row still shaping the cutoff for the visible rows.
//   3. Malformed `years_experience` values a stale or broken API could emit (a string, NaN,
//      a negative) reaching the level filter.
//   4. The `availableSkills` watcher that prunes a selected skill once the last CV carrying it
//      is detached — otherwise the list strands on a permanently-empty filter.
//   5. Volume: the 30-skill cap and a max-length skill string in the picker.

vi.mock('../src/lib/api', async (importOriginal) => ({
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  listJobResumes: vi.fn(),
  listResumes: vi.fn(),
  attachResumeToJob: vi.fn(),
  detachResumeFromJob: vi.fn(),
  getMatchForPair: vi.fn(),
  listLatestMatchesForJob: vi.fn(),
  createMatch: vi.fn(),
  getMatch: vi.fn(),
  getResumeFileUrl: vi.fn((id: string) => `http://localhost:3001/api/resume/${id}/file`)
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

const mockUser = ref<Record<string, unknown>>({
  id: 'u1',
  name: 'Rita Recruiter',
  email: 'rita@example.com',
  role: 'recruiter',
  org_id: 'demo-org',
  has_profile_image: false
})

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import JobCvsModal from '../src/components/JobCvsModal.vue'
import {
  createMatch,
  detachResumeFromJob,
  getMatch,
  getMatchForPair,
  listJobResumes,
  listLatestMatchesForJob,
  listResumes
} from '../src/lib/api'

const job = {
  id: 'job-1',
  org_id: 'demo-org',
  title: 'Backend Engineer',
  description: 'Node and TypeScript',
  location: 'Berlin, Germany',
  created_at: '2026-07-01T00:00:00.000Z'
}

// `years` is deliberately typed loose: several probes below feed it values the API contract
// forbids (a string, NaN, a negative) to prove the component treats them as unclassified
// rather than banding them or throwing.
function cv(id: string, name: string, years: unknown, skills: string[]) {
  return {
    id,
    candidate_id: `candidate-${id}`,
    candidate_name: name,
    candidate_email: `${id}@example.com`,
    file_name: `${id}.pdf`,
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-03T00:00:00.000Z',
    jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
    attached_at: '2026-07-04T00:00:00.000Z',
    owner_user_id: 'u2',
    years_experience: years as number | null,
    skills
  }
}

function match(resumeId: string, score: number, suffix = '') {
  return {
    id: `match-${resumeId}${suffix}`,
    resume_id: resumeId,
    job_id: 'job-1',
    score,
    explanation: `Scored ${score}`,
    created_at: '2026-07-06T00:00:00.000Z'
  }
}

function mountModal() {
  return mount(JobCvsModal, {
    props: { job },
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

function visibleNames(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll('li').map((row) => row.find('p.font-semibold').text())
}

// Updated 2026-09-07 for the graduated 5/4/3/2/1 rating that replaced the binary top-5 star.
// [candidate name, star count] for every rendered row, an unrated row reporting 0.
function starCounts(wrapper: ReturnType<typeof mountModal>) {
  return wrapper
    .findAll('li')
    .map((row) => [row.find('p.font-semibold').text(), row.findAll('.fill-warning').length] as [string, number])
}

// The rows carrying any rating at all. Kept as its own helper because most of the invariants
// below are about WHICH CVs are rated; the ones that also care about rank assert on starCounts.
function starredNames(wrapper: ReturnType<typeof mountModal>) {
  return starCounts(wrapper)
    .filter(([, count]) => count > 0)
    .map(([name]) => name)
}

function skillChipLabels(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll('[aria-pressed]').map((chip) => chip.text())
}

async function selectLevel(wrapper: ReturnType<typeof mountModal>, label: string) {
  const tab = wrapper.findAll('[role="tab"]').find((option) => option.text() === label)
  await tab?.trigger('click')
  await flushPromises()
}

async function toggleSkill(wrapper: ReturnType<typeof mountModal>, label: string) {
  const chip = wrapper.findAll('[aria-pressed]').find((option) => option.text() === label)
  await chip?.trigger('click')
  await flushPromises()
}

function useAttached(resumes: ReturnType<typeof cv>[]) {
  vi.mocked(listJobResumes).mockResolvedValue(resumes)
  vi.mocked(listResumes).mockResolvedValue(pageOf(resumes))
}

beforeEach(() => {
  mockUser.value = {
    id: 'u1',
    name: 'Rita Recruiter',
    email: 'rita@example.com',
    role: 'recruiter',
    org_id: 'demo-org',
    has_profile_image: false
  }
  vi.mocked(listJobResumes).mockReset().mockResolvedValue([])
  vi.mocked(listResumes).mockReset().mockResolvedValue(pageOf([]))
  vi.mocked(detachResumeFromJob).mockReset().mockResolvedValue(undefined)
  vi.mocked(getMatchForPair).mockReset().mockResolvedValue(null)
  vi.mocked(listLatestMatchesForJob).mockReset().mockResolvedValue([])
  vi.mocked(createMatch).mockReset()
  vi.mocked(getMatch).mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Eight CVs spanning all three bands plus one unclassified, with strictly descending scores, so
// the global top five is unambiguous and every band contains both starred and unstarred rows.
// Global top 5 = Senior A (95), Senior B (90), Junior A (85), Junior B (80), Mid A (75).
function mixedField() {
  useAttached([
    cv('r1', 'Senior A', 10, ['react', 'typescript']),
    cv('r2', 'Senior B', 8, ['react']),
    cv('r3', 'Junior A', 1, ['react', 'typescript']),
    cv('r4', 'Junior B', 2, ['typescript']),
    cv('r5', 'Mid A', 4, ['react', 'typescript']),
    cv('r6', 'Mid B', 5, ['react']),
    cv('r7', 'Junior C', 0, ['react', 'typescript']),
    cv('r8', 'Unclassified', null, ['react'])
  ])
  vi.mocked(listLatestMatchesForJob).mockResolvedValue([
    match('r1', 95),
    match('r2', 90),
    match('r3', 85),
    match('r4', 80),
    match('r5', 75),
    match('r6', 70),
    match('r7', 65),
    match('r8', 60)
  ])
}

describe('QA — the graduated rating is invariant under the skills filter (.plan/029 Open Question 3)', () => {
  it('does not promote the filtered set\'s new top row to a star', async () => {
    mixedField()
    const wrapper = mountModal()
    await flushPromises()

    expect(starCounts(wrapper)).toEqual([
      ['Senior A', 5],
      ['Senior B', 4],
      ['Junior A', 3],
      ['Junior B', 2],
      ['Mid A', 1],
      ['Mid B', 0],
      ['Junior C', 0],
      ['Unclassified', 0]
    ])

    // 'react' + 'typescript' leaves four rows; the best-scoring unrated survivor is Junior C
    // (65), which would light up if the ranking were recomputed inside the filtered set.
    await toggleSkill(wrapper, 'React')
    await toggleSkill(wrapper, 'Typescript')

    expect(visibleNames(wrapper)).toEqual(['Senior A', 'Junior A', 'Mid A', 'Junior C'])
    // Every survivor keeps its GLOBAL rank — Junior A stays on 3 rather than being promoted to
    // 4 as the filtered set's second-best, and Mid A stays on 1 rather than 3.
    expect(starCounts(wrapper)).toEqual([
      ['Senior A', 5],
      ['Junior A', 3],
      ['Mid A', 1],
      ['Junior C', 0]
    ])
  })

  // The sharpest form of the invariant: a filtered view whose HIGHEST-scoring row carries no
  // star at all. Recomputing per filter could not produce this, so it fails loudly if anyone
  // "simplifies" bestMatchResumeIds to rank over filteredResumes.
  it('leaves the top row of a filtered view unstarred when it is outside the global top five', async () => {
    mixedField()
    const wrapper = mountModal()
    await flushPromises()

    // Mid B (70) and Junior C (65) are the two lowest-scoring 'react' holders below the cutoff.
    await selectLevel(wrapper, 'Mid')
    await toggleSkill(wrapper, 'React')
    await toggleSkill(wrapper, 'Typescript')
    await selectLevel(wrapper, 'All')
    await toggleSkill(wrapper, 'Typescript')

    // Only 'react' now: everyone but Junior B. Narrow further to the two rows that scored
    // lowest by picking the level that isolates them.
    await selectLevel(wrapper, 'Mid')
    expect(visibleNames(wrapper)).toEqual(['Mid A', 'Mid B'])
    expect(starredNames(wrapper)).toEqual(['Mid A'])

    // And back to the full field: the same five CVs on the same five ranks.
    await selectLevel(wrapper, 'All')
    await toggleSkill(wrapper, 'React')
    expect(starredNames(wrapper)).toEqual(['Senior A', 'Senior B', 'Junior A', 'Junior B', 'Mid A'])
  })

  // The ratings must be a pure function of the scores, not of the path taken through the UI.
  it('returns the identical ratings after a long toggle sequence through every control', async () => {
    mixedField()
    const wrapper = mountModal()
    await flushPromises()

    const before = starCounts(wrapper)

    await selectLevel(wrapper, 'Junior')
    await toggleSkill(wrapper, 'React')
    await selectLevel(wrapper, 'Senior')
    await toggleSkill(wrapper, 'Typescript')
    await selectLevel(wrapper, 'Mid')
    await toggleSkill(wrapper, 'React')
    await toggleSkill(wrapper, 'Typescript')
    await selectLevel(wrapper, 'All')

    expect(visibleNames(wrapper)).toHaveLength(8)
    expect(starCounts(wrapper)).toEqual(before)
    // Guard against the assertion above passing vacuously if the rating markup ever changes
    // again: `before` must actually have contained ratings.
    expect(before.filter(([, count]) => count > 0)).toHaveLength(5)
  })

  // Clear filters must restore the list, not just the star set.
  it('restores every row and every star via Clear filters after a skills+level combination', async () => {
    mixedField()
    const wrapper = mountModal()
    await flushPromises()

    await selectLevel(wrapper, 'Senior')
    await toggleSkill(wrapper, 'Typescript')
    expect(visibleNames(wrapper)).toEqual(['Senior A'])

    const clear = wrapper.findAll('button').find((button) => button.text() === 'Clear filters')
    await clear?.trigger('click')
    await flushPromises()

    expect(visibleNames(wrapper)).toHaveLength(8)
    expect(starredNames(wrapper)).toEqual(['Senior A', 'Senior B', 'Junior A', 'Junior B', 'Mid A'])
  })
})

describe('QA — the cutoff is computed over CVs the filter has hidden', () => {
  // Six CVs; the two highest scorers are Senior and get filtered out under Junior. Their scores
  // must still set the cutoff, so only ONE of the four Juniors keeps a star. Ranking within the
  // filtered set would star all four.
  it('keeps hidden high scorers in the ranking that decides the visible rows\' stars', async () => {
    useAttached([
      cv('s1', 'Senior A', 9, ['go']),
      cv('s2', 'Senior B', 9, ['go']),
      cv('s3', 'Senior C', 9, ['go']),
      cv('s4', 'Senior D', 9, ['go']),
      cv('j1', 'Junior A', 1, ['go']),
      cv('j2', 'Junior B', 1, ['go']),
      cv('j3', 'Junior C', 1, ['go'])
    ])
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([
      match('s1', 99),
      match('s2', 98),
      match('s3', 97),
      match('s4', 96),
      match('j1', 95),
      match('j2', 10),
      match('j3', 5)
    ])
    const wrapper = mountModal()
    await flushPromises()

    await selectLevel(wrapper, 'Junior')
    expect(visibleNames(wrapper)).toEqual(['Junior A', 'Junior B', 'Junior C'])
    // Junior A is the best VISIBLE row but only 5th overall, so it shows the lowest rating on
    // the scale — one star. Re-ranking inside the filter would show it five.
    expect(starCounts(wrapper)).toEqual([
      ['Junior A', 1],
      ['Junior B', 0],
      ['Junior C', 0]
    ])
  })

  // Combines the duplicate-row hazard with the filter: the duplicate belongs to a CV the filter
  // hides, so counting rows instead of distinct resumes would raise the cutoff and silently cost
  // a VISIBLE row its star.
  it('dedupes a hidden CV\'s duplicate match row before it can push a visible row off the cutoff', async () => {
    useAttached([
      cv('s1', 'Senior A', 9, ['go']),
      cv('j1', 'Junior A', 1, ['go']),
      cv('j2', 'Junior B', 1, ['go']),
      cv('j3', 'Junior C', 1, ['go']),
      cv('j4', 'Junior D', 1, ['go']),
      cv('j5', 'Junior E', 1, ['go'])
    ])
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([
      // The duplicate is Senior A's WORST score, colliding with Junior D's tier. Taking the last
      // (or lowest) row rather than the max would drop Senior A out of the top tier and pull
      // every Junior up one, so this fixture fails loudly on a broken dedup. A duplicate just
      // below 99 would not: under dense ranking it stays the top distinct value either way.
      match('s1', 99),
      match('s1', 50, '-dup'),
      match('j1', 80),
      match('j2', 70),
      match('j3', 60),
      match('j4', 50),
      match('j5', 40)
    ])
    const wrapper = mountModal()
    await flushPromises()

    // Counting rows rather than distinct resumes would give Senior A ranks 5 AND 4, shifting
    // every Junior down one star and costing Junior D its only one.
    expect(starCounts(wrapper)).toEqual([
      ['Senior A', 5],
      ['Junior A', 4],
      ['Junior B', 3],
      ['Junior C', 2],
      ['Junior D', 1],
      ['Junior E', 0]
    ])

    await selectLevel(wrapper, 'Junior')
    expect(starCounts(wrapper)).toEqual([
      ['Junior A', 4],
      ['Junior B', 3],
      ['Junior C', 2],
      ['Junior D', 1],
      ['Junior E', 0]
    ])
  })
})

describe('QA — malformed years_experience never lands in a band', () => {
  // The API contract says nullable integer. A stale cached response, a schema regression, or a
  // JSON-string year must read as unclassified — never Junior, and never a thrown render.
  const hostile: [string, unknown][] = [
    ['a JSON string', '5'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative number', -3],
    ['undefined (field absent)', undefined]
  ]

  for (const [label, years] of hostile) {
    it(`treats ${label} as unclassified, showing it only under All`, async () => {
      useAttached([cv('r1', 'Junior Real', 1, ['go']), cv('r2', 'Hostile', years, ['go'])])
      const wrapper = mountModal()
      await flushPromises()

      expect(visibleNames(wrapper)).toEqual(['Junior Real', 'Hostile'])

      await selectLevel(wrapper, 'Junior')
      expect(visibleNames(wrapper)).toEqual(['Junior Real'])

      await selectLevel(wrapper, 'Mid')
      expect(wrapper.text()).toContain('No CVs match these filters')

      await selectLevel(wrapper, 'Senior')
      expect(wrapper.text()).toContain('No CVs match these filters')
    })
  }

  // A CV whose `skills` is null rather than [] (the shape a pre-.plan/029 cached response has)
  // must not take the dialog down or match a skill filter.
  it('survives a null skills array without offering or matching it', async () => {
    useAttached([
      cv('r1', 'Normal', 4, ['go']),
      cv('r2', 'Legacy', 4, null as unknown as string[])
    ])
    const wrapper = mountModal()
    await flushPromises()

    expect(visibleNames(wrapper)).toEqual(['Normal', 'Legacy'])
    expect(skillChipLabels(wrapper)).toEqual(['Go'])

    await toggleSkill(wrapper, 'Go')
    expect(visibleNames(wrapper)).toEqual(['Normal'])
  })
})

describe('QA — the skills picker and its selection stay in agreement', () => {
  // The watcher at JobCvsModal.vue:157. Detaching the last CV carrying a selected skill removes
  // its chip; without the prune the list would strand on a filter with no chip left to untoggle.
  it('drops a selected skill once the last CV carrying it is detached', async () => {
    mockUser.value = { ...mockUser.value, role: 'admin', id: 'u2' }
    const keep = cv('r1', 'Keeper', 4, ['go'])
    const only = cv('r2', 'Only Rust', 4, ['rust'])
    useAttached([keep, only])
    const wrapper = mountModal()
    await flushPromises()

    await toggleSkill(wrapper, 'Rust')
    expect(visibleNames(wrapper)).toEqual(['Only Rust'])

    // Detach re-loads the list without the rust CV.
    vi.mocked(listJobResumes).mockResolvedValue([keep])
    vi.mocked(listResumes).mockResolvedValue(pageOf([keep]))
    const detach = wrapper.findAll('button').find((button) => button.text().includes('Detach'))
    await detach?.trigger('click')
    await flushPromises()
    const confirm = wrapper.findAll('button').find((button) => button.text().includes('Confirm detach'))
    await confirm?.trigger('click')
    await flushPromises()

    expect(skillChipLabels(wrapper)).toEqual(['Go'])
    // The list is usable again rather than stuck on "No CVs match these filters".
    expect(visibleNames(wrapper)).toEqual(['Keeper'])
    expect(wrapper.text()).not.toContain('No CVs match these filters')
  })

  // Selecting three skills must require all three, not any of them.
  it('ANDs three selected skills rather than ORing them', async () => {
    useAttached([
      cv('r1', 'All Three', 4, ['go', 'react', 'sql']),
      cv('r2', 'Two Of Three', 4, ['go', 'react']),
      cv('r3', 'One Of Three', 4, ['sql'])
    ])
    const wrapper = mountModal()
    await flushPromises()

    await toggleSkill(wrapper, 'Go')
    await toggleSkill(wrapper, 'React')
    await toggleSkill(wrapper, 'Sql')

    expect(visibleNames(wrapper)).toEqual(['All Three'])
  })

  // Order of selection must not change the result set.
  it('produces the same rows whichever order two skills are selected in', async () => {
    useAttached([
      cv('r1', 'Both', 4, ['go', 'react']),
      cv('r2', 'Go Only', 4, ['go']),
      cv('r3', 'React Only', 4, ['react'])
    ])
    const wrapper = mountModal()
    await flushPromises()

    await toggleSkill(wrapper, 'Go')
    await toggleSkill(wrapper, 'React')
    const forward = visibleNames(wrapper)

    await toggleSkill(wrapper, 'Go')
    await toggleSkill(wrapper, 'React')
    await toggleSkill(wrapper, 'React')
    await toggleSkill(wrapper, 'Go')

    expect(visibleNames(wrapper)).toEqual(forward)
    expect(forward).toEqual(['Both'])
  })

  // Open Question 5's caps are a backend guarantee; this pins that the picker renders a CV at
  // the cap without dropping or truncating chips.
  it('renders all 30 skills of a capped CV, including a max-length one', async () => {
    const maxLength = 'a'.repeat(50)
    const skills = [maxLength, ...Array.from({ length: 29 }, (_, index) => `skill-${index}`)]
    useAttached([cv('r1', 'Capped', 4, skills)])
    const wrapper = mountModal()
    await flushPromises()

    expect(skillChipLabels(wrapper)).toHaveLength(30)
    expect(skillChipLabels(wrapper)).toContain('A'.repeat(1) + 'a'.repeat(49))
  })

  // Documents the contract dependency the Frontend Agent flagged: matching is exact on the
  // lowercase strings the backend promises. If the backend ever emitted mixed case, the picker
  // would show two chips for one skill and each would match only half the CVs. This test is the
  // canary for that contract, not an endorsement of the behavior.
  it('treats an unnormalized duplicate as two distinct skills — the backend contract is load-bearing', async () => {
    useAttached([cv('r1', 'Lower', 4, ['react']), cv('r2', 'Upper', 4, ['React'])])
    const wrapper = mountModal()
    await flushPromises()

    expect(skillChipLabels(wrapper)).toHaveLength(2)

    await toggleSkill(wrapper, 'React')
    // Both chips render as "React", so only the first is clickable by label — and it matches
    // exactly one of the two CVs, which is the failure mode to watch for end to end.
    expect(visibleNames(wrapper)).toHaveLength(1)
  })
})

describe('QA — a candidate sees no filter row and no star', () => {
  it('renders no tablist, no chips, and no star even with scored CVs in the response', async () => {
    mockUser.value = { ...mockUser.value, role: 'candidate', id: 'u2' }
    useAttached([cv('r1', 'Own CV', 4, ['go'])])
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([match('r1', 99)])
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.findAll('[aria-pressed]')).toHaveLength(0)
    expect(starredNames(wrapper)).toEqual([])
    // The route is Admin/Recruiter-only, so the request must not even be attempted.
    expect(listLatestMatchesForJob).not.toHaveBeenCalled()
    expect(visibleNames(wrapper)).toEqual(['Own CV'])
  })
})
