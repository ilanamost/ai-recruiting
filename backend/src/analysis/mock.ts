/**
 * Heuristic analyzer used when LLM_MODE=mock. Returns RAW values; the caller
 * (analyzeResume) runs them through the same normalizers as the live path.
 */
const KNOWN_SKILLS = [
  'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'ruby', 'php', 'c#', 'c++', 'sql',
  'react', 'vue', 'angular', 'node.js', 'express', 'django', 'flask', 'spring', 'next.js',
  'html', 'css', 'tailwind', 'graphql', 'rest', 'postgresql', 'mysql', 'mongodb', 'redis',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'git', 'ci/cd', 'linux',
  'machine learning', 'data analysis', 'agile', 'scrum', 'figma'
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasSkill(text: string, skill: string): boolean {
  return new RegExp(`(?<![a-z0-9+#])${escapeRegExp(skill)}(?![a-z0-9+#])`, 'i').test(text)
}

function mockYearsExperience(text: string, currentYear: number): number | null {
  let explicit: number | null = null
  for (const match of text.matchAll(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi)) {
    const years = Number(match[1])
    if (explicit === null || years > explicit) explicit = years
  }

  // Dated ranges ("2018 - 2021", "2019 to present"), merged so overlaps count once.
  const ranges: Array<[number, number]> = []
  const rangePattern = /\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now)\b/gi
  for (const match of text.matchAll(rangePattern)) {
    const start = Number(match[1])
    const end = /^\d/.test(match[2]) ? Number(match[2]) : currentYear
    if (end >= start) ranges.push([start, end])
  }
  ranges.sort((a, b) => a[0] - b[0])

  let dated = 0
  let cursor = -Infinity
  for (const [start, end] of ranges) {
    const from = Math.max(start, cursor)
    if (end > from) dated += end - from
    cursor = Math.max(cursor, end)
  }

  const best = Math.max(explicit ?? 0, dated)
  return explicit === null && ranges.length === 0 ? null : best
}

export function mockAnalyzeResume(resumeText: string): { years_experience: number | null; skills: string[] } {
  return {
    years_experience: mockYearsExperience(resumeText, new Date().getFullYear()),
    skills: KNOWN_SKILLS.filter((skill) => hasSkill(resumeText, skill))
  }
}
