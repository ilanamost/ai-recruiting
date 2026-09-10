import type { ExperienceLevel } from '../types'

// The single source of truth for the Junior / Mid / Senior bands
// (.plan/029-2026-09-07-cv-recruiter-filter.md, Open Question 4). Deliberately frontend-only:
// `experience_level` is not a column and no backend code translates a level to a years range,
// so re-tuning a boundary is a one-line change here with no migration and nothing to keep in
// sync.

// Lower bound of each band, in years. Junior starts at 0.
export const MID_MIN_YEARS = 3
export const SENIOR_MIN_YEARS = 6

// Ordered as they are rendered in the tab strip, least to most experienced.
export const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' }
]

/**
 * The band a CV's analyzed years of experience fall into, or `null` for a CV that has no band.
 *
 * Null in, null out: `years_experience` is null for a CV with no dated work history, one
 * uploaded before analysis existed, or one whose analysis call failed. That is "unclassified",
 * NOT zero — such a CV matches no level tab and is only ever reachable under "All". Returning
 * 'junior' for it would silently mislabel a career-changer with an undated CV.
 *
 * Defensive on the rest: a negative, NaN, or Infinite value can only come from a broken
 * response, and reads as unclassified rather than being forced into the nearest band.
 *
 * Compared by lower bound rather than by an inclusive 0–2 / 3–5 / 6+ range, so a fractional
 * year lands in a band instead of the gap between two of them.
 */
export function yearsToLevel(years: number | null): ExperienceLevel | null {
  if (years === null || !Number.isFinite(years) || years < 0) {
    return null
  }
  if (years < MID_MIN_YEARS) {
    return 'junior'
  }
  if (years < SENIOR_MIN_YEARS) {
    return 'mid'
  }
  return 'senior'
}

/**
 * A skill for display. Skills arrive already normalized to lowercase from the API and are
 * matched exactly in that form, so this only ever affects rendering — never storage, never
 * comparison. Anything else would re-normalize server-owned data and break exact matching.
 */
export function skillLabel(skill: string) {
  return skill.charAt(0).toUpperCase() + skill.slice(1)
}
