import { describe, expect, it } from 'vitest'

import { EXPERIENCE_LEVELS, skillLabel, yearsToLevel } from '../../src/lib/experience'

// .plan/029 Step 9, Open Question 4. This module is the single source of truth for the
// Junior / Mid / Senior boundaries, so the boundary years themselves are what these tests pin —
// re-tuning a band should have to change this file deliberately, not slip through.
describe('yearsToLevel', () => {
  describe('bands (Junior 0–2, Mid 3–5, Senior 6+)', () => {
    it.each([
      [0, 'junior'],
      [1, 'junior'],
      [2, 'junior'],
      [3, 'mid'],
      [4, 'mid'],
      [5, 'mid'],
      [6, 'senior'],
      [9, 'senior'],
      [40, 'senior']
    ])('maps %i years to %s', (years, level) => {
      expect(yearsToLevel(years)).toBe(level)
    })

    // The two boundaries are the whole point of the module — a band edge is where an off-by-one
    // would put a Mid applicant under Junior and hide them from a recruiter filtering by level.
    it('puts the Junior/Mid boundary between 2 and 3 years', () => {
      expect(yearsToLevel(2)).toBe('junior')
      expect(yearsToLevel(3)).toBe('mid')
    })

    it('puts the Mid/Senior boundary between 5 and 6 years', () => {
      expect(yearsToLevel(5)).toBe('mid')
      expect(yearsToLevel(6)).toBe('senior')
    })
  })

  describe('unclassified', () => {
    // The core distinction of the whole feature: null is "not analyzed", not "zero years".
    it('maps null to no level rather than to Junior', () => {
      expect(yearsToLevel(null)).toBeNull()
    })

    it('still maps a genuine 0 years to Junior, distinguishing it from null', () => {
      expect(yearsToLevel(0)).toBe('junior')
      expect(yearsToLevel(null)).not.toBe(yearsToLevel(0))
    })

    // Failure path: only a broken response produces these, and forcing them into the nearest
    // band would file an applicant under a level their CV never claimed.
    it.each([[NaN], [Infinity], [-Infinity], [-1]])('treats the malformed value %p as unclassified', (years) => {
      expect(yearsToLevel(years)).toBeNull()
    })
  })

  // The API contract says integer, but a fraction must land in a band rather than in the gap
  // between an inclusive 0–2 and 3–5.
  it('lands a fractional year inside a band instead of between two', () => {
    expect(yearsToLevel(2.5)).toBe('junior')
    expect(yearsToLevel(5.5)).toBe('mid')
  })
})

describe('EXPERIENCE_LEVELS', () => {
  it('lists the three bands least to most experienced, with display labels', () => {
    expect(EXPERIENCE_LEVELS).toEqual([
      { value: 'junior', label: 'Junior' },
      { value: 'mid', label: 'Mid' },
      { value: 'senior', label: 'Senior' }
    ])
  })

  it('covers every level yearsToLevel can return', () => {
    const produced = [0, 4, 9].map((years) => yearsToLevel(years))
    expect(EXPERIENCE_LEVELS.map((level) => level.value)).toEqual(produced)
  })
})

describe('skillLabel', () => {
  it('capitalizes a normalized skill for display', () => {
    expect(skillLabel('typescript')).toBe('Typescript')
  })

  // Display only: the value itself stays the normalized string the API sent, because matching
  // is exact on that form.
  it('leaves the rest of the string untouched, including internal punctuation', () => {
    expect(skillLabel('node.js')).toBe('Node.js')
    expect(skillLabel('c++')).toBe('C++')
  })

  it('does not throw on an empty string', () => {
    expect(skillLabel('')).toBe('')
  })
})
