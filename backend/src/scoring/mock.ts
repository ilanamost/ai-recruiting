import type { ScoreResult } from './index'

/**
 * Deterministic scorer used when LLM_MODE=mock. It approximates how a recruiter
 * reads a resume against a job: the technologies and tools the job names matter
 * most, general vocabulary matters a little, and coverage is mapped onto a
 * 0-100 scale where covering most of the stack reads as a strong match.
 */

// Words that carry no signal about fit.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'have', 'has', 'from', 'that', 'this',
  'who', 'they', 'their', 'your', 'can', 'able', 'work', 'working', 'team', 'role', 'job', 'must',
  'should', 'about', 'into', 'such', 'more', 'than', 'also', 'etc', 'including', 'experience',
  'years', 'year', 'strong', 'good', 'great', 'new', 'all', 'any', 'use', 'using', 'build',
  'building', 'looking', 'join', 'company', 'candidate', 'responsibilities', 'requirements',
  'qualifications', 'required', 'preferred', 'plus', 'nice', 'description', 'bachelor', 'degree',
  'equivalent', 'practical', 'professional', 'closely', 'provide', 'deliver', 'high', 'quality',
  'well', 'ability', 'knowledge', 'understanding', 'proficiency', 'familiarity', 'excellent',
  'skills', 'skill', 'tools', 'such', 'other', 'like', 'etc', 'up', 'date', 'stay', 'help',
  'make', 'need', 'needs', 'across', 'within', 'between', 'while', 'when', 'where', 'which',
  'what', 'how', 'why', 'each', 'both', 'either', 'one', 'two', 'three', 'four', 'five', 'per',
  'role', 'position', 'opportunity', 'talented', 'exceptional', 'modern', 'best', 'practices'
])

// Normalizes spelling variants of the same technology to one canonical token.
const ALIASES: Record<string, string> = {
  'vue.js': 'vue', vuejs: 'vue', 'react.js': 'react', reactjs: 'react', 'angular.js': 'angular',
  angularjs: 'angular', 'node.js': 'node', nodejs: 'node', 'next.js': 'next', nextjs: 'next',
  'nuxt.js': 'nuxt', 'express.js': 'express', expressjs: 'express', js: 'javascript',
  ts: 'typescript', html5: 'html', css3: 'css', es6: 'javascript', 'es6+': 'javascript',
  postgres: 'postgresql', k8s: 'kubernetes', golang: 'go', 'ci/cd': 'cicd', restful: 'rest',
  scss: 'sass', 'vuex': 'vuex', 'ux': 'ux', 'ui': 'ui'
}

// Technologies, tools and practices. A job keyword in this set is a "skill".
const TECH_TERMS = new Set([
  'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'ruby', 'php', 'c#', 'c++', 'sql',
  'swift', 'kotlin', 'scala', 'react', 'vue', 'angular', 'svelte', 'node', 'express', 'django',
  'flask', 'spring', 'next', 'nuxt', 'nest', 'html', 'css', 'sass', 'less', 'tailwind',
  'bootstrap', 'graphql', 'rest', 'api', 'apis', 'grpc', 'postgresql', 'mysql', 'mongodb',
  'redis', 'elasticsearch', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform',
  'ansible', 'jenkins', 'git', 'github', 'gitlab', 'cicd', 'linux', 'redux', 'rxjs', 'ngrx',
  'pinia', 'vuex', 'webpack', 'vite', 'babel', 'npm', 'yarn', 'jest', 'vitest', 'mocha',
  'cypress', 'playwright', 'selenium', 'storybook', 'figma', 'sketch', 'jira', 'agile', 'scrum',
  'kafka', 'rabbitmq', 'microservices', 'serverless', 'oauth', 'jwt', 'websocket', 'pwa',
  'accessibility', 'a11y', 'responsive', 'seo', 'ux', 'ui', 'tdd', 'ssr', 'spa', 'testing',
  'unit', 'e2e', 'mobile', 'ios', 'android', 'flutter', 'dotnet', '.net', 'laravel', 'rails',
  'machine', 'learning', 'pytorch', 'tensorflow', 'pandas', 'numpy', 'spark', 'hadoop',
  'tableau', 'excel', 'sap', 'salesforce'
])

const MAX_LISTED = 10
// Share of coverage driven by named technologies; the rest is the job's general vocabulary,
// which tracks domain fit well (a backend job and a frontend CV share little of it).
const SKILL_WEIGHT = 0.35

function canonical(raw: string): string {
  let token = raw.replace(/\.+$/, '')
  if (ALIASES[token]) return ALIASES[token]
  // Never stem a known technology name ("kubernetes", "aws", "redis" end in "s").
  if (TECH_TERMS.has(token)) return token
  // Light stemming so "frameworks"/"framework" and "testing"/"tested" line up.
  if (token.length > 5 && token.endsWith('ing')) token = token.slice(0, -3)
  else if (token.length > 4 && token.endsWith('ed')) token = token.slice(0, -2)
  else if (token.length > 4 && token.endsWith('es')) token = token.slice(0, -2)
  else if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) token = token.slice(0, -1)
  return ALIASES[token] ?? token
}

function keywords(text: string): string[] {
  // Split "JavaScript/TypeScript" style lists, keep "node.js", "c#", "c++", "es6+".
  const tokens = text.toLowerCase().replace(/\//g, ' ').match(/[a-z0-9][a-z0-9+#.]*/g) ?? []
  const seen = new Set<string>()
  for (const raw of tokens) {
    const token = canonical(raw)
    if (token.length < 2 || STOPWORDS.has(token) || /^\d+\+?$/.test(token)) continue
    if (token.length < 3 && !TECH_TERMS.has(token)) continue
    seen.add(token)
  }
  return [...seen]
}

/**
 * Maps raw coverage (0-1) onto a recruiter-like scale by piecewise-linear
 * interpolation. Job descriptions are long and prose-heavy, so even a strong
 * resume covers only about half of their terms: 0.25 coverage is a weak match
 * (20), 0.5 and above is a full match (100).
 */
const CURVE: Array<[number, number]> = [[0, 0], [0.25, 20], [0.5, 100]]

function curve(coverage: number): number {
  const c = Math.min(1, Math.max(0, coverage))
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i]
    if (c <= x1) {
      const [x0, y0] = CURVE[i - 1]
      return y0 + ((c - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return 100
}

export function mockScoreMatch(jobDescription: string, resumeText: string): ScoreResult {
  const jobKeywords = keywords(jobDescription)
  const resumeKeywords = new Set(keywords(resumeText))

  // A resume with no extractable text (e.g. a scanned / image-only PDF) cannot
  // overlap with anything - say so, rather than reporting a misleading "0 of N".
  if (resumeKeywords.size === 0) {
    return {
      score: 0,
      explanation:
        '[Mock] No text could be extracted from this resume (it may be a scanned or image-only PDF), ' +
        'so it cannot be scored. Upload a PDF with selectable text.'
    }
  }

  const jobSkills = jobKeywords.filter((word) => TECH_TERMS.has(word))
  const jobOther = jobKeywords.filter((word) => !TECH_TERMS.has(word))

  const matchedSkills = jobSkills.filter((word) => resumeKeywords.has(word))
  const missingSkills = jobSkills.filter((word) => !resumeKeywords.has(word))
  const matchedOther = jobOther.filter((word) => resumeKeywords.has(word))

  const skillCoverage = jobSkills.length === 0 ? 0 : matchedSkills.length / jobSkills.length
  const otherCoverage = jobOther.length === 0 ? 0 : matchedOther.length / jobOther.length

  // A job that names no recognizable technologies is scored on vocabulary alone.
  const coverage =
    jobSkills.length === 0
      ? otherCoverage
      : jobOther.length === 0
        ? skillCoverage
        : SKILL_WEIGHT * skillCoverage + (1 - SKILL_WEIGHT) * otherCoverage

  const score = jobKeywords.length === 0 ? 0 : Math.min(100, Math.max(0, Math.round(curve(coverage))))

  const list = (words: string[]) => (words.length === 0 ? 'none' : words.slice(0, MAX_LISTED).join(', '))
  const explanation =
    `[Mock] Matched ${matchedSkills.length} of ${jobSkills.length} technologies and skills the job names, ` +
    `and ${matchedOther.length} of ${jobOther.length} other job terms. ` +
    `Matching skills: ${list(matchedSkills)}. Missing skills: ${list(missingSkills)}.`

  return { score, explanation }
}
