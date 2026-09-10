import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/scoring', () => ({
  scoreMatch: vi.fn().mockResolvedValue({
    score: 82,
    explanation: 'Strong overlap with the required Node.js and TypeScript skills.'
  })
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie } = await createAuthedUser(store, 'admin')
  return { store, app, cookie }
}

describe('POST /api/match', () => {
  it('scores a resume against a job it is attached to and persists the match', async () => {
    const { store, app, cookie } = await setup()

    const job = await store.createJob({
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node.js and TypeScript required'
    })
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      job_id: job.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'Five years of Node.js and TypeScript experience',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', cookie)
      .send({ resume_id: resume.id, job_id: job.id })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      resume_id: resume.id,
      job_id: job.id,
      score: 82,
      explanation: 'Strong overlap with the required Node.js and TypeScript skills.'
    })
  })

  it('returns 400 when the resume is not attached to the job', async () => {
    const { store, app, cookie } = await setup()

    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node.js' })
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', cookie)
      .send({ resume_id: resume.id, job_id: job.id })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('returns 404 when the job does not exist', async () => {
    const { store, app, cookie } = await setup()

    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node.js' })
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      job_id: job.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', cookie)
      .send({ resume_id: resume.id, job_id: 'unknown-job' })

    expect(response.status).toBe(404)
  })

  it('returns 404 when the resume does not exist', async () => {
    const { store, app, cookie } = await setup()

    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node.js' })

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', cookie)
      .send({ resume_id: 'unknown-resume', job_id: job.id })

    expect(response.status).toBe(404)
  })

  it('rejects a missing resume_id', async () => {
    const { store, app, cookie } = await setup()

    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node.js' })

    const response = await request(app).post('/api/match').set('Cookie', cookie).send({ job_id: job.id })

    expect(response.status).toBe(400)
  })
})

describe('GET /api/match/:id', () => {
  it('returns 404 for an unknown match', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/match/unknown-id').set('Cookie', cookie)

    expect(response.status).toBe(404)
  })
})
