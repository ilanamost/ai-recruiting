import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

async function attachedResume(
  store: Store,
  jobId: string,
  overrides: Partial<{ name: string; email: string }> = {}
) {
  const candidate = await store.createCandidate({
    name: overrides.name ?? 'Jane Doe',
    email: overrides.email ?? 'jane@example.com'
  })
  const resume = await store.createResume({
    candidate_id: candidate.id,
    job_id: jobId,
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    content: 'resume text',
    file_data: Buffer.from('%PDF-1.4 fake bytes')
  })
  return resume
}

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie } = await createAuthedUser(store, 'admin')
  return { store, app, cookie }
}

describe('GET /api/job/:jobId/resumes/:resumeId/match', () => {
  it('returns the most recent match for an attached pair with match history', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    // Pin the clock for each createMatch call so ordering is deterministic —
    // two calls made back-to-back in real time could otherwise land in the
    // same millisecond and tie on created_at.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 60, explanation: 'Older, weaker match' })
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'))
    const newer = await store.createMatch({
      resume_id: resume.id,
      job_id: job.id,
      score: 90,
      explanation: 'Newer, stronger match'
    })
    vi.useRealTimers()

    const response = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(newer.id)
    expect(response.body).toMatchObject({
      resume_id: resume.id,
      job_id: job.id,
      score: 90,
      explanation: 'Newer, stronger match'
    })
  })

  it('returns 404 when the pair is not attached', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const response = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`).set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 404 when the pair is attached but no match exists yet', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`).set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 404 for an unknown job', async () => {
    const { store, app, cookie } = await setup()
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const response = await request(app)
      .get(`/api/job/unknown-job/resumes/${resume.id}/match`)
      .set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('GET /api/job/:jobId/matches', () => {
  /**
   * Pins the clock around a single createMatch so created_at ordering is
   * deterministic — back-to-back calls in real time can otherwise land in the
   * same millisecond and tie, which is exactly what "latest match wins" needs
   * to distinguish.
   */
  async function matchAt(store: Store, at: string, input: { job_id: string; resume_id: string; score: number }) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at))
    const match = await store.createMatch({ ...input, explanation: `Scored ${input.score} at ${at}` })
    vi.useRealTimers()
    return match
  }

  it('returns only each resume\'s most recent match for the job', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    const other = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })

    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: resume.id, score: 60 })
    const newer = await matchAt(store, '2026-01-02T00:00:00.000Z', {
      job_id: job.id,
      resume_id: resume.id,
      score: 90
    })
    const otherMatch = await matchAt(store, '2026-01-03T00:00:00.000Z', {
      job_id: job.id,
      resume_id: other.id,
      score: 75
    })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(2)
    expect(response.body.map((match: { id: string }) => match.id).sort()).toEqual([newer.id, otherMatch.id].sort())
    expect(response.body.find((match: { resume_id: string }) => match.resume_id === resume.id)).toMatchObject({
      id: newer.id,
      job_id: job.id,
      score: 90
    })
  })

  it('excludes a resume attached to the job but never scored', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const scored = await attachedResume(store, job.id)
    const unscored = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })

    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: scored.id, score: 60 })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].resume_id).toBe(scored.id)
    expect(response.body.some((match: { resume_id: string }) => match.resume_id === unscored.id)).toBe(false)
  })

  it('excludes matches belonging to a different job', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const otherJob = await store.createJob({ org_id: 'demo-org', title: 'Data Engineer', description: 'SQL' })
    const resume = await attachedResume(store, job.id)

    const forThisJob = await matchAt(store, '2026-01-01T00:00:00.000Z', {
      job_id: job.id,
      resume_id: resume.id,
      score: 60
    })
    await matchAt(store, '2026-01-02T00:00:00.000Z', { job_id: otherJob.id, resume_id: resume.id, score: 95 })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ id: forThisJob.id, job_id: job.id, score: 60 })
  })

  it('returns an empty list when nothing has been scored for the job yet', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    await attachedResume(store, job.id)

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
  })

  it('allows Admin', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
  })

  it('allows Recruiter', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'recruiter')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
  })

  it("forbids Candidate — the route would leak other candidates' scores for the job", async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'candidate')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: resume.id, score: 90 })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  it('returns 404 for an unknown job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/job/unknown-job/matches').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})
