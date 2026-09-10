import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// QA adversarial pass on .plan/029-2026-09-07-cv-recruiter-filter.md.
//
// tests/resume-analysis.test.ts mocks `../src/analysis` wholesale, so the real analyzeResume has
// never actually run on the upload path — the "a failed analysis never fails the upload"
// guarantee is proven there against a stub that rejects on command. This file removes that stub
// and exercises routes/resume.ts -> src/analysis -> the Anthropic SDK as one chain, with the SDK
// itself failing the way it would in production:
//
//   - no API key configured (the SDK throws in its constructor, before any request)
//   - the provider unreachable (a transport rejection)
//   - the provider overloaded (a 529-shaped rejection)
//   - a model refusal and a malformed response (guarded inside analyzeResume)
//
// Every one must still yield 201 with an unclassified CV, and must never log resume text.

const { RESUME_TEXT, createMock, constructorMock } = vi.hoisted(() => ({
  // Deliberately PII-shaped: the logging assertions below check this exact string never reaches
  // console.error.
  RESUME_TEXT: 'Grace Hopper, grace@example.com — 12 years of COBOL and compiler work',
  createMock: vi.fn(),
  constructorMock: vi.fn()
}))

vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi.fn().mockResolvedValue(RESUME_TEXT)
}))

// The SDK, not the analysis module — so src/analysis/index.ts runs for real.
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => {
    constructorMock()
    return { messages: { create: createMock } }
  })
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

const PDF = Buffer.from('%PDF-1.4 fake resume bytes')

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie } = await createAuthedUser(store, 'admin')
  return { store, app, cookie }
}

function uploadResume(app: ReturnType<typeof createApp>, cookie: string) {
  return request(app)
    .post('/api/resume')
    .set('Cookie', cookie)
    .field('name', 'Grace Hopper')
    .field('email', 'grace@example.com')
    .attach('file', PDF, { filename: 'grace.pdf', contentType: 'application/pdf' })
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  createMock.mockReset()
  constructorMock.mockReset()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
})

// Every rejection an unreachable or unhappy provider can produce, plus the two shape failures
// analyzeResume guards internally.
const providerFailures: [string, () => void][] = [
  [
    'the SDK cannot be constructed (no API key)',
    () => {
      constructorMock.mockImplementation(() => {
        throw new Error('The ANTHROPIC_API_KEY environment variable is missing or empty')
      })
    }
  ],
  [
    'the provider is unreachable',
    () => {
      createMock.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' }))
    }
  ],
  [
    'the provider is overloaded',
    () => {
      createMock.mockRejectedValue(Object.assign(new Error('Overloaded'), { status: 529 }))
    }
  ],
  [
    'the request times out',
    () => {
      createMock.mockRejectedValue(Object.assign(new Error('Request timed out'), { name: 'APIConnectionTimeoutError' }))
    }
  ],
  [
    'the model refuses',
    () => {
      createMock.mockResolvedValue({ stop_reason: 'refusal', content: [] })
    }
  ],
  [
    'the model returns unparseable text',
    () => {
      createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json at all' }] })
    }
  ],
  [
    'the model returns no text block',
    () => {
      createMock.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '…' }] })
    }
  ]
]

describe('POST /api/resume — the real analysis chain degrades instead of failing the upload', () => {
  for (const [label, arrange] of providerFailures) {
    it(`returns 201 with an unclassified CV when ${label}`, async () => {
      arrange()
      const { app, cookie } = await setup()

      const response = await uploadResume(app, cookie)

      expect(response.status).toBe(201)
      // null means "unclassified" — the off-by-null bug this feature is most exposed to would
      // show up here as a 0, silently filing every unanalyzable CV under Junior.
      expect(response.body.years_experience).toBeNull()
      expect(response.body.years_experience).not.toBe(0)
      expect(response.body.skills).toEqual([])
    })

    it(`logs no resume text when ${label}`, async () => {
      arrange()
      const { app, cookie } = await setup()

      await uploadResume(app, cookie)

      const logged = JSON.stringify(errorSpy.mock.calls)
      expect(logged).not.toContain(RESUME_TEXT)
      expect(logged).not.toContain('COBOL')
      expect(logged).not.toContain('grace@example.com')
    })
  }

  // The CV still has to be readable and attachable afterwards — "unclassified" must mean a
  // normal CV missing two fields, not a half-written row.
  it('leaves the unclassified CV fully usable on the read paths the modal uses', async () => {
    createMock.mockRejectedValue(new Error('Overloaded'))
    const { app, cookie } = await setup()

    const upload = await uploadResume(app, cookie)
    expect(upload.status).toBe(201)
    const resumeId = upload.body.id as string

    const job = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node', location: 'Berlin' })
    expect(job.status).toBe(201)

    const attach = await request(app)
      .post(`/api/job/${job.body.id}/resumes`)
      .set('Cookie', cookie)
      .send({ resume_id: resumeId })
    expect(attach.status).toBeLessThan(300)

    const attached = await request(app).get(`/api/job/${job.body.id}/resumes`).set('Cookie', cookie)
    expect(attached.status).toBe(200)
    expect(attached.body).toHaveLength(1)
    expect(attached.body[0]).toMatchObject({ id: resumeId, years_experience: null, skills: [] })
  })
})

describe('POST /api/resume — the real analysis chain on a successful call', () => {
  function modelReturns(payload: unknown) {
    createMock.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(payload) }]
    })
  }

  // End to end: the normalization the frontend depends on (lowercase, trimmed, de-duplicated)
  // must survive the route and the store, not just the analysis module's unit test. The frontend
  // matches these strings EXACTLY and only capitalizes for display, so a stray 'React' next to
  // 'react' would render two chips each matching half the CVs.
  it('persists and returns skills already normalized for exact frontend matching', async () => {
    modelReturns({ years_experience: 7, skills: ['  React  ', 'react', 'TypeScript', 'REACT'] })
    const { app, cookie } = await setup()

    const response = await uploadResume(app, cookie)

    expect(response.status).toBe(201)
    expect(response.body.skills).toEqual(['react', 'typescript'])
    expect(response.body.years_experience).toBe(7)
  })

  // A genuine zero must survive as zero all the way to the response: it is Junior, not
  // unclassified, and the two are only distinguishable if 0 is never turned into null.
  it('keeps a genuine 0 years as 0 rather than collapsing it to null', async () => {
    modelReturns({ years_experience: 0, skills: [] })
    const { app, cookie } = await setup()

    const response = await uploadResume(app, cookie)

    expect(response.status).toBe(201)
    expect(response.body.years_experience).toBe(0)
    expect(response.body.years_experience).not.toBeNull()
  })

  // Analysis runs on write only. Reading the same CV back must not cost a second Claude call —
  // that is the cost/latency assumption the plan's Scope leans on.
  it('makes exactly one Claude call per upload and none on any read', async () => {
    modelReturns({ years_experience: 4, skills: ['node'] })
    const { app, cookie } = await setup()

    const upload = await uploadResume(app, cookie)
    expect(createMock).toHaveBeenCalledTimes(1)

    await request(app).get(`/api/resume/${upload.body.id}`).set('Cookie', cookie)
    await request(app).get('/api/resume').set('Cookie', cookie)

    expect(createMock).toHaveBeenCalledTimes(1)
  })
})
