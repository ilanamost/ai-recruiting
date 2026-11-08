import { ServiceUnavailableError } from './errors'

/**
 * LLM_MODE switch (.plan/038-2026-11-08-llm-mode-mock.md). `mock` makes resume
 * analysis and match scoring run locally and deterministically, with no
 * Anthropic call. Unset or `live` keeps the real LLM path.
 */
const VALID_MODES = ['live', 'mock'] as const

export function isMockMode(): boolean {
  return process.env.LLM_MODE === 'mock'
}

/** The offending value when LLM_MODE is set to something other than live/mock, else null. */
export function invalidLlmMode(): string | null {
  const mode = process.env.LLM_MODE
  if (mode === undefined || mode === '') return null
  return (VALID_MODES as readonly string[]).includes(mode) ? null : mode
}

/**
 * Called once at startup. A typo such as `LLM_MODE=mok` must never silently fall
 * through to real LLM calls - but it must not take the whole API down either
 * (login, jobs and CVs still work). So it is logged loudly here, and
 * assertLlmAvailable() makes analysis and scoring refuse until it is fixed.
 */
export function reportInvalidLlmMode(): void {
  const mode = invalidLlmMode()
  if (mode === null) return
  console.error(
    `Invalid LLM_MODE "${mode}": expected one of ${VALID_MODES.join(', ')} (or unset). ` +
      'Matching and CV analysis are DISABLED until it is fixed; the rest of the API keeps running.'
  )
}

/** Guard for every LLM entry point: throws 503 while LLM_MODE is invalid. */
export function assertLlmAvailable(): void {
  if (invalidLlmMode() !== null) {
    throw new ServiceUnavailableError('Matching is temporarily unavailable. Please contact an administrator.')
  }
}
