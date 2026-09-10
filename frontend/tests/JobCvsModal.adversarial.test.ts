import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// QA adversarial pass on the best-match rating (.plan/021-2026-08-11-best-match-star.md, widened
// by .plan/029 and then changed post-QA on 2026-09-07 from a binary top-5 star to a graduated
// 5/4/3/2/1 rating). JobCvsModal.test.ts covers the happy paths (the scale itself, ties, fewer
// than five scored, the filter invariant, candidate, failed fetch); this file only covers what
// those fixtures cannot fail on: a zero score competing with an unscored CV, duplicate rows for
// one resume, rows in the response that are not in the attached list, and negative scores.

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
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
  name: 'Amy Admin',
  email: 'amy@example.com',
  role: 'admin',
  org_id: 'demo-org',
  has_profile_image: false
})

vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mockUser })
}))

import JobCvsModal from '../src/components/JobCvsModal.vue'
import {
  createMatch,
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

function resume(id: string, name: string) {
  return {
    id,
    candidate_id: `candidate-${id}`,
    candidate_name: name,
    candidate_email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    file_name: `${id}.pdf`,
    mime_type: 'application/pdf',
    content: 'text',
    created_at: '2026-07-03T00:00:00.000Z',
    jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
    attached_at: '2026-07-04T00:00:00.000Z',
    owner_user_id: 'u2',
    // .plan/029. These tests are about the star, not the filters, so every fixture sits in the
    // same band with the same skills — the filter row is present but inert.
    years_experience: 4,
    skills: ['typescript']
  }
}

const jane = resume('resume-1', 'Jane Doe')
const john = resume('resume-2', 'John Smith')

function match(resumeId: string, score: number) {
  return {
    id: `match-${resumeId}-${score}`,
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

// Every rendered row as [candidate name, star count]. Counting the star elements rather than
// testing for presence is what makes these adversarial: under the graduated scale a bug that
// awards the right CVs the wrong RANK would pass a presence check.
function starCounts(wrapper: ReturnType<typeof mountModal>) {
  return wrapper
    .findAll('li')
    .map((row) => [row.find('p.font-semibold').text(), row.findAll('.fill-warning').length] as [string, number])
}

describe('JobCvsModal graduated best-match rating — adversarial', () => {
  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Amy Admin',
      email: 'amy@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listJobResumes).mockReset().mockResolvedValue([jane, john])
    vi.mocked(listResumes).mockReset().mockResolvedValue(pageOf([jane, john]))
    vi.mocked(getMatchForPair).mockReset().mockResolvedValue(null)
    vi.mocked(listLatestMatchesForJob).mockReset().mockResolvedValue([])
    vi.mocked(createMatch).mockReset()
    vi.mocked(getMatch).mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
  })

  // An unscored CV is absent from the response, not a score-0 entry. If the
  // component ever defaulted a missing score to 0, the unscored row would enter
  // the ranking and take a star count it has not earned.
  it('rates only the scored CV when the only scored CV scored zero', async () => {
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([match(jane.id, 0)])
    const wrapper = mountModal()
    await flushPromises()

    expect(starCounts(wrapper)).toEqual([
      ['Jane Doe', 5],
      ['John Smith', 0]
    ])
  })

  it('rates nobody when every attached CV is unscored, even though zero is a valid score', async () => {
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([])
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(starCounts(wrapper)).toEqual([
      ['Jane Doe', 0],
      ['John Smith', 0]
    ])
  })

  // Documents the component's tolerance if the backend's one-row-per-resume
  // guarantee were ever violated: the higher of the duplicate rows wins, and the
  // duplicate does not let one CV occupy two of the five ranks.
  it('survives duplicate rows for the same resume without rating the wrong CV', async () => {
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([
      match(jane.id, 30),
      match(jane.id, 90),
      match(john.id, 55)
    ])
    const wrapper = mountModal()
    await flushPromises()

    // Jane is counted once, at her HIGHER score (90 > 55), so she outranks John. Taking the
    // first or last duplicate row instead of the max would put her second on 30.
    expect(starCounts(wrapper)).toEqual([
      ['Jane Doe', 5],
      ['John Smith', 4]
    ])
  })

  // The sharp version of the above, over a full field of six. The duplicate row is deliberately
  // Candidate 1's WORST score and collides with Candidate 6's, so a component that took the
  // last (or lowest) row rather than the max would drop Candidate 1 from the 5-star tier all
  // the way to sharing Candidate 6's, shifting every other CV up a tier. A duplicate a hair
  // below the real score would NOT catch that under dense ranking — it stays the top distinct
  // value either way — so the gap here is the whole point of the fixture.
  it('takes each resume\'s best score, so a duplicate row cannot shift the tiers', async () => {
    const six = Array.from({ length: 6 }, (_, index) => resume(`resume-${index + 1}`, `Candidate ${index + 1}`))
    vi.mocked(listJobResumes).mockResolvedValue(six)
    vi.mocked(listResumes).mockResolvedValue(pageOf(six))
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([
      match('resume-1', 95),
      // The duplicate: same resume, far below its real score, tied with the last-placed CV.
      match('resume-1', 44),
      match('resume-2', 88),
      match('resume-3', 77),
      match('resume-4', 66),
      match('resume-5', 55),
      match('resume-6', 44)
    ])
    const wrapper = mountModal()
    await flushPromises()

    expect(starCounts(wrapper)).toEqual([
      ['Candidate 1', 5],
      ['Candidate 2', 4],
      ['Candidate 3', 3],
      ['Candidate 4', 2],
      ['Candidate 5', 1],
      ['Candidate 6', 0]
    ])
  })

  // A match row for a resume that is not in the attached list (a stale row, or one detached
  // between the two requests) must not paint stars on an unrelated row. It does consume a rank
  // — it legitimately outscores both attached CVs — which pushes the attached rows down the
  // scale rather than landing a rating somewhere wrong.
  it('never rates a row for a match whose resume is not in the attached list', async () => {
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([
      match('resume-detached', 99),
      match(jane.id, 70),
      match(john.id, 40)
    ])
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(starCounts(wrapper)).toEqual([
      ['Jane Doe', 4],
      ['John Smith', 3]
    ])
  })

  // Negative scores are not something the API should ever send, but they must not invert the
  // ranking or produce a negative number of star elements.
  it('ranks negative scores below positive ones without rendering negative stars', async () => {
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([match(jane.id, -10), match(john.id, 5)])
    const wrapper = mountModal()
    await flushPromises()

    expect(starCounts(wrapper)).toEqual([
      ['Jane Doe', 4],
      ['John Smith', 5]
    ])
  })

  // The role gate must key on the role, not on "did the request return data" —
  // a candidate with a populated response still gets no rating and no request.
  it('issues no request and renders no rating for a candidate who owns the top-scoring CV', async () => {
    mockUser.value = { ...mockUser.value, id: 'u2', role: 'candidate' }
    vi.mocked(listJobResumes).mockResolvedValue([{ ...jane, owner_user_id: 'u2' }, john])
    vi.mocked(listLatestMatchesForJob).mockResolvedValue([match(jane.id, 100), match(john.id, 20)])
    const wrapper = mountModal()
    await flushPromises()

    expect(listLatestMatchesForJob).not.toHaveBeenCalled()
    expect(starCounts(wrapper)).toEqual([
      ['Jane Doe', 0],
      ['John Smith', 0]
    ])
    expect(wrapper.text()).toContain('Jane Doe')
  })

  it('renders no rating for an unauthenticated/roleless user and issues no request', async () => {
    mockUser.value = {}
    const wrapper = mountModal()
    await flushPromises()

    expect(listLatestMatchesForJob).not.toHaveBeenCalled()
    expect(starCounts(wrapper).every(([, count]) => count === 0)).toBe(true)
  })
})