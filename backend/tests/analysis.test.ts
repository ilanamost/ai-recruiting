import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock }
  }))
}))

import { analyzeResume, MAX_SKILL_LENGTH, MAX_SKILLS, MAX_YEARS_EXPERIENCE } from '../src/analysis'

function modelReturns(payload: unknown) {
  createMock.mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }]
  })
}

describe('analyzeResume — request shape', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  // `budget_tokens` is rejected with a 400 on this model generation
  // (.plan/029 Scope) — `effort` is the control. Pinned here so a well-meaning
  // "add a token budget" edit fails in CI rather than in production.
  it("sends a json_schema output format at effort 'low' and no budget_tokens", async () => {
    modelReturns({ years_experience: 4, skills: ['typescript'] })

    await analyzeResume('Resume text')

    const request = createMock.mock.calls[0][0]
    expect(request.output_config.format.type).toBe('json_schema')
    expect(request.output_config.effort).toBe('low')
    expect(request).not.toHaveProperty('budget_tokens')
    expect(request.output_config).not.toHaveProperty('budget_tokens')
  })

  it('uses ANALYSIS_MODEL when set and falls back to claude-sonnet-5 when not', async () => {
    modelReturns({ years_experience: 4, skills: [] })

    const original = process.env.ANALYSIS_MODEL
    try {
      delete process.env.ANALYSIS_MODEL
      await analyzeResume('Resume text')
      expect(createMock.mock.calls[0][0].model).toBe('claude-sonnet-5')

      process.env.ANALYSIS_MODEL = 'claude-haiku-4-5'
      await analyzeResume('Resume text')
      expect(createMock.mock.calls[1][0].model).toBe('claude-haiku-4-5')
    } finally {
      if (original === undefined) delete process.env.ANALYSIS_MODEL
      else process.env.ANALYSIS_MODEL = original
    }
  })
})

describe('analyzeResume — years_experience', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('returns a valid number as-is', async () => {
    modelReturns({ years_experience: 9, skills: [] })

    expect((await analyzeResume('Resume text')).years_experience).toBe(9)
  })

  // The contract's hard requirement: null is "unclassified", never zero. A
  // career changer with an undated CV must not be labelled Junior.
  it('keeps an explicit null as null rather than defaulting it to 0', async () => {
    modelReturns({ years_experience: null, skills: ['react'] })

    const result = await analyzeResume('Resume text')

    expect(result.years_experience).toBeNull()
    expect(result.years_experience).not.toBe(0)
  })

  it('treats a missing years_experience as unclassified, not zero', async () => {
    modelReturns({ skills: ['react'] })

    expect((await analyzeResume('Resume text')).years_experience).toBeNull()
  })

  it('treats a non-numeric years_experience as unclassified without losing the skills', async () => {
    modelReturns({ years_experience: 'about five', skills: ['react'] })

    const result = await analyzeResume('Resume text')

    expect(result.years_experience).toBeNull()
    expect(result.skills).toEqual(['react'])
  })

  it('rounds a fractional number of years', async () => {
    modelReturns({ years_experience: 4.6, skills: [] })

    expect((await analyzeResume('Resume text')).years_experience).toBe(5)
  })

  it('clamps an implausibly large number of years', async () => {
    modelReturns({ years_experience: 900, skills: [] })

    expect((await analyzeResume('Resume text')).years_experience).toBe(MAX_YEARS_EXPERIENCE)
  })

  it('clamps a negative number of years to zero', async () => {
    modelReturns({ years_experience: -4, skills: [] })

    expect((await analyzeResume('Resume text')).years_experience).toBe(0)
  })
})

describe('analyzeResume — skill normalization (Open Question 5)', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('trims and lowercases every skill', async () => {
    modelReturns({ years_experience: 3, skills: ['  TypeScript ', 'PostgreSQL'] })

    expect((await analyzeResume('Resume text')).skills).toEqual(['typescript', 'postgresql'])
  })

  it('de-duplicates skills that differ only in case or whitespace', async () => {
    modelReturns({ years_experience: 3, skills: ['React', 'react', ' REACT  '] })

    expect((await analyzeResume('Resume text')).skills).toEqual(['react'])
  })

  it(`caps the list at ${MAX_SKILLS} skills`, async () => {
    modelReturns({
      years_experience: 3,
      skills: Array.from({ length: MAX_SKILLS + 15 }, (_, i) => `skill-${i}`)
    })

    const { skills } = await analyzeResume('Resume text')

    expect(skills).toHaveLength(MAX_SKILLS)
    expect(skills[0]).toBe('skill-0')
  })

  it(`drops a skill longer than ${MAX_SKILL_LENGTH} characters instead of truncating it mid-word`, async () => {
    const tooLong = 'a'.repeat(MAX_SKILL_LENGTH + 1)
    modelReturns({ years_experience: 3, skills: ['node', tooLong] })

    expect((await analyzeResume('Resume text')).skills).toEqual(['node'])
  })

  it('keeps a skill of exactly the maximum length', async () => {
    const exact = 'a'.repeat(MAX_SKILL_LENGTH)
    modelReturns({ years_experience: 3, skills: [exact] })

    expect((await analyzeResume('Resume text')).skills).toEqual([exact])
  })

  it('drops empty, whitespace-only, and non-string entries', async () => {
    modelReturns({ years_experience: 3, skills: ['', '   ', 42, null, 'go'] })

    expect((await analyzeResume('Resume text')).skills).toEqual(['go'])
  })

  it('returns an empty array, never null, when the model finds no skills', async () => {
    modelReturns({ years_experience: 3, skills: [] })

    const { skills } = await analyzeResume('Resume text')

    expect(skills).toEqual([])
    expect(skills).not.toBeNull()
  })
})

describe('analyzeResume — failure modes', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('throws when the model refuses the request', async () => {
    createMock.mockResolvedValue({ stop_reason: 'refusal', content: [] })

    await expect(analyzeResume('Resume text')).rejects.toThrow('declined to process this request')
  })

  it('throws when the response carries no text block', async () => {
    createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [] })

    await expect(analyzeResume('Resume text')).rejects.toThrow('no text output')
  })

  it('throws when the response is not valid JSON', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }]
    })

    await expect(analyzeResume('Resume text')).rejects.toThrow('invalid JSON')
  })

  it('throws when skills is not an array', async () => {
    modelReturns({ years_experience: 3, skills: 'typescript, node' })

    await expect(analyzeResume('Resume text')).rejects.toThrow('did not match the expected shape')
  })

  it('throws when the response is a bare JSON value rather than an object', async () => {
    modelReturns(null)

    await expect(analyzeResume('Resume text')).rejects.toThrow('did not match the expected shape')
  })

  it('propagates a transport failure from the SDK', async () => {
    createMock.mockRejectedValue(new Error('connection reset'))

    await expect(analyzeResume('Resume text')).rejects.toThrow('connection reset')
  })
})
