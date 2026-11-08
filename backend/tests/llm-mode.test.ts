import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { createMock, anthropicCtor } = vi.hoisted(() => {
  const createMock = vi.fn()
  const anthropicCtor = vi.fn().mockImplementation(() => ({ messages: { create: createMock } }))
  return { createMock, anthropicCtor }
})

vi.mock('@anthropic-ai/sdk', () => ({ default: anthropicCtor }))

vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi
    .fn()
    .mockResolvedValue('Senior engineer. Worked 2015 - 2021 with Node.js, TypeScript and PostgreSQL on AWS.')
}))

import { assertLlmAvailable, invalidLlmMode, isMockMode } from '../src/lib/llm-mode'
import { scoreMatch } from '../src/scoring'
import { analyzeResume, MAX_SKILLS, MAX_SKILL_LENGTH } from '../src/analysis'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

const JOB = 'We need a Node.js and TypeScript engineer who knows PostgreSQL and Kubernetes.'

function setMode(value: string | undefined) {
  if (value === undefined) delete process.env.LLM_MODE
  else process.env.LLM_MODE = value
}

describe('LLM_MODE=mock', () => {
  const original = process.env.LLM_MODE

  beforeEach(() => {
    createMock.mockReset()
    anthropicCtor.mockClear()
    setMode('mock')
  })

  afterEach(() => {
    setMode(original)
  })

  describe('isMockMode / assertValidLlmMode', () => {
    it('is true only for mock', () => {
      expect(isMockMode()).toBe(true)
      setMode('live')
      expect(isMockMode()).toBe(false)
      setMode(undefined)
      expect(isMockMode()).toBe(false)
    })

    it('accepts unset, live and mock', () => {
      for (const value of [undefined, '', 'live', 'mock']) {
        setMode(value)
        expect(invalidLlmMode()).toBeNull()
        expect(() => assertLlmAvailable()).not.toThrow()
      }
    })

    it('flags an invalid value and refuses LLM work with a 503, instead of crashing', () => {
      setMode('mok')
      expect(invalidLlmMode()).toBe('mok')
      expect(() => assertLlmAvailable()).toThrow(/temporarily unavailable/)
    })

    it('scoring and analysis refuse (never fall through to the SDK) while LLM_MODE is invalid', async () => {
      setMode('mok')
      await expect(scoreMatch(JOB, 'resume')).rejects.toMatchObject({ status: 503 })
      await expect(analyzeResume('resume')).rejects.toMatchObject({ status: 503 })
      expect(anthropicCtor).not.toHaveBeenCalled()
    })
  })

  describe('scoreMatch', () => {
    it('returns an integer 0-100 score and a non-empty explanation without calling the SDK', async () => {
      const result = await scoreMatch(JOB, 'Node.js developer with TypeScript')

      expect(Number.isInteger(result.score)).toBe(true)
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
      expect(result.explanation.length).toBeGreaterThan(0)
      expect(result.explanation.startsWith('[Mock]')).toBe(true)
      expect(anthropicCtor).not.toHaveBeenCalled()
      expect(createMock).not.toHaveBeenCalled()
    })

    it('is deterministic', async () => {
      const first = await scoreMatch(JOB, 'Node.js developer with TypeScript')
      const second = await scoreMatch(JOB, 'Node.js developer with TypeScript')
      expect(second).toEqual(first)
    })

    it('scores a resume containing the job keywords higher than one with none', async () => {
      const strong = await scoreMatch(JOB, 'Node.js TypeScript PostgreSQL Kubernetes engineer')
      const weak = await scoreMatch(JOB, 'Pastry chef, bakery manager, croissants')
      expect(strong.score).toBeGreaterThan(weak.score)
      expect(weak.score).toBe(0)
      expect(strong.explanation).toContain('kubernetes')
    })

    it('gives a well-matched resume a high score against a long, prose-heavy job description', async () => {
      const job = [
        'About the Role. We are looking for a talented Frontend Developer to build responsive, scalable',
        'and user-friendly web applications. You will work closely with designers, backend engineers and QA.',
        'Develop and maintain modern web applications using JavaScript/TypeScript and frameworks such as',
        'React, Vue.js or Angular. Build reusable, maintainable and well-tested UI components. Optimize',
        'applications for performance. Integrate RESTful APIs. Contribute to automated testing with Jest.',
        'Required: 3+ years of professional frontend development experience. Strong HTML5, CSS3, ES6+.'
      ].join(' ')
      const resume = [
        'Senior Frontend Developer. 8 years building responsive, scalable web applications with Vue.js,',
        'React and Angular in TypeScript and JavaScript (ES6+). Built reusable, maintainable UI components,',
        'optimized application performance, integrated REST APIs, wrote Jest tests. HTML5, CSS3, SCSS.',
        'Worked closely with designers, backend engineers and QA to deliver user-friendly applications.'
      ].join(' ')

      const result = await scoreMatch(job, resume)
      expect(result.score).toBeGreaterThanOrEqual(70)
      expect(result.explanation).toContain('react')
    })

    it('explains an empty resume (no extractable text) instead of reporting "0 of N"', async () => {
      const result = await scoreMatch(JOB, '')
      expect(result.score).toBe(0)
      expect(result.explanation.startsWith('[Mock]')).toBe(true)
      expect(result.explanation).toContain('No text could be extracted')
    })

    it('scores 0 for a job description with no keywords', async () => {
      const result = await scoreMatch('', 'anything at all')
      expect(result.score).toBe(0)
    })
  })

  describe('analyzeResume', () => {
    it('returns normalized skills and years without calling the SDK', async () => {
      const result = await analyzeResume('Worked 2015 - 2021 with Node.js, TypeScript and PostgreSQL. Also Go.')

      expect(result.years_experience).toBe(6)
      expect(result.skills).toEqual(expect.arrayContaining(['node.js', 'typescript', 'postgresql', 'go']))
      expect(result.skills.length).toBeLessThanOrEqual(MAX_SKILLS)
      expect(new Set(result.skills).size).toBe(result.skills.length)
      for (const skill of result.skills) {
        expect(skill).toBe(skill.toLowerCase())
        expect(skill.length).toBeLessThanOrEqual(MAX_SKILL_LENGTH)
      }
      expect(anthropicCtor).not.toHaveBeenCalled()
      expect(createMock).not.toHaveBeenCalled()
    })

    it('reads years from an "N years" phrase', async () => {
      const result = await analyzeResume('8 years of experience building web apps')
      expect(result.years_experience).toBe(8)
    })

    it('counts overlapping dated ranges once', async () => {
      const result = await analyzeResume('2010 - 2014 Acme. 2012 - 2016 Globex.')
      expect(result.years_experience).toBe(6)
    })

    it('returns null, not 0, when there is no dated history', async () => {
      const result = await analyzeResume('Enthusiastic graduate who knows Python')
      expect(result.years_experience).toBeNull()
      expect(result.skills).toEqual(['python'])
    })

    it('does not match a skill inside a longer word', async () => {
      const result = await analyzeResume('Used django and javascripting daily; went to the gopher meetup')
      expect(result.skills).toEqual(['django'])
    })

    it('is deterministic', async () => {
      const text = '5 years with React and Docker'
      expect(await analyzeResume(text)).toEqual(await analyzeResume(text))
    })
  })

  describe('integration: invalid LLM_MODE keeps the API up', () => {
    it('serves health and uploads (unclassified) but answers match with 503', async () => {
      setMode('mok')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = createMemoryStore()
      const app = createApp(store)
      const { cookie } = await createAuthedUser(store, 'admin')
      const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: JOB })

      expect((await request(app).get('/api/health')).status).toBe(200)

      const upload = await request(app)
        .post('/api/resume')
        .set('Cookie', cookie)
        .field('name', 'Jane Doe')
        .field('email', 'jane@example.com')
        .field('job_id', job.id)
        .attach('file', Buffer.from('%PDF-1.4 fake resume bytes'), {
          filename: 'resume.pdf',
          contentType: 'application/pdf'
        })
      expect(upload.status).toBe(201)
      expect(upload.body.years_experience).toBeNull()
      expect(upload.body.skills).toEqual([])

      const match = await request(app)
        .post('/api/match')
        .set('Cookie', cookie)
        .send({ resume_id: upload.body.id, job_id: job.id })
      expect(match.status).toBe(503)
      expect(match.body.error.code).toBe('service_unavailable')
    })
  })

  describe('integration: upload, attach, match', () => {
    it('creates a persisted mock match and lists mock-derived skills and experience', async () => {
      const store = createMemoryStore()
      const app = createApp(store)
      const { cookie } = await createAuthedUser(store, 'admin')
      const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: JOB })

      const upload = await request(app)
        .post('/api/resume')
        .set('Cookie', cookie)
        .field('name', 'Jane Doe')
        .field('email', 'jane@example.com')
        .field('job_id', job.id)
        .attach('file', Buffer.from('%PDF-1.4 fake resume bytes'), {
          filename: 'resume.pdf',
          contentType: 'application/pdf'
        })

      expect(upload.status).toBe(201)
      expect(upload.body.years_experience).toBe(6)
      expect(upload.body.skills).toEqual(expect.arrayContaining(['node.js', 'typescript', 'postgresql', 'aws']))

      const match = await request(app)
        .post('/api/match')
        .set('Cookie', cookie)
        .send({ resume_id: upload.body.id, job_id: job.id })

      expect(match.status).toBe(201)
      expect(match.body.explanation.length).toBeGreaterThan(0)
      expect(match.body.explanation.startsWith('[Mock]')).toBe(true)
      expect(match.body.score).toBeGreaterThan(0)

      const fetched = await request(app).get(`/api/match/${match.body.id}`).set('Cookie', cookie)
      expect(fetched.status).toBe(200)
      expect(fetched.body.id).toBe(match.body.id)

      const list = await request(app).get('/api/resume').set('Cookie', cookie)
      const listed = list.body.items.find((r: { id: string }) => r.id === upload.body.id)
      expect(listed.years_experience).toBe(6)
      expect(listed.skills).toContain('typescript')

      expect(anthropicCtor).not.toHaveBeenCalled()
    })
  })

  describe('live mode', () => {
    it('still calls the SDK when LLM_MODE is live', async () => {
      setMode('live')
      createMock.mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ score: 77, explanation: 'Real.' }) }]
      })

      const result = await scoreMatch(JOB, 'resume')

      expect(result).toEqual({ score: 77, explanation: 'Real.' })
      expect(createMock).toHaveBeenCalledTimes(1)
    })
  })
})
