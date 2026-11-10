import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

async function pair(ownerId: string | null = null) {
  const store = createMemoryStore()
  const app = createApp(store)
  const job = await store.createJob({ org_id: 'demo-org', title: 'BE', description: 'Node' })
  const candidate = await store.createCandidate({ name: 'Jane', email: 'j@example.com' })
  const resume = await store.createResume({
    candidate_id: candidate.id,
    job_id: job.id,
    file_name: 'r.pdf',
    mime_type: 'application/pdf',
    content: 'text',
    file_data: Buffer.from('%PDF'),
    owner_user_id: ownerId
  })
  return { store, app, job, resume }
}

describe('QA: 204 no-match over real HTTP (.plan/041)', () => {
  it('204 has no body, no content-type, and no non-zero content-length', async () => {
    const { store, app, job, resume } = await pair()
    const { cookie } = await createAuthedUser(store, 'recruiter')
    const res = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`).set('Cookie', cookie)
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(res.headers['content-type']).toBeUndefined()
    expect(res.headers['content-length'] ?? '0').toBe('0')
    expect(res.headers['transfer-encoding']).toBeUndefined()
  })

  it('unauthenticated request is 401, never 204', async () => {
    const { app, job, resume } = await pair()
    const res = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`)
    expect(res.status).toBe(401)
  })

  it('candidate: own resume 204, another candidate resume 403 on the no-match path', async () => {
    const store = createMemoryStore()
    const app = createApp(store)
    const mine = await createAuthedUser(store, 'candidate')
    const other = await createAuthedUser(store, 'candidate')
    const job = await store.createJob({ org_id: 'demo-org', title: 'BE', description: 'Node' })
    const candidate = await store.createCandidate({ name: 'Jane', email: 'j@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      job_id: job.id,
      file_name: 'r.pdf',
      mime_type: 'application/pdf',
      content: 'text',
      file_data: Buffer.from('%PDF'),
      owner_user_id: mine.user.id
    })
    const url = `/api/job/${job.id}/resumes/${resume.id}/match`
    expect((await request(app).get(url).set('Cookie', mine.cookie)).status).toBe(204)
    const forbidden = await request(app).get(url).set('Cookie', other.cookie)
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.error.code).toBe('forbidden')
  })

  it('candidate with null-owner resume gets 403 on the no-match path', async () => {
    const { store, app, job, resume } = await pair(null)
    const { cookie } = await createAuthedUser(store, 'candidate')
    const res = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`).set('Cookie', cookie)
    expect(res.status).toBe(403)
  })

  it('swapped / malformed ids and odd characters still 404, never 204', async () => {
    const { store, app, job, resume } = await pair()
    const { cookie } = await createAuthedUser(store, 'admin')
    for (const path of [
      `/api/job/${resume.id}/resumes/${job.id}/match`,
      `/api/job/${job.id}/resumes/%20/match`,
      `/api/job/${job.id}/resumes/${'x'.repeat(5000)}/match`,
      `/api/job/${job.id}/resumes/..%2F${resume.id}/match`
    ]) {
      const res = await request(app).get(path).set('Cookie', cookie)
      expect(res.status, path.slice(0, 60)).toBe(404)
    }
  })

  it('after a match is created the same pair flips from 204 to 200 (no stale empty state)', async () => {
    const { store, app, job, resume } = await pair()
    const { cookie } = await createAuthedUser(store, 'admin')
    const url = `/api/job/${job.id}/resumes/${resume.id}/match`
    expect((await request(app).get(url).set('Cookie', cookie)).status).toBe(204)
    const m = await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'x' })
    const res = await request(app).get(url).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(m.id)
  })

  it('detached pair that previously had a match is 404, not 204', async () => {
    const { store, app, job, resume } = await pair()
    const { cookie } = await createAuthedUser(store, 'admin')
    await store.detachResumeFromJob(job.id, resume.id)
    const res = await request(app).get(`/api/job/${job.id}/resumes/${resume.id}/match`).set('Cookie', cookie)
    expect(res.status).toBe(404)
  })
})
