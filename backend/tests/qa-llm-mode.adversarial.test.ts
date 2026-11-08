import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, anthropicCtor } = vi.hoisted(() => {
  const createMock = vi.fn()
  return { createMock, anthropicCtor: vi.fn().mockImplementation(() => ({ messages: { create: createMock } })) }
})
vi.mock('@anthropic-ai/sdk', () => ({ default: anthropicCtor }))

import { invalidLlmMode, isMockMode } from '../src/lib/llm-mode'
import { scoreMatch } from '../src/scoring'
import { analyzeResume, MAX_SKILLS, MAX_SKILL_LENGTH } from '../src/analysis'

describe('QA adversarial: LLM_MODE=mock', () => {
  const original = process.env.LLM_MODE
  beforeEach(() => { process.env.LLM_MODE = 'mock'; anthropicCtor.mockClear() })
  afterEach(() => { if (original === undefined) delete process.env.LLM_MODE; else process.env.LLM_MODE = original })

  it('flags case variants and whitespace as invalid, and they are not mock', () => {
    for (const v of ['MOCK', 'Mock', ' mock', 'mock ', 'true', '1']) {
      process.env.LLM_MODE = v
      expect(invalidLlmMode()).toBe(v)
      expect(isMockMode()).toBe(false)
    }
  })

  it('handles huge and malformed input without throwing, score stays an int 0-100', async () => {
    const big = 'node typescript '.repeat(200000)
    for (const [job, cv] of [['', ''], [big, big], ['\u0000\uD800 ###', '💥'.repeat(1000)], ['a b c', 'x']] as const) {
      const r = await scoreMatch(job, cv)
      expect(Number.isInteger(r.score)).toBe(true)
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      expect(r.explanation.length).toBeGreaterThan(0)
    }
    expect(anthropicCtor).not.toHaveBeenCalled()
  })

  it('analysis stays within bounds for absurd years and skill spam', async () => {
    const a = await analyzeResume('99 years, 1900 - 2100, 2099 to present, ' + 'javascript '.repeat(5000))
    expect(a.years_experience === null || (Number.isInteger(a.years_experience) && a.years_experience >= 0 && a.years_experience <= 60)).toBe(true)
    expect(a.skills.length).toBeLessThanOrEqual(MAX_SKILLS)
    for (const s of a.skills) expect(s.length).toBeLessThanOrEqual(MAX_SKILL_LENGTH)
    const empty = await analyzeResume('')
    expect(empty).toEqual({ years_experience: null, skills: [] })
    expect(anthropicCtor).not.toHaveBeenCalled()
  })

  it('does not hang on pathological regex input', async () => {
    const t = Date.now()
    await analyzeResume('1'.repeat(100000) + ' - ' + '2'.repeat(100000))
    expect(Date.now() - t).toBeLessThan(3000)
  })
})
