import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageOf } from './helpers/page'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

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
  getResumeFileUrl: vi.fn((id: string, options?: { download?: boolean }) =>
    `http://localhost:3001/api/resume/${id}/file${options?.download ? '?download=1' : ''}`
  )
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
  attachResumeToJob,
  createMatch,
  detachResumeFromJob,
  getMatch,
  getMatchForPair,
  listJobResumes,
  listLatestMatchesForJob,
  listResumes
} from '../src/lib/api'
import { toast } from 'vue-sonner'

const job = {
  id: 'job-1',
  org_id: 'demo-org',
  title: 'Backend Engineer',
  description: 'Node and TypeScript',
  location: 'Berlin, Germany',
  created_at: '2026-07-01T00:00:00.000Z'
}

const attachedPdf = {
  id: 'resume-1',
  candidate_id: 'candidate-1',
  candidate_name: 'Jane Doe',
  candidate_email: 'jane@example.com',
  file_name: 'jane.pdf',
  mime_type: 'application/pdf',
  content: 'Five years of experience',
  created_at: '2026-07-03T00:00:00.000Z',
  jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
  attached_at: '2026-07-04T00:00:00.000Z',
  owner_user_id: 'u1',
  // .plan/029: 4 years is Mid, and the skills arrive already normalized (lowercase) from the API.
  years_experience: 4,
  skills: ['node', 'typescript']
}

// The second attached CV — a distinct owner, level, and skill set from Jane, so ownership
// gating, the level filter, and the skills filter all have two rows to tell apart.
const attachedSecondPdf = {
  id: 'resume-2',
  candidate_id: 'candidate-2',
  candidate_name: 'John Smith',
  candidate_email: 'john@example.com',
  file_name: 'john.pdf',
  mime_type: 'application/pdf',
  content: 'Nine years of experience',
  created_at: '2026-07-03T00:00:00.000Z',
  jobs: [{ id: 'job-1', title: 'Backend Engineer' }],
  attached_at: '2026-07-05T00:00:00.000Z',
  owner_user_id: 'u2',
  // 9 years is Senior. Shares 'typescript' with Jane so a multi-skill AND has something to
  // narrow, and carries 'python' that nobody else has.
  years_experience: 9,
  skills: ['python', 'typescript']
}

const unattached = {
  id: 'resume-3',
  candidate_id: 'candidate-3',
  candidate_name: 'Amy Lee',
  candidate_email: 'amy@example.com',
  file_name: 'amy.pdf',
  mime_type: 'application/pdf',
  content: 'text',
  created_at: '2026-07-02T00:00:00.000Z',
  jobs: [],
  owner_user_id: 'u1',
  // Unattached, so its 'rust' skill must never reach the picker — the options come from this
  // job's attached CVs only.
  years_experience: 1,
  skills: ['rust']
}

const existingMatch = {
  id: 'match-1',
  resume_id: 'resume-1',
  job_id: 'job-1',
  score: 82,
  explanation: 'Strong overlap in required skills.',
  created_at: '2026-07-06T00:00:00.000Z'
}

// .plan/018: the modal (and the MatchResult it renders) call the job, resume, and match stores
// instead of lib/api directly. `stubActions: false` runs the real store actions against the
// mocked lib/api — and per .plan/023 every one of those rejections travels back out to this
// modal, which is what raises the toast (attach, detach, the preview match lookup, and the
// best-match score fetch alike).
function mountModal() {
  return mount(JobCvsModal, {
    props: { job },
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

// .plan/029 filter-row helpers. The candidate name of every attached-CV row currently rendered —
// i.e. the rows that survived the active filter.
function visibleNames(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll('li').map((row) => row.find('p.font-semibold').text())
}

async function selectLevel(wrapper: ReturnType<typeof mountModal>, label: string) {
  const tab = wrapper.findAll('[role="tab"]').find((option) => option.text() === label)
  await tab?.trigger('click')
  await flushPromises()
}

async function toggleSkill(wrapper: ReturnType<typeof mountModal>, label: string) {
  const chip = wrapper
    .findAll('[aria-pressed]')
    .find((option) => option.text() === label)
  await chip?.trigger('click')
  await flushPromises()
}

function skillChipLabels(wrapper: ReturnType<typeof mountModal>) {
  return wrapper.findAll('[aria-pressed]').map((chip) => chip.text())
}

describe('JobCvsModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockUser.value = {
      id: 'u1',
      name: 'Amy Admin',
      email: 'amy@example.com',
      role: 'admin',
      org_id: 'demo-org',
      has_profile_image: false
    }
    vi.mocked(listJobResumes).mockReset().mockResolvedValue([attachedPdf, attachedSecondPdf])
    vi.mocked(listResumes)
      .mockReset()
      .mockResolvedValue(pageOf([attachedPdf, attachedSecondPdf, unattached]))
    vi.mocked(attachResumeToJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(detachResumeFromJob).mockReset().mockResolvedValue(undefined)
    vi.mocked(getMatchForPair).mockReset().mockResolvedValue(null)
    vi.mocked(listLatestMatchesForJob).mockReset().mockResolvedValue([])
    vi.mocked(createMatch).mockReset().mockResolvedValue(existingMatch)
    vi.mocked(getMatch).mockReset().mockResolvedValue(existingMatch)
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the CVs attached to the job with file name and attached date', async () => {
    const wrapper = mountModal()
    await flushPromises()

    expect(listJobResumes).toHaveBeenCalledWith('job-1')
    expect(wrapper.text()).toContain('Jane Doe')
    expect(wrapper.text()).toContain('jane.pdf')
    expect(wrapper.text()).toContain('John Smith')
    expect(wrapper.text()).toContain('john.pdf')
  })

  it('only offers unattached CVs in the attach control', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const options = wrapper.findAll('option')
    const optionText = options.map((option) => option.text()).join(' | ')
    expect(optionText).toContain('Amy Lee')
    expect(optionText).not.toContain('Jane Doe')
  })

  it('attaches a selected CV and refreshes the list', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.find('select').setValue('resume-3')
    const attachButton = wrapper.findAll('button').find((btn) => btn.text().includes('Attach CV'))
    await attachButton?.trigger('click')
    await flushPromises()

    expect(attachResumeToJob).toHaveBeenCalledWith('job-1', 'resume-3')
    expect(toast.success).toHaveBeenCalledWith('CV attached')
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  it('requires a confirm step before detaching, naming the match impact', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const detachButton = wrapper.findAll('button').find((btn) => btn.text().includes('Detach'))
    await detachButton?.trigger('click')

    expect(detachResumeFromJob).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This will also delete its match results for this job.')

    const confirmButton = wrapper.findAll('button').find((btn) => btn.text().includes('Confirm detach'))
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(detachResumeFromJob).toHaveBeenCalledWith('job-1', 'resume-1')
    expect(toast.success).toHaveBeenCalledWith('CV detached')
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  // .plan/023 moved these toasts back out of the stores and into the modal's own catch blocks;
  // mounting with a real testing Pinia keeps the failure paths exercised end to end.
  it('surfaces a failed attach as a toast, without emitting changed', async () => {
    vi.mocked(attachResumeToJob).mockRejectedValue(new Error('Already attached'))
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.find('select').setValue('resume-3')
    const attachButton = wrapper.findAll('button').find((btn) => btn.text().includes('Attach CV'))
    await attachButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Already attached')
    expect(toast.success).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeFalsy()
  })

  it('surfaces a failed detach as a toast, keeping the CV attached and the confirm step open', async () => {
    vi.mocked(detachResumeFromJob).mockRejectedValue(new Error('Forbidden'))
    const wrapper = mountModal()
    await flushPromises()

    const detachButton = wrapper.findAll('button').find((btn) => btn.text().includes('Detach'))
    await detachButton?.trigger('click')
    const confirmButton = wrapper.findAll('button').find((btn) => btn.text().includes('Confirm detach'))
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Forbidden')
    expect(wrapper.emitted('changed')).toBeFalsy()
    expect(wrapper.text()).toContain('This will also delete its match results for this job.')
  })

  it('surfaces a failed match lookup as a toast and still finishes the preview', async () => {
    vi.mocked(getMatchForPair).mockRejectedValue(new Error('Job not found'))
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
    await row?.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Job not found')
    // The lookup spinner must not be left hanging when the lookup rejects.
    expect(wrapper.text()).not.toContain('Checking for an existing match…')
  })

  it('renders a download link pointing at the file endpoint with download=1', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const downloadLink = wrapper.findAll('a').find((a) => a.text().includes('Download'))
    expect(downloadLink?.attributes('href')).toBe('http://localhost:3001/api/resume/resume-1/file?download=1')
  })

  it('renders the attached-CVs list without a preview dialog until a CV is selected', async () => {
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.findAll('.fixed.inset-0')).toHaveLength(1)
  })

  it('shows an inline PDF preview via iframe on click, opening a stacked dialog on top of the parent, and looks up a match', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
    await row?.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/resume/resume-1/file', {
      method: 'HEAD',
      credentials: 'include'
    })
    expect(getMatchForPair).toHaveBeenCalledWith('job-1', 'resume-1')

    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)
    expect(iframe.attributes('src')).toBe('http://localhost:3001/api/resume/resume-1/file')

    expect(wrapper.findAll('.fixed.inset-0')).toHaveLength(2)
  })

  // Legacy data (.plan/030): CVs are PDF-only now, but rows uploaded as DOCX before the change
  // are still in the database — no migration was in scope. The route that used to render them is
  // gone, so such a row must degrade to the same "couldn't be loaded" message a broken PDF shows,
  // and must NOT reach for the removed HTML-preview endpoint (which would 404).
  it('shows the file-load failure message for a legacy non-PDF CV without requesting a preview', async () => {
    const legacyDocx = {
      ...attachedSecondPdf,
      file_name: 'john.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    vi.mocked(listJobResumes).mockResolvedValue([legacyDocx])
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
    await row?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain("This CV's file couldn't be loaded — replace it from the CVs page.")
    expect(wrapper.find('iframe').exists()).toBe(false)
    // No HTML-preview call, and no HEAD check either — nothing is fetched for a non-PDF CV.
    expect(fetchMock).not.toHaveBeenCalled()
    // The status resolves synchronously, so the spinner must never be left behind.
    expect(wrapper.text()).not.toContain('Checking file…')
  })

  it('shows an inline failure message instead of a broken iframe when the file HEAD check fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
    await row?.trigger('click')
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain("This CV's file couldn't be loaded — replace it from the CVs page.")
  })

  it('renders MatchResult with the found match id when getMatchForPair returns an existing match', async () => {
    vi.mocked(getMatchForPair).mockResolvedValue(existingMatch)
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
    await row?.trigger('click')
    await flushPromises()

    expect(getMatch).toHaveBeenCalledWith('match-1')
    expect(createMatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('82')
    expect(wrapper.text()).toContain('Strong overlap in required skills.')
  })

  it('lets MatchResult auto-create a match via resumeId/jobId when no existing match is found', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
    await row?.trigger('click')
    await flushPromises()

    expect(createMatch).toHaveBeenCalledWith({ resume_id: 'resume-1', job_id: 'job-1' })
    expect(getMatch).not.toHaveBeenCalled()
  })

  it('closes the preview via the preview dialog close button, keeping the parent dialog open', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
    await row?.trigger('click')
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(true)

    await wrapper.find('button[aria-label="Close preview"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.findAll('.fixed.inset-0')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('emits close when the modal close button is clicked', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.find('button[aria-label="Close"]').trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows an empty state when the job has no attached CVs', async () => {
    vi.mocked(listJobResumes).mockResolvedValue([])
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.text()).toContain('No CVs attached yet')
  })

  it('shows an error message when loading fails', async () => {
    vi.mocked(listJobResumes).mockRejectedValue(new Error('Failed to load CVs for this job'))
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load CVs for this job')
  })

  describe('candidate role (ownership-scoped, .plan/009-2026-08-08-candidate-cv-ownership-scoping.md)', () => {
    beforeEach(() => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
    })

    it('shows the attach control and can attach/detach a CV it owns', async () => {
      const wrapper = mountModal()
      await flushPromises()

      expect(wrapper.find('select').exists()).toBe(true)
      expect(wrapper.findAll('button').some((btn) => btn.text().includes('Attach CV'))).toBe(true)

      const janeRow = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
      expect(janeRow?.findAll('button').some((btn) => btn.text().includes('Detach'))).toBe(true)
    })

    it('only offers CVs it owns in the attach dropdown, excluding unattached CVs owned by other candidates', async () => {
      const otherUnattached = { ...unattached, id: 'resume-4', candidate_name: 'Other Owner', owner_user_id: 'u2' }
      vi.mocked(listResumes).mockResolvedValue(pageOf([attachedPdf, attachedSecondPdf, unattached, otherUnattached]))
      const wrapper = mountModal()
      await flushPromises()

      const options = wrapper.findAll('option')
      const optionText = options.map((option) => option.text()).join(' | ')
      expect(optionText).toContain('Amy Lee')
      expect(optionText).not.toContain('Other Owner')
    })

    it('hides the Detach button on a row for a CV owned by another candidate', async () => {
      const wrapper = mountModal()
      await flushPromises()

      const johnRow = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
      expect(johnRow?.findAll('button').some((btn) => btn.text().includes('Detach'))).toBe(false)
    })

    it('shows the owner-only message instead of MatchResult when previewing a CV it does not own, without looking up a match', async () => {
      const wrapper = mountModal()
      await flushPromises()

      const johnRow = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
      await johnRow?.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain("Match result is only visible to the CV's owner.")
      expect(getMatchForPair).not.toHaveBeenCalled()
      expect(createMatch).not.toHaveBeenCalled()
      expect(getMatch).not.toHaveBeenCalled()
      expect(wrapper.findComponent({ name: 'MatchResult' }).exists()).toBe(false)
    })

    it('still renders MatchResult when previewing a CV it owns', async () => {
      const wrapper = mountModal()
      await flushPromises()

      const janeRow = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
      await janeRow?.trigger('click')
      await flushPromises()

      expect(getMatchForPair).toHaveBeenCalledWith('job-1', 'resume-1')
      expect(createMatch).toHaveBeenCalledWith({ resume_id: 'resume-1', job_id: 'job-1' })
      expect(wrapper.text()).not.toContain("Match result is only visible to the CV's owner.")
    })

    it('renders only its own resume when listJobResumes returns just the candidate\'s CV, matching the backend-filtered response (.plan/011-2026-08-09-candidate-job-cv-visibility.md)', async () => {
      vi.mocked(listJobResumes).mockResolvedValue([attachedPdf])
      const wrapper = mountModal()
      await flushPromises()

      expect(wrapper.text()).toContain('Jane Doe')
      expect(wrapper.text()).not.toContain('John Smith')
      expect(wrapper.findAll('li')).toHaveLength(1)
    })
  })

  it('renders MatchResult for a recruiter previewing a CV owned by a candidate', async () => {
    mockUser.value = { ...mockUser.value, role: 'recruiter' }
    const wrapper = mountModal()
    await flushPromises()

    const johnRow = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
    await johnRow?.trigger('click')
    await flushPromises()

    expect(getMatchForPair).toHaveBeenCalledWith('job-1', 'resume-2')
    expect(wrapper.text()).not.toContain("Match result is only visible to the CV's owner.")
  })

  it('lets an admin detach a CV even when owner_user_id belongs to a different candidate', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const johnRow = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
    expect(johnRow?.findAll('button').some((btn) => btn.text().includes('Detach'))).toBe(true)
  })

  // Card entrance animation (.plan/014 item 2). jsdom neither runs CSS animations nor resolves
  // stylesheets, so these assert the class and the bound delay the component produces — the
  // visual check is manual, per the plan's Risks section.
  describe('entrance animation', () => {
    function animationDelays(wrapper: ReturnType<typeof mount>) {
      return wrapper.findAll('li').map((card) => {
        const matched = /animation-delay:\s*([\d.]+)ms/.exec(card.attributes('style') ?? '')
        return matched ? Number(matched[1]) : null
      })
    }

    it('gives every attached-CV card the entrance class and a stagger delay that grows with index', async () => {
      const wrapper = mountModal()
      await flushPromises()

      const cards = wrapper.findAll('li')
      expect(cards).toHaveLength(2)
      for (const card of cards) {
        expect(card.classes()).toContain('card-enter')
      }

      const delays = animationDelays(wrapper)
      expect(delays[0]).toBe(0)
      expect(delays[1]).toBeGreaterThan(delays[0]!)
    })

    it('caps the stagger delay so a long attached list does not leave its last cards waiting', async () => {
      const manyAttached = Array.from({ length: 12 }, (_, index) => ({
        ...attachedPdf,
        id: `resume-many-${index}`,
        candidate_name: `Candidate ${index}`
      }))
      vi.mocked(listJobResumes).mockResolvedValue(manyAttached)
      const wrapper = mountModal()
      await flushPromises()

      const delays = animationDelays(wrapper)
      expect(delays).toHaveLength(manyAttached.length)

      // Monotonically non-decreasing, and flat once the cap is reached.
      for (let index = 1; index < delays.length; index += 1) {
        expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]!)
      }
      expect(delays.at(-1)).toBe(delays[8])
      expect(delays.at(-1)).toBeLessThanOrEqual(500)
    })

    // The entrance :style must not clobber the existing selected-row :class binding.
    it('keeps the selected-row highlight alongside the entrance class', async () => {
      const wrapper = mountModal()
      await flushPromises()

      const janeRow = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
      await janeRow?.trigger('click')
      await flushPromises()

      expect(janeRow?.classes()).toContain('card-enter')
      expect(janeRow?.classes()).toContain('border-primary')
    })
  })

  // Top-5 best-match stars (.plan/029 Open Questions 2 and 3, widening
  // .plan/021-2026-08-11-best-match-star.md's single star). jsdom resolves no stylesheets, so
  // these assert which rows carry the star element (and its --warning token classes), not a
  // rendered color — the visual check is manual, same as the entrance-animation tests above.
  // Graduated match rating (post-QA design change, 2026-09-07, superseding .plan/029 Open
  // Question 2's binary top-5): the best-scoring attached CV shows 5 stars, the 2nd-best 4, down
  // to the 5th at 1 star, and 6th-and-below show none. jsdom resolves no stylesheets, so these
  // assert how many star elements each row renders (and their --warning token classes), not a
  // rendered color — the visual check is manual, same as the entrance-animation tests above.
  describe('graduated best-match star rating', () => {
    const janeMatch = {
      id: 'match-jane',
      resume_id: 'resume-1',
      job_id: 'job-1',
      score: 91,
      explanation: 'Closest match.',
      created_at: '2026-07-06T00:00:00.000Z'
    }
    const johnMatch = {
      id: 'match-john',
      resume_id: 'resume-2',
      job_id: 'job-1',
      score: 64,
      explanation: 'Partial overlap.',
      created_at: '2026-07-06T00:00:00.000Z'
    }

    // Every rendered row as [candidate name, star count]. A row outside the top five reports 0
    // rather than being absent, so "not rated" and "not rendered" can never be confused — which
    // matters most in the filter tests below, where both are in play at once.
    function starCounts(wrapper: ReturnType<typeof mountModal>) {
      return wrapper
        .findAll('li')
        .map(
          (row) => [row.find('p.font-semibold').text(), row.findAll('.fill-warning').length] as [string, number]
        )
    }

    // One CV per score, in the order given, so rank and arrival order can be told apart.
    function scoredResumes(scores: number[]) {
      const resumes = scores.map((_, index) => ({
        ...attachedPdf,
        id: `resume-${index + 1}`,
        candidate_name: `Candidate ${index + 1}`
      }))
      const matches = scores.map((score, index) => ({
        ...janeMatch,
        id: `match-${index + 1}`,
        resume_id: `resume-${index + 1}`,
        score
      }))
      vi.mocked(listJobResumes).mockResolvedValue(resumes)
      vi.mocked(listLatestMatchesForJob).mockResolvedValue(matches)
    }

    describe('the 5/4/3/2/1 scale', () => {
      it('rates the top five of six CVs 5,4,3,2,1 and leaves the sixth unrated', async () => {
        scoredResumes([95, 88, 77, 66, 55, 44])
        const wrapper = mountModal()
        await flushPromises()

        expect(listLatestMatchesForJob).toHaveBeenCalledWith('job-1')
        expect(starCounts(wrapper)).toEqual([
          ['Candidate 1', 5],
          ['Candidate 2', 4],
          ['Candidate 3', 3],
          ['Candidate 4', 2],
          ['Candidate 5', 1],
          ['Candidate 6', 0]
        ])
      })

      it('ranks by score, not by the order the scores arrive in', async () => {
        mockUser.value = { ...mockUser.value, role: 'recruiter' }
        // Ascending, so a "first five rows win" bug would rate the weakest CVs highest.
        scoredResumes([44, 55, 66, 77, 88, 95])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Candidate 1', 0],
          ['Candidate 2', 1],
          ['Candidate 3', 2],
          ['Candidate 4', 3],
          ['Candidate 5', 4],
          ['Candidate 6', 5]
        ])
      })

      it('never rates any CV above five stars', async () => {
        scoredResumes([95, 88, 77, 66, 55, 44])
        const wrapper = mountModal()
        await flushPromises()

        for (const [, count] of starCounts(wrapper)) {
          expect(count).toBeLessThanOrEqual(5)
        }
      })

      // Five tiers is the cap, not five CVs — with ties, more than five CVs can be rated (see
      // the ties block below). What can never happen is a sixth distinct star count.
      it('uses at most five distinct star counts, however many CVs are scored', async () => {
        scoredResumes([95, 88, 77, 66, 55, 44])
        const wrapper = mountModal()
        await flushPromises()

        const awarded = new Set(starCounts(wrapper).map(([, count]) => count).filter((count) => count > 0))
        expect(awarded.size).toBeLessThanOrEqual(5)
        expect([...awarded].sort((a, b) => b - a)).toEqual([5, 4, 3, 2, 1])
      })
    })

    // Tied CVs SHARE a star count (user decision, 2026-09-07). The tiers are the top five
    // distinct SCORE VALUES — dense ranking — not the top five CV positions, so two CVs on the
    // same score always show the same number of stars.
    describe('ties (dense ranking over distinct scores)', () => {
      it('gives CVs tied at the lowest tier the same count, rating more than five CVs', async () => {
        // Candidates 5 and 6 both score 55. Distinct scores: 95, 88, 77, 66, 55 — five tiers.
        scoredResumes([95, 88, 77, 66, 55, 55])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Candidate 1', 5],
          ['Candidate 2', 4],
          ['Candidate 3', 3],
          ['Candidate 4', 2],
          // Both hold the 5th distinct score, so both take the 1-star tier — six rated CVs.
          ['Candidate 5', 1],
          ['Candidate 6', 1]
        ])
      })

      it('gives two CVs tied for the best score five stars each', async () => {
        // Distinct scores: 95, 77, 66, 55, 44 — the tie consumes ONE tier, so the 44 that would
        // have been unrated under position ranking now reaches the 1-star tier.
        scoredResumes([95, 95, 77, 66, 55, 44])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Candidate 1', 5],
          ['Candidate 2', 5],
          ['Candidate 3', 4],
          ['Candidate 4', 3],
          ['Candidate 5', 2],
          ['Candidate 6', 1]
        ])
      })

      it('rates every CV five stars when they all share one score', async () => {
        scoredResumes([70, 70, 70, 70, 70, 70])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper).map(([, count]) => count)).toEqual([5, 5, 5, 5, 5, 5])
      })

      // The complementary consequence: fewer than five DISTINCT scores means the lower tiers are
      // never reached, even with more than five scored CVs. The tiers are not backfilled.
      it('leaves the lower tiers unused when there are fewer than five distinct scores', async () => {
        scoredResumes([90, 90, 80, 80, 70, 70])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Candidate 1', 5],
          ['Candidate 2', 5],
          ['Candidate 3', 4],
          ['Candidate 4', 4],
          ['Candidate 5', 3],
          ['Candidate 6', 3]
        ])
        const awarded = starCounts(wrapper).map(([, count]) => count)
        expect(awarded).not.toContain(2)
        expect(awarded).not.toContain(1)
      })

      // A CV below the fifth distinct score stays unrated, and a tie above it does NOT pull the
      // cutoff further down the list — the tiers are distinct scores, not slots to be filled.
      it('rates nothing below the fifth distinct score, even with a tie above it', async () => {
        scoredResumes([95, 88, 88, 77, 66, 55, 44])
        const wrapper = mountModal()
        await flushPromises()

        // Distinct: 95, 88, 77, 66, 55 (44 misses the cut) — 88 is shared by two CVs.
        expect(starCounts(wrapper)).toEqual([
          ['Candidate 1', 5],
          ['Candidate 2', 4],
          ['Candidate 3', 4],
          ['Candidate 4', 3],
          ['Candidate 5', 2],
          ['Candidate 6', 1],
          ['Candidate 7', 0]
        ])
      })
    })

    describe('fewer than five scored CVs', () => {
      it('rates two scored CVs 5 and 4 rather than starring both equally', async () => {
        // Only Jane and John are attached in the default fixture; both are scored.
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([janeMatch, johnMatch])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Jane Doe', 5],
          ['John Smith', 4]
        ])
      })

      it('rates a single scored CV 5 and leaves the unscored one at zero', async () => {
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([johnMatch])
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Jane Doe', 0],
          ['John Smith', 5]
        ])
      })

      it('renders no stars at all when nothing has been scored for the job yet', async () => {
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([])
        const wrapper = mountModal()
        await flushPromises()

        expect(wrapper.findAll('li')).toHaveLength(2)
        expect(starCounts(wrapper)).toEqual([
          ['Jane Doe', 0],
          ['John Smith', 0]
        ])
      })
    })

    describe('accessibility and styling', () => {
      // The rating is one labelled group, not N labelled icons — a screen reader should hear the
      // rank once, not "star" five times.
      it('labels the rating with its count, as a single group per row', async () => {
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([janeMatch, johnMatch])
        const wrapper = mountModal()
        await flushPromises()

        const labels = wrapper.findAll('li').map((row) => row.find('[role="img"]').attributes('aria-label'))
        expect(labels).toEqual(['5 of 5 stars for this job', '4 of 5 stars for this job'])
      })

      it('marks the individual star icons decorative so they are not announced separately', async () => {
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([janeMatch])
        const wrapper = mountModal()
        await flushPromises()

        const row = wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))
        for (const star of row!.findAll('.fill-warning')) {
          expect(star.attributes('aria-hidden')).toBe('true')
        }
      })

      it('renders no rating group at all for an unrated CV, rather than an empty one', async () => {
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([janeMatch])
        const wrapper = mountModal()
        await flushPromises()

        const row = wrapper.findAll('li').find((li) => li.text().includes('John Smith'))
        expect(row!.find('[role="img"]').exists()).toBe(false)
      })

      it('uses the app --warning token classes for the stars rather than a hardcoded yellow', async () => {
        vi.mocked(listLatestMatchesForJob).mockResolvedValue([janeMatch, johnMatch])
        const wrapper = mountModal()
        await flushPromises()

        const star = wrapper.find('.fill-warning')
        expect(star.classes()).toContain('text-warning')
        expect(star.classes()).toContain('fill-warning')
      })
    })

    // Open Question 3, the regression tests — the invariant survives the change from binary to
    // graduated stars. The rating ranks over ALL attached CVs and must not recompute within the
    // filtered set: a CV's star COUNT must be identical before and after a filter is applied.
    describe('rating vs filter (Open Question 3)', () => {
      // Two Mid CVs (4 years) scoring highest, four Senior CVs (9 years) below them. Unfiltered:
      // Mid One 5, Mid Two 4, Senior One 3, Senior Two 2, Senior Three 1, Senior Four 0.
      function mixedLevels() {
        const resumes = [
          { ...attachedPdf, id: 'resume-1', candidate_name: 'Mid One', years_experience: 4 },
          { ...attachedPdf, id: 'resume-2', candidate_name: 'Mid Two', years_experience: 4 },
          { ...attachedPdf, id: 'resume-3', candidate_name: 'Senior One', years_experience: 9 },
          { ...attachedPdf, id: 'resume-4', candidate_name: 'Senior Two', years_experience: 9 },
          { ...attachedPdf, id: 'resume-5', candidate_name: 'Senior Three', years_experience: 9 },
          { ...attachedPdf, id: 'resume-6', candidate_name: 'Senior Four', years_experience: 9 }
        ]
        const scores = [95, 88, 77, 66, 55, 44]
        vi.mocked(listJobResumes).mockResolvedValue(resumes)
        vi.mocked(listLatestMatchesForJob).mockResolvedValue(
          scores.map((score, index) => ({
            ...janeMatch,
            id: `match-${index + 1}`,
            resume_id: `resume-${index + 1}`,
            score
          }))
        )
      }

      it('keeps every surviving row on the exact star count it had before the filter', async () => {
        mixedLevels()
        const wrapper = mountModal()
        await flushPromises()

        expect(starCounts(wrapper)).toEqual([
          ['Mid One', 5],
          ['Mid Two', 4],
          ['Senior One', 3],
          ['Senior Two', 2],
          ['Senior Three', 1],
          ['Senior Four', 0]
        ])

        await selectLevel(wrapper, 'Senior')

        // Senior One is now the highest-scoring VISIBLE row, but is still 3rd overall — it must
        // stay on 3 stars and must not be promoted to 5.
        expect(starCounts(wrapper)).toEqual([
          ['Senior One', 3],
          ['Senior Two', 2],
          ['Senior Three', 1],
          ['Senior Four', 0]
        ])
      })

      // The complement: a filtered view legitimately showing no 5-star CV is correct, not a bug
      // to be "fixed" by re-ranking within the filter.
      it('leaves a filtered view with no top-rated CV rather than re-ranking to create one', async () => {
        mixedLevels()
        const wrapper = mountModal()
        await flushPromises()

        await selectLevel(wrapper, 'Senior')

        expect(starCounts(wrapper).map(([, count]) => count)).not.toContain(5)
      })

      it('keeps the Mid CVs on their original counts when filtered to Mid', async () => {
        mixedLevels()
        const wrapper = mountModal()
        await flushPromises()

        await selectLevel(wrapper, 'Mid')

        expect(starCounts(wrapper)).toEqual([
          ['Mid One', 5],
          ['Mid Two', 4]
        ])
      })

      it('restores every rating when the filter is cleared', async () => {
        mixedLevels()
        const wrapper = mountModal()
        await flushPromises()

        const before = starCounts(wrapper)
        await selectLevel(wrapper, 'Senior')
        await selectLevel(wrapper, 'All')

        expect(starCounts(wrapper)).toEqual(before)
      })

      // A skills filter must be no different from a level filter here.
      it('keeps counts identical across a skills filter too', async () => {
        mixedLevels()
        const wrapper = mountModal()
        await flushPromises()

        const before = starCounts(wrapper)
        await toggleSkill(wrapper, 'Typescript')

        // Every fixture carries typescript, so all six survive — with untouched ratings.
        expect(starCounts(wrapper)).toEqual(before)
      })
    })

    // The route is Admin/Recruiter-only and 403s for Candidate, so the request must never be
    // attempted for that role — hiding the rating client-side alone would still hit the 403.
    it('never requests the job match scores for a candidate, and renders no stars', async () => {
      mockUser.value = { ...mockUser.value, role: 'candidate' }
      vi.mocked(listLatestMatchesForJob).mockResolvedValue([janeMatch, johnMatch])
      const wrapper = mountModal()
      await flushPromises()

      expect(listLatestMatchesForJob).not.toHaveBeenCalled()
      expect(starCounts(wrapper)).toEqual([
        ['Jane Doe', 0],
        ['John Smith', 0]
      ])
      expect(wrapper.text()).toContain('Jane Doe')
    })

    // .plan/023 Assumptions: loadLatestMatches used to lean entirely on the match store's toast
    // and swallow the rejection itself, so once the store stopped toasting this failure would
    // have gone completely silent. The toast is now raised here, alongside the reset to [] that
    // keeps the rest of the modal usable.
    it('still renders the attached CV list when the match-score lookup fails, just without ratings', async () => {
      vi.mocked(listLatestMatchesForJob).mockRejectedValue(new Error('Job not found'))
      const wrapper = mountModal()
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Job not found')
      expect(wrapper.findAll('li')).toHaveLength(2)
      expect(starCounts(wrapper)).toEqual([
        ['Jane Doe', 0],
        ['John Smith', 0]
      ])
      // The modal's own error surface belongs to the CV list; a rating lookup failure must not claim it.
      expect(wrapper.text()).not.toContain('Failed to load CVs for this job')
      expect(wrapper.text()).not.toContain('Loading CVs…')
    })
  })

  // Recruiter CV filters (.plan/029 Steps 11/12). All filtering is client-side over
  // `attachedResumes`, which is one job's complete unpaginated attachment list — so unlike the
  // paginated GET /api/resume, there is no second page for a filter to silently miss.
  describe('experience level and skills filters', () => {
    it('renders the filter row for an admin with the level tabs and the skills picker', async () => {
      const wrapper = mountModal()
      await flushPromises()

      expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
        'All',
        'Junior',
        'Mid',
        'Senior'
      ])
      expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('Filter by experience level')
    })

    it('renders the filter row for a recruiter, who is the whole point of the feature', async () => {
      mockUser.value = { ...mockUser.value, role: 'recruiter' }
      const wrapper = mountModal()
      await flushPromises()

      expect(wrapper.findAll('[role="tab"]')).toHaveLength(4)
    })

    it('shows every attached CV under All', async () => {
      const wrapper = mountModal()
      await flushPromises()

      expect(visibleNames(wrapper)).toEqual(['Jane Doe', 'John Smith'])
    })

    describe('level filter', () => {
      it('narrows the list to the selected level', async () => {
        const wrapper = mountModal()
        await flushPromises()

        // Jane is 4 years (Mid), John is 9 (Senior).
        await selectLevel(wrapper, 'Mid')
        expect(visibleNames(wrapper)).toEqual(['Jane Doe'])

        await selectLevel(wrapper, 'Senior')
        expect(visibleNames(wrapper)).toEqual(['John Smith'])
      })

      it('restores the full list when All is selected again', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await selectLevel(wrapper, 'Senior')
        await selectLevel(wrapper, 'All')

        expect(visibleNames(wrapper)).toEqual(['Jane Doe', 'John Smith'])
      })

      // The feature's central data rule: null is "unclassified", not zero. A CV that was never
      // analyzed must not be silently filed under Junior, where a recruiter would treat it as a
      // real junior applicant.
      it('shows a CV with a null years_experience only under All, never under a level tab', async () => {
        const unanalyzed = {
          ...attachedPdf,
          id: 'resume-9',
          candidate_name: 'Unanalyzed Person',
          years_experience: null,
          skills: []
        }
        vi.mocked(listJobResumes).mockResolvedValue([attachedPdf, unanalyzed])
        const wrapper = mountModal()
        await flushPromises()

        expect(visibleNames(wrapper)).toContain('Unanalyzed Person')

        for (const level of ['Junior', 'Mid', 'Senior']) {
          await selectLevel(wrapper, level)
          expect(visibleNames(wrapper)).not.toContain('Unanalyzed Person')
        }

        await selectLevel(wrapper, 'All')
        expect(visibleNames(wrapper)).toContain('Unanalyzed Person')
      })

      it('files a 0-years CV under Junior, unlike an unanalyzed one', async () => {
        const zeroYears = { ...attachedPdf, id: 'resume-9', candidate_name: 'Fresh Grad', years_experience: 0 }
        vi.mocked(listJobResumes).mockResolvedValue([zeroYears])
        const wrapper = mountModal()
        await flushPromises()

        await selectLevel(wrapper, 'Junior')

        expect(visibleNames(wrapper)).toEqual(['Fresh Grad'])
      })
    })

    describe('skills filter', () => {
      it('offers exactly the skills present among this job\'s attached CVs, de-duplicated and sorted', async () => {
        const wrapper = mountModal()
        await flushPromises()

        // Jane has node + typescript, John has python + typescript: typescript appears once.
        expect(skillChipLabels(wrapper)).toEqual(['Node', 'Python', 'Typescript'])
      })

      // There is deliberately no global skills endpoint (.plan/029 Scope): the picker must never
      // offer a skill that matches zero rows in the dialog the recruiter is standing in.
      it('never offers a skill that only an unattached CV has', async () => {
        const wrapper = mountModal()
        await flushPromises()

        // Amy Lee (unattached, in the attach dropdown) has 'rust'.
        expect(skillChipLabels(wrapper)).not.toContain('Rust')
      })

      it('narrows the list to CVs having the selected skill', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await toggleSkill(wrapper, 'Python')

        expect(visibleNames(wrapper)).toEqual(['John Smith'])
      })

      it('restores the full list when the selected skill is toggled back off', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await toggleSkill(wrapper, 'Python')
        await toggleSkill(wrapper, 'Python')

        expect(visibleNames(wrapper)).toEqual(['Jane Doe', 'John Smith'])
      })

      // Open Question 6: a recruiter picking two skills wants someone with BOTH.
      it('ANDs multiple selected skills rather than ORing them', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await toggleSkill(wrapper, 'Typescript')
        expect(visibleNames(wrapper)).toEqual(['Jane Doe', 'John Smith'])

        // Only Jane has node; only John has python. Nobody has both node and python.
        await toggleSkill(wrapper, 'Node')
        expect(visibleNames(wrapper)).toEqual(['Jane Doe'])

        await toggleSkill(wrapper, 'Python')
        expect(visibleNames(wrapper)).toEqual([])
      })

      it('marks the selected chips with aria-pressed', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await toggleSkill(wrapper, 'Node')

        const pressed = wrapper
          .findAll('[aria-pressed="true"]')
          .map((chip) => chip.text())
        expect(pressed).toEqual(['Node'])
      })

      it('renders no skills picker when no attached CV has been analyzed for skills', async () => {
        vi.mocked(listJobResumes).mockResolvedValue([{ ...attachedPdf, skills: [] }])
        const wrapper = mountModal()
        await flushPromises()

        expect(skillChipLabels(wrapper)).toEqual([])
        // The level tabs still render — years and skills are analyzed independently.
        expect(wrapper.findAll('[role="tab"]')).toHaveLength(4)
      })
    })

    it('combines the level and skills filters with AND', async () => {
      const wrapper = mountModal()
      await flushPromises()

      // Senior AND typescript matches John; Mid AND typescript matches Jane.
      await selectLevel(wrapper, 'Senior')
      await toggleSkill(wrapper, 'Typescript')
      expect(visibleNames(wrapper)).toEqual(['John Smith'])

      // Senior AND node matches nobody — John is Senior but has no node.
      await toggleSkill(wrapper, 'Typescript')
      await toggleSkill(wrapper, 'Node')
      expect(visibleNames(wrapper)).toEqual([])
    })

    describe('filtered-empty state', () => {
      it('shows a distinct empty state when the filters exclude every attached CV', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await selectLevel(wrapper, 'Junior')

        expect(wrapper.text()).toContain('No CVs match these filters')
        // Must not claim the job has nothing attached — it has two CVs.
        expect(wrapper.text()).not.toContain('No CVs attached yet')
        expect(wrapper.findAll('li')).toHaveLength(0)
      })

      it('still shows "No CVs attached yet" when the job genuinely has no CVs', async () => {
        vi.mocked(listJobResumes).mockResolvedValue([])
        const wrapper = mountModal()
        await flushPromises()

        expect(wrapper.text()).toContain('No CVs attached yet')
        expect(wrapper.text()).not.toContain('No CVs match these filters')
      })

      it('recovers from the filtered-empty state via Clear filters', async () => {
        const wrapper = mountModal()
        await flushPromises()

        await selectLevel(wrapper, 'Junior')
        expect(wrapper.text()).toContain('No CVs match these filters')

        const clear = wrapper.findAll('button').find((btn) => btn.text().includes('Clear filters'))
        await clear?.trigger('click')
        await flushPromises()

        expect(visibleNames(wrapper)).toEqual(['Jane Doe', 'John Smith'])
      })
    })

    // Permission-denied path. A Candidate is already list-narrowed to their own CVs by the
    // backend (.plan/011), so a filter row over a one-row list is noise — and the level tabs
    // must not appear for them at all.
    describe('candidate role', () => {
      beforeEach(() => {
        mockUser.value = { ...mockUser.value, role: 'candidate' }
        vi.mocked(listJobResumes).mockResolvedValue([attachedPdf])
      })

      it('renders no filter row for a candidate', async () => {
        const wrapper = mountModal()
        await flushPromises()

        expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
        expect(skillChipLabels(wrapper)).toEqual([])
      })

      it('still renders the candidate\'s own CV unfiltered', async () => {
        const wrapper = mountModal()
        await flushPromises()

        expect(visibleNames(wrapper)).toEqual(['Jane Doe'])
      })
    })

    // Failure path: the fields are contractually always present, but a stale cached response
    // predating the backend change is not a reason to take the whole dialog down.
    it('renders a CV whose analysis fields are missing entirely, treating it as unclassified', async () => {
      const { years_experience: _years, skills: _skills, ...legacy } = attachedPdf
      vi.mocked(listJobResumes).mockResolvedValue([legacy as typeof attachedPdf])
      const wrapper = mountModal()
      await flushPromises()

      expect(visibleNames(wrapper)).toEqual(['Jane Doe'])
      expect(skillChipLabels(wrapper)).toEqual([])

      await selectLevel(wrapper, 'Junior')
      expect(wrapper.text()).toContain('No CVs match these filters')
    })
  })

  it('is read-only for a recruiter: no attach control, no Detach button, but Download still works', async () => {
    mockUser.value = { ...mockUser.value, role: 'recruiter' }
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.findAll('button').some((btn) => btn.text().includes('Attach CV'))).toBe(false)
    expect(wrapper.findAll('button').some((btn) => btn.text().includes('Detach'))).toBe(false)

    const downloadLink = wrapper.findAll('a').find((a) => a.text().includes('Download'))
    expect(downloadLink?.attributes('href')).toBe('http://localhost:3001/api/resume/resume-1/file?download=1')
  })
})
