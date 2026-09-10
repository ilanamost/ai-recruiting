import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi.fn().mockResolvedValue('Five years of Node.js and TypeScript experience')
}))

// POST /api/resume and PUT /api/resume/:id/file also run the analysis step
// (.plan/029-2026-09-07-cv-recruiter-filter.md), which is a Claude API call —
// mocked here so these tests never reach the live API. The analysis output
// itself is covered in tests/resume-analysis.test.ts.
vi.mock('../src/analysis', () => ({
  analyzeResume: vi.fn().mockResolvedValue({ years_experience: 5, skills: ['node', 'typescript'] })
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

async function createJob(store: Store) {
  return store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' })
}

async function createUnattachedResume(store: Store) {
  const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
  return store.createResume({
    candidate_id: candidate.id,
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    content: 'resume text',
    file_data: Buffer.from('%PDF-1.4 fake resume bytes')
  })
}

// Admin has full access to /api/resume (see the plan's Permission Matrix) —
// used as this file's default authenticated caller since it exercises
// every route unrestricted. Role-gating itself (Recruiter read-only,
// Candidate blocked) is covered separately in tests/authorization.test.ts.
async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie } = await createAuthedUser(store, 'admin')
  return { store, app, cookie }
}

describe('POST /api/resume', () => {
  it('uploads a resume, auto-attaches it, and persists the extracted text', async () => {
    const { store, app, cookie } = await setup()
    const job = await createJob(store)

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .field('job_id', job.id)
      .attach('file', Buffer.from('%PDF-1.4 fake resume bytes'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf'
      })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      candidate_name: 'Jane Doe',
      candidate_email: 'jane@example.com',
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'Five years of Node.js and TypeScript experience'
    })
    expect(response.body.jobs).toEqual([{ id: job.id, title: job.title }])
    expect(response.body.job_id).toBeUndefined()
  })

  it('uploads a resume without a job_id, leaving it unattached', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('%PDF-1.4 fake resume bytes'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf'
      })

    expect(response.status).toBe(201)
    expect(response.body.jobs).toEqual([])
  })

  it('rejects an unsupported file type', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('plain text resume'), {
        filename: 'resume.txt',
        contentType: 'text/plain'
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  // .plan/030-2026-09-08-remove-docx-cv-support.md: DOCX was an accepted
  // upload format until this change — it is now rejected like any other
  // non-PDF type, with the mime type echoed back in error.details.
  it('rejects a .docx upload now that CVs are PDF-only', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('PK fake docx bytes'), {
        filename: 'resume.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.error.message).toBe('file must be a PDF document')
    expect(response.body.error.details).toMatchObject({
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
  })

  it('rejects a missing file', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')

    expect(response.status).toBe(400)
  })

  it('rejects a missing name', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('%PDF-1.4 fake resume bytes'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf'
      })

    expect(response.status).toBe(400)
  })

  it('returns 404 when job_id does not reference an existing job', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .field('job_id', 'unknown-job')
      .attach('file', Buffer.from('%PDF-1.4 fake resume bytes'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf'
      })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('GET /api/resume/:id', () => {
  it('returns 404 for an unknown resume', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/resume/unknown-id').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('GET /api/resume', () => {
  it('lists every resume with the jobs each is attached to', async () => {
    const { store, app, cookie } = await setup()
    const job = await createJob(store)
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    await store.createResume({
      candidate_id: candidate.id,
      job_id: job.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })
    await createUnattachedResume(store)

    const response = await request(app).get('/api/resume').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(2)
    expect(response.body.total).toBe(2)
    const attached = response.body.items.find((r: { jobs: unknown[] }) => r.jobs.length > 0)
    expect(attached).toMatchObject({
      candidate_name: 'Jane Doe',
      candidate_email: 'jane@example.com',
      jobs: [{ id: job.id, title: job.title }]
    })
  })
})

// Pagination contract: .orchestrate/api-contract.yaml and
// .plan/028-2026-09-06-pagination-cvs-jobs.md Open Question 3. `page`/`limit`
// are clamped, never rejected — a stale client link can trivially produce a
// page a list has outgrown, so that stays a 200 with an empty items array.
describe('GET /api/resume — pagination', () => {
  // Ordering across pages is deliberately not asserted: resumes seeded in the
  // same millisecond tie on created_at. What must hold is that the pages
  // partition the list — no overlap, nothing dropped.
  async function seedResumes(store: Store, count: number) {
    for (let i = 0; i < count; i++) {
      const candidate = await store.createCandidate({ name: `Candidate ${i}`, email: `candidate${i}@example.com` })
      await store.createResume({
        candidate_id: candidate.id,
        file_name: `resume-${i}.pdf`,
        mime_type: 'application/pdf',
        content: 'resume text',
        file_data: Buffer.from('%PDF-1.4 fake bytes')
      })
    }
  }

  it('defaults to page 1 with 10 items and reports the full total', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    const response = await request(app).get('/api/resume').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(10)
    expect(response.body.total).toBe(12)
    expect(response.body.page).toBe(1)
    expect(response.body.limit).toBe(10)
  })

  it('returns the requested page at the requested limit, partitioning the list', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    const first = await request(app).get('/api/resume?page=1&limit=5').set('Cookie', cookie)
    const second = await request(app).get('/api/resume?page=2&limit=5').set('Cookie', cookie)
    const third = await request(app).get('/api/resume?page=3&limit=5').set('Cookie', cookie)

    expect(first.body.items).toHaveLength(5)
    expect(second.body.items).toHaveLength(5)
    expect(third.body.items).toHaveLength(2)
    expect(second.body).toMatchObject({ total: 12, page: 2, limit: 5 })

    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((r: { id: string }) => r.id)
    expect(new Set(ids).size).toBe(12)
  })

  it('returns 200 with empty items and the true total for a page past the end', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    const response = await request(app).get('/api/resume?page=99').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    expect(response.body.total).toBe(12)
    expect(response.body.page).toBe(99)
  })

  it('clamps a non-numeric, zero, or negative page to 1 instead of 400ing', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    for (const page of ['abc', '0', '-3', '']) {
      const response = await request(app).get(`/api/resume?page=${encodeURIComponent(page)}`).set('Cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body.page).toBe(1)
      expect(response.body.items).toHaveLength(10)
    }
  })

  it('clamps a non-numeric, zero, or negative limit to the default of 10', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    for (const limit of ['abc', '0', '-5', '']) {
      const response = await request(app).get(`/api/resume?limit=${encodeURIComponent(limit)}`).set('Cookie', cookie)

      expect(response.status).toBe(200)
      expect(response.body.limit).toBe(10)
      expect(response.body.items).toHaveLength(10)
    }
  })

  it('caps an oversized limit at 500 instead of 400ing', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    const response = await request(app).get('/api/resume?limit=100000').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.limit).toBe(500)
    expect(response.body.items).toHaveLength(12)
  })

  it('honours limit=500, the unpaginated request the attach dropdown makes', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    const response = await request(app).get('/api/resume?limit=500').set('Cookie', cookie)

    expect(response.body.limit).toBe(500)
    expect(response.body.items).toHaveLength(12)
  })
})

describe('PATCH /api/resume/:id', () => {
  it('updates the candidate name and email', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app)
      .patch(`/api/resume/${resume.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Jane Smith', email: 'jane.smith@example.com' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      candidate_name: 'Jane Smith',
      candidate_email: 'jane.smith@example.com'
    })
  })

  it('rejects an empty body', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app).patch(`/api/resume/${resume.id}`).set('Cookie', cookie).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('returns 404 for an unknown resume', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .patch('/api/resume/unknown-id')
      .set('Cookie', cookie)
      .send({ name: 'Jane Smith' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('DELETE /api/resume/:id', () => {
  it('deletes a resume', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app).delete(`/api/resume/${resume.id}`).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(await store.getResume(resume.id)).toBeNull()
  })

  it("cascades to remove the resume's job attachments and matches", async () => {
    const { store, app, cookie } = await setup()
    const job = await createJob(store)
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      job_id: job.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })
    const match = await store.createMatch({
      resume_id: resume.id,
      job_id: job.id,
      score: 80,
      explanation: 'Strong match'
    })

    const response = await request(app).delete(`/api/resume/${resume.id}`).set('Cookie', cookie)

    expect(response.status).toBe(204)
    expect(await store.getMatch(match.id)).toBeNull()
    expect(await store.isResumeAttachedToJob(job.id, resume.id)).toBe(false)
  })

  it('returns 404 for an unknown resume', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).delete('/api/resume/unknown-id').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})

describe('GET /api/resume/:id/file', () => {
  it('streams the raw file bytes inline by default', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app).get(`/api/resume/${resume.id}/file`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/pdf')
    expect(response.headers['content-disposition']).toContain('inline')
    expect(response.body.toString()).toContain('%PDF-1.4')
  })

  it('sets Content-Disposition: attachment when download=1', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app).get(`/api/resume/${resume.id}/file?download=1`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('attachment')
  })

  it('returns 404 for an unknown resume', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/resume/unknown-id/file').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 404 with a distinct message when the resume row exists but file_data is null', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)
    // Simulates a resume row that predates `.plan/005-*`'s `file_data` column
    // (or whose dev DB never got it backfilled) — the row exists but its raw
    // file bytes were never captured, so the store returns file_data: null.
    const storeWithMissingFileData: Store = {
      ...store,
      async getResumeFile(id: string) {
        if (id !== resume.id) return null
        return { file_name: resume.file_name, mime_type: resume.mime_type, file_data: null }
      }
    }
    const appWithMissingFileData = createApp(storeWithMissingFileData)

    const response = await request(appWithMissingFileData)
      .get(`/api/resume/${resume.id}/file`)
      .set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
    expect(response.body.error.message).not.toBe('Resume not found')
    expect(response.body.error.message).toMatch(/file/i)
  })
})

describe('PUT /api/resume/:id/file', () => {
  it("replaces the resume's file, re-extracting content and keeping the same id", async () => {
    const { store, app, cookie } = await setup()
    const job = await createJob(store)
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      job_id: job.id,
      file_name: 'old.pdf',
      mime_type: 'application/pdf',
      content: 'old text',
      file_data: Buffer.from('%PDF-1.4 old bytes')
    })

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('%PDF-1.4 new bytes'), {
        filename: 'new.pdf',
        contentType: 'application/pdf'
      })

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(resume.id)
    expect(response.body.file_name).toBe('new.pdf')
    expect(response.body.content).toBe('Five years of Node.js and TypeScript experience')
    // Still attached to the same job it was before the replace.
    expect(response.body.jobs).toEqual([{ id: job.id, title: job.title }])

    const file = await store.getResumeFile(resume.id)
    expect(file?.file_data?.toString()).toBe('%PDF-1.4 new bytes')
  })

  it('rejects a missing file', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app).put(`/api/resume/${resume.id}/file`).set('Cookie', cookie)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('rejects an unsupported file type', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('plain text'), { filename: 'resume.txt', contentType: 'text/plain' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  // .plan/030: replacing a CV's file with a .docx is rejected too, not just
  // the initial upload — both routes share the same PDF-only gate.
  it('rejects replacing the file with a .docx now that CVs are PDF-only', async () => {
    const { store, app, cookie } = await setup()
    const resume = await createUnattachedResume(store)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('PK fake docx bytes'), {
        filename: 'resume.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.error.message).toBe('file must be a PDF document')

    // The stored file is untouched by the rejected replace.
    const file = await store.getResumeFile(resume.id)
    expect(file?.mime_type).toBe('application/pdf')
  })

  it('returns 404 for an unknown resume', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .put('/api/resume/unknown-id/file')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })
})
