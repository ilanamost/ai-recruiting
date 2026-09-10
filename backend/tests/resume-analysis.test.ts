import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// Both mock factories run before this file's top-level consts initialize
// (vi.mock is hoisted), so anything they close over has to come from
// vi.hoisted. RESUME_TEXT is deliberately PII-shaped: the "logs no resume
// text" test below asserts this exact string never reaches console.error when
// the analysis call fails.
const { RESUME_TEXT, analyzeResumeMock } = vi.hoisted(() => ({
  RESUME_TEXT: 'Ada Lovelace, ada@example.com — 9 years of Node.js and PostgreSQL work',
  analyzeResumeMock: vi.fn()
}))

vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi.fn().mockResolvedValue(RESUME_TEXT)
}))

vi.mock('../src/analysis', () => ({
  analyzeResume: analyzeResumeMock
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

/**
 * Covers the analysis step wired into the upload path by
 * .plan/029-2026-09-07-cv-recruiter-filter.md, and the two hard promises the
 * shared contract (.orchestrate/api-contract.yaml) makes to the recruiter
 * filter UI:
 *
 *   1. `years_experience` is nullable, and null means "unclassified" — never 0.
 *   2. `skills` is always an array — never null and never an absent field.
 *
 * The Claude call is mocked in every test here; no test may reach the live API.
 */

const PDF = Buffer.from('%PDF-1.4 fake resume bytes')

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie } = await createAuthedUser(store, 'admin')
  return { store, app, cookie }
}

function uploadResume(app: ReturnType<typeof createApp>, cookie: string, job_id?: string) {
  const pending = request(app)
    .post('/api/resume')
    .set('Cookie', cookie)
    .field('name', 'Ada Lovelace')
    .field('email', 'ada@example.com')

  if (job_id) pending.field('job_id', job_id)

  return pending.attach('file', PDF, { filename: 'ada.pdf', contentType: 'application/pdf' })
}

beforeEach(() => {
  analyzeResumeMock.mockReset()
  analyzeResumeMock.mockResolvedValue({ years_experience: 9, skills: ['node', 'postgres'] })
})

describe('POST /api/resume — analysis on upload', () => {
  it('persists and returns the analyzed years and skills', async () => {
    const { app, cookie } = await setup()

    const response = await uploadResume(app, cookie)

    expect(response.status).toBe(201)
    expect(response.body.years_experience).toBe(9)
    expect(response.body.skills).toEqual(['node', 'postgres'])
    expect(analyzeResumeMock).toHaveBeenCalledWith(RESUME_TEXT)
  })

  it('returns skills as [] rather than null for a CV with no skills', async () => {
    const { app, cookie } = await setup()
    analyzeResumeMock.mockResolvedValue({ years_experience: 2, skills: [] })

    const response = await uploadResume(app, cookie)

    expect(response.status).toBe(201)
    expect(response.body.skills).toEqual([])
    expect(response.body.skills).not.toBeNull()
  })

  it('returns years_experience as null, not 0, for a CV with no dated work history', async () => {
    const { app, cookie } = await setup()
    analyzeResumeMock.mockResolvedValue({ years_experience: null, skills: ['react'] })

    const response = await uploadResume(app, cookie)

    expect(response.status).toBe(201)
    expect(response.body.years_experience).toBeNull()
    expect(response.body.years_experience).not.toBe(0)
  })
})

describe('POST /api/resume — a failed analysis never fails the upload', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  // Each of these is a real failure mode of the upload path: no API key
  // configured, the model refusing, and a malformed provider response.
  const failures: [string, Error][] = [
    ['no API key is configured', new Error('The ANTHROPIC_API_KEY environment variable is missing or empty')],
    ['the model refuses the request', new Error('The analysis model declined to process this request')],
    ['the model returns a malformed response', new Error('The analysis model returned invalid JSON')]
  ]

  for (const [label, error] of failures) {
    it(`still returns 201 with an unclassified CV when ${label}`, async () => {
      const { app, cookie } = await setup()
      analyzeResumeMock.mockRejectedValue(error)

      const response = await uploadResume(app, cookie)

      expect(response.status).toBe(201)
      expect(response.body.years_experience).toBeNull()
      expect(response.body.skills).toEqual([])
      // The rest of the upload is untouched — this is a complete CV, just an
      // unclassified one.
      expect(response.body.content).toBe(RESUME_TEXT)
      expect(response.body.candidate_name).toBe('Ada Lovelace')
    })
  }

  it('logs the failure without the resume text (PII)', async () => {
    const { app, cookie } = await setup()
    analyzeResumeMock.mockRejectedValue(new Error('upstream exploded'))

    await uploadResume(app, cookie)

    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(logged).not.toContain(RESUME_TEXT)
    expect(logged).not.toContain('ada@example.com')
    // Still debuggable: the operation and the provider's message are recorded.
    expect(logged).toContain('resume.upload')
    expect(logged).toContain('upstream exploded')
  })
})

// The exact contract the recruiter filter UI reads from: the modal fetches
// this route and filters its rows client-side, so both fields must ride along
// on every row here.
describe('GET /api/job/:id/resumes — the fields the filter UI reads', () => {
  it('returns years_experience and skills on every attached CV', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node and TypeScript'
    })

    analyzeResumeMock.mockResolvedValue({ years_experience: 9, skills: ['node', 'postgres'] })
    await uploadResume(app, cookie, job.id)
    analyzeResumeMock.mockResolvedValue({ years_experience: null, skills: [] })
    await uploadResume(app, cookie, job.id)

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(2)
    for (const row of response.body) {
      expect(row).toHaveProperty('years_experience')
      expect(row).toHaveProperty('skills')
      expect(Array.isArray(row.skills)).toBe(true)
      expect(row).toHaveProperty('attached_at')
    }

    const analyzed = response.body.find((row: { years_experience: number | null }) => row.years_experience !== null)
    const unclassified = response.body.find(
      (row: { years_experience: number | null }) => row.years_experience === null
    )
    expect(analyzed.years_experience).toBe(9)
    expect(analyzed.skills).toEqual(['node', 'postgres'])
    expect(unclassified.skills).toEqual([])
  })

  it('returns the same two fields on the other resume read paths', async () => {
    const { app, cookie } = await setup()

    const created = await uploadResume(app, cookie)

    const byId = await request(app).get(`/api/resume/${created.body.id}`).set('Cookie', cookie)
    expect(byId.body.years_experience).toBe(9)
    expect(byId.body.skills).toEqual(['node', 'postgres'])

    const list = await request(app).get('/api/resume').set('Cookie', cookie)
    expect(list.body.items[0].years_experience).toBe(9)
    expect(list.body.items[0].skills).toEqual(['node', 'postgres'])
  })
})

describe('PUT /api/resume/:id/file — re-analysis on replace', () => {
  it("re-analyzes the new file and drops the previous file's skills", async () => {
    const { app, cookie } = await setup()
    const created = await uploadResume(app, cookie)
    expect(created.body.skills).toEqual(['node', 'postgres'])

    analyzeResumeMock.mockResolvedValue({ years_experience: 2, skills: ['figma'] })

    const response = await request(app)
      .put(`/api/resume/${created.body.id}/file`)
      .set('Cookie', cookie)
      .attach('file', PDF, { filename: 'ada-v2.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(created.body.id)
    expect(response.body.years_experience).toBe(2)
    expect(response.body.skills).toEqual(['figma'])
    expect(response.body.skills).not.toContain('node')
    expect(response.body.skills).not.toContain('postgres')
  })

  it("leaves the CV unclassified — not described by the old file — when the re-analysis fails", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { app, cookie } = await setup()
      const created = await uploadResume(app, cookie)

      analyzeResumeMock.mockRejectedValue(new Error('upstream exploded'))

      const response = await request(app)
        .put(`/api/resume/${created.body.id}/file`)
        .set('Cookie', cookie)
        .attach('file', PDF, { filename: 'ada-v2.pdf', contentType: 'application/pdf' })

      expect(response.status).toBe(200)
      expect(response.body.years_experience).toBeNull()
      expect(response.body.skills).toEqual([])

      const logged = errorSpy.mock.calls.map((call) => JSON.stringify(call)).join('\n')
      expect(logged).not.toContain(RESUME_TEXT)
      expect(logged).toContain('resume.replaceFile')
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('DELETE /api/resume/:id — a deleted CV takes its skills with it', () => {
  // pg-store leans on resume_skill.resume_id's `on delete cascade` for this
  // (pinned separately in tests/schema.test.ts); memory-store must behave the
  // same way, so a re-created resume never inherits a deleted one's skills.
  it('leaves no skills behind for the deleted resume', async () => {
    const { store, app, cookie } = await setup()
    const created = await uploadResume(app, cookie)

    const response = await request(app).delete(`/api/resume/${created.body.id}`).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(await store.getResume(created.body.id)).toBeNull()

    const list = await request(app).get('/api/resume').set('Cookie', cookie)
    expect(list.body.items).toHaveLength(0)
  })
})

describe('store: the two fields on a resume created without an analysis', () => {
  // Every pre-.plan/029 caller (and the seed/test helpers) creates a resume
  // with no years and no skills. That must read back as unclassified, not as
  // undefined fields the frontend has to defend against.
  it('reads back as null years and an empty skills array', async () => {
    const store: Store = createMemoryStore()
    const candidate = await store.createCandidate({ name: 'Grace Hopper', email: 'grace@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'grace.pdf',
      mime_type: 'application/pdf',
      content: 'career changer',
      file_data: PDF
    })

    expect(resume.years_experience).toBeNull()
    expect(resume.skills).toEqual([])

    const read = await store.getResume(resume.id)
    expect(read?.years_experience).toBeNull()
    expect(read?.skills).toEqual([])
  })

  it('does not let a caller mutate the stored skills through a returned array', async () => {
    const store: Store = createMemoryStore()
    const candidate = await store.createCandidate({ name: 'Ada', email: 'ada@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'ada.pdf',
      mime_type: 'application/pdf',
      content: RESUME_TEXT,
      file_data: PDF,
      years_experience: 9,
      skills: ['node']
    })

    const first = await store.getResume(resume.id)
    first!.skills.push('injected')

    const second = await store.getResume(resume.id)
    expect(second?.skills).toEqual(['node'])
  })
})
