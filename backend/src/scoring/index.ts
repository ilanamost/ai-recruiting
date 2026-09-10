import Anthropic from '@anthropic-ai/sdk'
import { UpstreamError } from '../lib/errors'

export interface ScoreResult {
  score: number
  explanation: string
}

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    explanation: { type: 'string' }
  },
  required: ['score', 'explanation'],
  additionalProperties: false
} as const

const SYSTEM_INSTRUCTIONS = [
  'You are an expert technical recruiter screening a candidate resume against a job description.',
  'Score how well the resume matches the job on a 0-100 scale, then write a short explanation of the',
  'score that references specific content from the resume. Be honest about gaps and missing',
  'requirements rather than inflating the score.'
].join(' ')

let client: Anthropic | undefined

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic()
  }
  return client
}

/**
 * Scores one resume against one job description via a single Claude API
 * call. The job description sits in the cached system block (stable across
 * every resume scored against the same job); the resume text is the varying
 * user turn. See .doc/architecture.md's "Prompt caching for batch scoring".
 */
export async function scoreMatch(jobDescription: string, resumeText: string): Promise<ScoreResult> {
  const model = process.env.SCORING_MODEL ?? 'claude-sonnet-5'

  const response = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: `${SYSTEM_INSTRUCTIONS}\n\nJob description:\n${jobDescription}`,
        cache_control: { type: 'ephemeral' }
      }
    ],
    output_config: {
      format: { type: 'json_schema', schema: SCORE_SCHEMA },
      effort: 'medium'
    },
    messages: [{ role: 'user', content: `Resume:\n${resumeText}` }]
  })

  if (response.stop_reason === 'refusal') {
    throw new UpstreamError('The scoring model declined to process this request')
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new UpstreamError('The scoring model returned no text output')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    throw new UpstreamError('The scoring model returned invalid JSON')
  }

  const result = parsed as Partial<ScoreResult>
  if (typeof result.score !== 'number' || typeof result.explanation !== 'string') {
    throw new UpstreamError('The scoring model response did not match the expected shape')
  }

  // The JSON schema constrains type, not range - clamp defensively before persisting.
  const score = Math.min(100, Math.max(0, Math.round(result.score)))

  return { score, explanation: result.explanation }
}
