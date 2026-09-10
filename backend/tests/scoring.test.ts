import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock }
  }))
}))

import { scoreMatch } from '../src/scoring'

describe('scoreMatch', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('parses a valid structured response', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ score: 91, explanation: 'Great fit.' }) }]
    })

    const result = await scoreMatch('Job description', 'Resume text')

    expect(result).toEqual({ score: 91, explanation: 'Great fit.' })
  })

  it('clamps a score above the 0-100 range', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ score: 140, explanation: 'Overqualified.' }) }]
    })

    const result = await scoreMatch('Job description', 'Resume text')

    expect(result.score).toBe(100)
  })

  it('clamps a score below the 0-100 range', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ score: -10, explanation: 'No overlap.' }) }]
    })

    const result = await scoreMatch('Job description', 'Resume text')

    expect(result.score).toBe(0)
  })

  it('throws when the model refuses the request', async () => {
    createMock.mockResolvedValue({ stop_reason: 'refusal', content: [] })

    await expect(scoreMatch('Job description', 'Resume text')).rejects.toThrow(
      'declined to process this request'
    )
  })

  it('throws when the response is not valid JSON', async () => {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }]
    })

    await expect(scoreMatch('Job description', 'Resume text')).rejects.toThrow('invalid JSON')
  })
})
