import Anthropic from '@anthropic-ai/sdk'
import { UpstreamError } from '../lib/errors'

/**
 * Structured signal extracted from a resume's already-extracted text, ahead of
 * scoring — the "analysis" step defined in .doc/glossary.md and implemented by
 * .plan/029-2026-09-07-cv-recruiter-filter.md. Distinct from "extraction",
 * which is the mechanical file-to-text step in ../extraction.
 */
export interface ResumeAnalysis {
  /**
   * Years of industry experience. Null means "unclassified", NOT zero — a CV
   * stating no dated work history must not be silently labelled a junior.
   */
  years_experience: number | null
  /** Normalized skills. Always an array — never null, `[]` when none were found. */
  skills: string[]
}

/** Open Question 5: an unbounded skill list would make the picker unusable. */
export const MAX_SKILLS = 30
/** Open Question 5: anything longer is prose, not a skill — dropped rather than truncated mid-word. */
export const MAX_SKILL_LENGTH = 50
/** Nobody has worked in the industry for longer than this; anything above is a misread. */
export const MAX_YEARS_EXPERIENCE = 60

// `years_experience` is a nullable integer because "the CV does not say" is a
// real, expected answer here — see the field doc above. The defensive parse
// below accepts null, a missing field, and a non-number all the same way, so a
// model that ignores the union type still degrades to "unclassified" rather
// than to a wrong number.
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    years_experience: { type: ['integer', 'null'] },
    skills: { type: 'array', items: { type: 'string' } }
  },
  required: ['years_experience', 'skills'],
  additionalProperties: false
} as const

const SYSTEM_INSTRUCTIONS = [
  'You are an expert technical recruiter reading a candidate resume.',
  'Extract exactly two things.',
  '(1) years_experience: the total number of years the candidate has worked professionally in',
  'their industry, counted from their dated work history. If the resume states no dated work',
  'history, or you cannot tell, return null — never guess and never return 0 to mean "unknown".',
  '(2) skills: the concrete technical and professional skills the resume actually evidences —',
  'languages, frameworks, tools, platforms, methodologies, domain expertise. Each one a short',
  'noun phrase. Do not include soft-skill filler such as "team player" or "hard working", and do',
  `not list more than ${MAX_SKILLS}.`
].join(' ')

let client: Anthropic | undefined

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic()
  }
  return client
}

/**
 * Trimmed, lowercased, de-duplicated, capped at MAX_SKILLS, each at most
 * MAX_SKILL_LENGTH characters (Open Question 5). The contract
 * (.orchestrate/api-contract.yaml) promises the frontend already-normalized
 * values it can match exactly without re-normalizing, so this is the only
 * place normalization happens. Non-strings and over-long entries are dropped
 * rather than coerced — a 50+ character "skill" is a sentence.
 */
function normalizeSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const skills: string[] = []

  for (const raw of value) {
    if (typeof raw !== 'string') continue

    const skill = raw.trim().toLowerCase()
    if (skill === '' || skill.length > MAX_SKILL_LENGTH) continue
    if (seen.has(skill)) continue

    seen.add(skill)
    skills.push(skill)
    if (skills.length === MAX_SKILLS) break
  }

  return skills
}

/**
 * Null (unclassified) for anything that isn't a finite number — null, a
 * missing field, or a model that returned a string. A returned number is
 * rounded and clamped defensively, the same way scoreMatch clamps its score:
 * the JSON schema constrains type, not range.
 */
function normalizeYearsExperience(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(MAX_YEARS_EXPERIENCE, Math.max(0, Math.round(value)))
}

/**
 * Reads years of experience and skills out of one resume's extracted text via
 * a single Claude API call, following the same house pattern as
 * ../scoring/index.ts: `output_config.format` json_schema, a refusal guard,
 * and a defensive parse before anything is persisted. `effort` is the control
 * for how much the model thinks — do NOT pass `budget_tokens`, which is
 * rejected with a 400 on this model generation.
 *
 * Throws UpstreamError on any provider or shape failure. Callers on the upload
 * path must catch that and degrade to an unclassified resume — a failed
 * analysis is never a failed upload (see routes/resume.ts).
 */
export async function analyzeResume(resumeText: string): Promise<ResumeAnalysis> {
  const model = process.env.ANALYSIS_MODEL ?? 'claude-sonnet-5'

  const response = await getClient().messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_INSTRUCTIONS,
    output_config: {
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
      effort: 'low'
    },
    messages: [{ role: 'user', content: `Resume:\n${resumeText}` }]
  })

  if (response.stop_reason === 'refusal') {
    throw new UpstreamError('The analysis model declined to process this request')
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new UpstreamError('The analysis model returned no text output')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    throw new UpstreamError('The analysis model returned invalid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new UpstreamError('The analysis model response did not match the expected shape')
  }

  const result = parsed as { years_experience?: unknown; skills?: unknown }
  if (!Array.isArray(result.skills)) {
    throw new UpstreamError('The analysis model response did not match the expected shape')
  }

  return {
    years_experience: normalizeYearsExperience(result.years_experience),
    skills: normalizeSkills(result.skills)
  }
}
