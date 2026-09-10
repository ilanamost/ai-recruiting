import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  createMatch: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import MatchResult from '../src/components/MatchResult.vue'
import { createMatch } from '../src/lib/api'
import { toast } from 'vue-sonner'

// .plan/018: the component calls the match store, which is the only thing that calls lib/api.
// `stubActions: false` runs the real store action against the mocked lib/api.
function mountMatchResult(props: { resumeId?: string; jobId?: string; matchId?: string }) {
  return mount(MatchResult, {
    props,
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

describe('MatchResult', () => {
  beforeEach(() => {
    vi.mocked(createMatch).mockReset()
    vi.mocked(toast.error).mockClear()
  })

  it('scores the match on mount and renders the result', async () => {
    vi.mocked(createMatch).mockResolvedValue({
      id: 'match-1',
      resume_id: 'resume-1',
      job_id: 'job-1',
      score: 82,
      explanation: 'Strong overlap in required skills.',
      created_at: new Date().toISOString()
    })

    const wrapper = mountMatchResult({ resumeId: 'resume-1', jobId: 'job-1' })
    await flushPromises()

    expect(createMatch).toHaveBeenCalledWith({ resume_id: 'resume-1', job_id: 'job-1' })
    expect(wrapper.text()).toContain('82')
    expect(wrapper.text()).toContain('Strong overlap in required skills.')
  })

  // Score-reveal animation (.plan/014 item 1). jsdom does not run CSS animations, so these
  // assert which classes the component applies, not what they look like — the visual check is
  // manual, per the plan's Risks section.
  describe('score reveal animation', () => {
    async function mountWithScore(score: number) {
      vi.mocked(createMatch).mockResolvedValue({
        id: 'match-1',
        resume_id: 'resume-1',
        job_id: 'job-1',
        score,
        explanation: 'Explanation.',
        created_at: new Date().toISOString()
      })
      const wrapper = mountMatchResult({ resumeId: 'resume-1', jobId: 'job-1' })
      await flushPromises()
      return wrapper
    }

    it('pops the score number and glows the bar fill for a score over 80', async () => {
      const wrapper = await mountWithScore(85)

      expect(wrapper.find('.score-reveal-pop').exists()).toBe(true)
      expect(wrapper.find('.score-bar-fill.score-reveal-glow').exists()).toBe(true)
      expect(wrapper.find('.fade-in').exists()).toBe(false)
    })

    // 80 itself is not "over 80" — the boundary belongs to the mid treatment even though the
    // colour band (score-high, >= 75) already applies here.
    it('does not celebrate a score of exactly 80', async () => {
      const wrapper = await mountWithScore(80)

      expect(wrapper.find('.score-reveal-pop').exists()).toBe(false)
      expect(wrapper.find('.score-reveal-glow').exists()).toBe(false)
      expect(wrapper.find('.score-bar-fill').classes()).toContain('score-high')
    })

    it('applies only the plain fade for a low score, with no pop or glow', async () => {
      const wrapper = await mountWithScore(30)

      expect(wrapper.find('.score-reveal-pop').exists()).toBe(false)
      expect(wrapper.find('.score-reveal-glow').exists()).toBe(false)
      expect(wrapper.find('.score-bar-fill.fade-in').exists()).toBe(true)
    })

    it('applies no entrance animation at all for a mid score', async () => {
      const wrapper = await mountWithScore(60)

      expect(wrapper.find('.score-reveal-pop').exists()).toBe(false)
      expect(wrapper.find('.score-reveal-glow').exists()).toBe(false)
      expect(wrapper.find('.fade-in').exists()).toBe(false)
      // The bar's existing width transition is untouched — today's behaviour for mid scores.
      expect(wrapper.find('.score-bar-fill').attributes('style')).toContain('width: 60%')
    })
  })

  it('renders an error message when scoring fails', async () => {
    vi.mocked(createMatch).mockRejectedValue(
      new Error('The scoring model declined to process this request')
    )

    const wrapper = mountMatchResult({ resumeId: 'resume-2', jobId: 'job-2' })
    await flushPromises()

    expect(wrapper.text()).toContain('The scoring model declined to process this request')
    // .plan/018 deliberately left createMatch/getMatch as the two non-toasting match actions:
    // this failure is reported inside the card, so a toast would double-report it.
    expect(toast.error).not.toHaveBeenCalled()
  })
})
