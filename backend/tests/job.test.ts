import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

async function attachedResume(store: Store, jobId: string) {
  const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
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

describe('POST /api/job', () => {
  it('creates a job with valid input', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node and TypeScript'
    })
    expect(response.body.id).toBeTypeOf('string')
  })

  it('persists an optional location', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({
        org_id: 'demo-org',
        title: 'Backend Engineer',
        description: 'Node and TypeScript',
        location: 'Tel Aviv'
      })

    expect(response.status).toBe(201)
    expect(response.body.location).toBe('Tel Aviv')
  })

  it('stores a null location when it is omitted', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })

    expect(response.status).toBe(201)
    expect(response.body.location).toBeNull()
  })

  it('normalizes an empty-string location to null instead of rejecting it', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript', location: '' })

    expect(response.status).toBe(201)
    expect(response.body.location).toBeNull()
  })

  it('rejects a missing title', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', description: 'no title' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.requestId).toBeTypeOf('string')
  })
})

describe('GET /api/job/:id', () => {
  it('returns the created job', async () => {
    const { app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })

    const response = await request(app).get(`/api/job/${created.body.id}`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(created.body.id)
  })

  it('returns 404 for an unknown job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/job/unknown-id').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('GET /api/job', () => {
  it('lists jobs for the given org', async () => {
    const { app, cookie } = await setup()

    await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })
    await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'other-org', title: 'Frontend Engineer', description: 'Vue' })

    const response = await request(app).get('/api/job?org_id=demo-org').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].org_id).toBe('demo-org')
    expect(response.body.total).toBe(1)
  })

  it('rejects a missing org_id', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/job').set('Cookie', cookie)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })
})

// Pagination contract: .orchestrate/api-contract.yaml and
// .plan/028-2026-09-06-pagination-cvs-jobs.md Open Question 3. `page`/`limit`
// are clamped, never rejected — a stale client link can trivially produce a
// page a list has outgrown, so that stays a 200 with an empty items array.
describe('GET /api/job — pagination', () => {
  // Ordering across pages is deliberately not asserted: jobs seeded in the
  // same millisecond tie on created_at. What must hold is that the pages
  // partition the org's jobs — no overlap, nothing dropped.
  async function seedJobs(store: Store, count: number, org_id = 'demo-org') {
    for (let i = 0; i < count; i++) {
      await store.createJob({ org_id, title: `Job ${i}`, description: 'Node and TypeScript' })
    }
  }

  it('defaults to page 1 with 10 items and reports the full total', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    const response = await request(app).get('/api/job?org_id=demo-org').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(10)
    expect(response.body.total).toBe(12)
    expect(response.body.page).toBe(1)
    expect(response.body.limit).toBe(10)
  })

  it('returns the requested page at the requested limit, partitioning the list', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    const first = await request(app).get('/api/job?org_id=demo-org&page=1&limit=5').set('Cookie', cookie)
    const second = await request(app).get('/api/job?org_id=demo-org&page=2&limit=5').set('Cookie', cookie)
    const third = await request(app).get('/api/job?org_id=demo-org&page=3&limit=5').set('Cookie', cookie)

    expect(first.body.items).toHaveLength(5)
    expect(second.body.items).toHaveLength(5)
    expect(third.body.items).toHaveLength(2)
    expect(second.body).toMatchObject({ total: 12, page: 2, limit: 5 })

    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((job: { id: string }) => job.id)
    expect(new Set(ids).size).toBe(12)
  })

  it('counts only the requested org, not every job in the store', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 3)
    await seedJobs(store, 4, 'other-org')

    const response = await request(app).get('/api/job?org_id=demo-org&limit=2').set('Cookie', cookie)

    expect(response.body.items).toHaveLength(2)
    expect(response.body.total).toBe(3)
  })

  it('returns 200 with empty items and the true total for a page past the end', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    const response = await request(app).get('/api/job?org_id=demo-org&page=99').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    expect(response.body.total).toBe(12)
    expect(response.body.page).toBe(99)
  })

  it('clamps a non-numeric, zero, or negative page to 1 instead of 400ing', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    for (const page of ['abc', '0', '-3', '']) {
      const response = await request(app)
        .get(`/api/job?org_id=demo-org&page=${encodeURIComponent(page)}`)
        .set('Cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body.page).toBe(1)
      expect(response.body.items).toHaveLength(10)
    }
  })

  it('clamps a non-numeric, zero, or negative limit to the default of 10', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    for (const limit of ['abc', '0', '-5', '']) {
      const response = await request(app)
        .get(`/api/job?org_id=demo-org&limit=${encodeURIComponent(limit)}`)
        .set('Cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body.limit).toBe(10)
      expect(response.body.items).toHaveLength(10)
    }
  })

  it('caps an oversized limit at 500 instead of 400ing', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    const response = await request(app).get('/api/job?org_id=demo-org&limit=100000').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.limit).toBe(500)
    expect(response.body.items).toHaveLength(12)
  })

  it('honours limit=500, the unpaginated request the filtered Jobs page makes', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    const response = await request(app).get('/api/job?org_id=demo-org&limit=500').set('Cookie', cookie)

    expect(response.body.limit).toBe(500)
    expect(response.body.items).toHaveLength(12)
  })
})

describe('PATCH /api/job/:id', () => {
  it('updates the job title and description', async () => {
    const { app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })

    const response = await request(app)
      .patch(`/api/job/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Senior Backend Engineer' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      title: 'Senior Backend Engineer',
      description: 'Node and TypeScript'
    })
  })

  it('sets a location on a job that had none', async () => {
    const { app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })
    expect(created.body.location).toBeNull()

    const response = await request(app)
      .patch(`/api/job/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ location: 'Tel Aviv' })

    expect(response.status).toBe(200)
    expect(response.body.location).toBe('Tel Aviv')
  })

  it('updates an existing location', async () => {
    const { app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({
        org_id: 'demo-org',
        title: 'Backend Engineer',
        description: 'Node and TypeScript',
        location: 'Tel Aviv'
      })

    const response = await request(app)
      .patch(`/api/job/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ location: 'Haifa' })

    expect(response.status).toBe(200)
    expect(response.body.location).toBe('Haifa')
  })

  it('normalizes an empty-string location to null rather than storing an empty string', async () => {
    const { store, app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({
        org_id: 'demo-org',
        title: 'Backend Engineer',
        description: 'Node and TypeScript',
        location: 'Tel Aviv'
      })

    const response = await request(app)
      .patch(`/api/job/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ location: '' })

    expect(response.status).toBe(200)
    expect(response.body.location).toBeNull()
    expect((await store.getJob(created.body.id))?.location).toBeNull()
  })

  it('leaves the location alone when the patch omits it', async () => {
    const { app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({
        org_id: 'demo-org',
        title: 'Backend Engineer',
        description: 'Node and TypeScript',
        location: 'Tel Aviv'
      })

    const response = await request(app)
      .patch(`/api/job/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Senior Backend Engineer' })

    expect(response.status).toBe(200)
    expect(response.body.location).toBe('Tel Aviv')
  })

  it('rejects an empty body', async () => {
    const { app, cookie } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })

    const response = await request(app).patch(`/api/job/${created.body.id}`).set('Cookie', cookie).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('returns 404 for an unknown job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).patch('/api/job/unknown-id').set('Cookie', cookie).send({ title: 'New Title' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('DELETE /api/job/:id', () => {
  it('deletes a job', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).delete(`/api/job/${job.id}`).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(await store.getJob(job.id)).toBeNull()
  })

  it("cascades to remove the job's resume attachments and matches, but not the resumes themselves", async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    const match = await store.createMatch({
      resume_id: resume.id,
      job_id: job.id,
      score: 80,
      explanation: 'Strong match'
    })

    const response = await request(app).delete(`/api/job/${job.id}`).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(await store.getMatch(match.id)).toBeNull()
    const resumeAfter = await store.getResume(resume.id)
    expect(resumeAfter).not.toBeNull()
    expect(resumeAfter?.jobs).toEqual([])
  })

  it('returns 404 for an unknown job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).delete('/api/job/unknown-id').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('POST /api/job/:id/duplicate', () => {
  it("duplicates a job's title/description and its current resume attachments, not its matches", async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 80, explanation: 'Strong match' })

    const response = await request(app).post(`/api/job/${job.id}/duplicate`).set('Cookie', cookie)

    expect(response.status).toBe(201)
    expect(response.body.id).not.toBe(job.id)
    expect(response.body).toMatchObject({
      org_id: job.org_id,
      title: job.title,
      description: job.description
    })

    const duplicateResumes = await store.listResumesForJob(response.body.id)
    expect(duplicateResumes).toHaveLength(1)
    expect(duplicateResumes[0].id).toBe(resume.id)

    const duplicateMatches = duplicateResumes[0].jobs
    expect(duplicateMatches).toContainEqual({ id: job.id, title: job.title })
    expect(duplicateMatches).toContainEqual({ id: response.body.id, title: job.title })
  })

  it("copies the source job's location onto the duplicate", async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node',
      location: 'Tel Aviv'
    })

    const response = await request(app).post(`/api/job/${job.id}/duplicate`).set('Cookie', cookie)

    expect(response.status).toBe(201)
    expect(response.body.id).not.toBe(job.id)
    expect(response.body.location).toBe('Tel Aviv')
  })

  it('leaves the duplicate location null when the source job has none', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).post(`/api/job/${job.id}/duplicate`).set('Cookie', cookie)

    expect(response.status).toBe(201)
    expect(response.body.location).toBeNull()
  })

  it('returns 404 for an unknown job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).post('/api/job/unknown-id/duplicate').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('GET /api/job/:id/resumes', () => {
  it('lists resumes attached to the job with an attached_at timestamp', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ id: resume.id, candidate_name: 'Jane Doe' })
    expect(response.body[0].attached_at).toBeTypeOf('string')
  })

  it('returns 404 for an unknown job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/job/unknown-id/resumes').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('POST /api/job/:id/resumes', () => {
  it('attaches an existing resume to the job', async () => {
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

    const response = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(200)
    expect(await store.isResumeAttachedToJob(job.id, resume.id)).toBe(true)
  })

  it('is idempotent when attaching an already-attached resume', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(200)
    const resumes = await store.listResumesForJob(job.id)
    expect(resumes).toHaveLength(1)
  })

  it('rejects a missing resume_id', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).post(`/api/job/${job.id}/resumes`).set('Cookie', cookie).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
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
      .post('/api/job/unknown-id/resumes')
      .set('Cookie', cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 404 for a nonexistent resume', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', cookie)
      .send({ resume_id: 'unknown-resume' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('DELETE /api/job/:id/resumes/:resumeId', () => {
  it("detaches a resume and cascades that job's matches for it", async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    const match = await store.createMatch({
      resume_id: resume.id,
      job_id: job.id,
      score: 80,
      explanation: 'Strong match'
    })

    const response = await request(app).delete(`/api/job/${job.id}/resumes/${resume.id}`).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(await store.isResumeAttachedToJob(job.id, resume.id)).toBe(false)
    expect(await store.getMatch(match.id)).toBeNull()
    expect(await store.getResume(resume.id)).not.toBeNull()
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

    const response = await request(app).delete(`/api/job/unknown-id/resumes/${resume.id}`).set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 404 for a nonexistent resume', async () => {
    const { store, app, cookie } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).delete(`/api/job/${job.id}/resumes/unknown-resume`).set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 404 when the resume is not attached to this job', async () => {
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

    const response = await request(app).delete(`/api/job/${job.id}/resumes/${resume.id}`).set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})
