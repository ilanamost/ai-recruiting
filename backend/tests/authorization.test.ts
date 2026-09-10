import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// POST /api/resume and PUT /api/resume/:id/file now reach real route handlers for Candidate
// (previously blocked before the handler ran), which call extractText on the uploaded bytes —
// mock it the same way tests/resume.test.ts does so these authorization checks don't depend on
// pdf-parse successfully parsing a fake buffer.
vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi.fn().mockResolvedValue('mocked extracted text')
}))

// POST /api/match now reaches the real handler for Candidate too (previously blocked before
// the handler ran), which calls scoreMatch — mock it the same way tests/match.test.ts does so
// this authorization check doesn't depend on a live Claude API call.
vi.mock('../src/scoring', () => ({
  scoreMatch: vi.fn().mockResolvedValue({
    score: 82,
    explanation: 'Strong overlap with the required skills.'
  })
}))

// Both CV upload routes now also run the analysis step
// (.plan/029-2026-09-07-cv-recruiter-filter.md) — another Claude API call, so
// mock it for the same reason as scoreMatch above.
vi.mock('../src/analysis', () => ({
  analyzeResume: vi.fn().mockResolvedValue({ years_experience: 5, skills: ['node'] })
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

/**
 * Covers every Permission Matrix row from
 * .plan/008-2026-08-03-authentication-authorization.md (corrected
 * 2026-08-04) that isn't "full access", plus the ownership scoping added by
 * .plan/009-2026-08-08-candidate-cv-ownership-scoping.md, widened to the CV
 * read routes by .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md:
 * Candidate is blocked from mutating jobs (create/edit/delete/duplicate), can
 * upload a new CV (which becomes their own), and can view/download/edit/
 * replace/delete/attach/detach only a CV whose owner_user_id equals their own
 * user id — a CV with no owner or a different candidate's owner is 403, and is
 * absent from GET /api/resume entirely. Recruiter is
 * blocked from mutating resumes and from attach/detach regardless of
 * ownership. Read-only rows are also spot-checked so a too-broad requireRole
 * call would be caught here too.
 */

async function attachedResume(store: Store, jobId: string, ownerId?: string | null) {
  const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
  return store.createResume({
    candidate_id: candidate.id,
    job_id: jobId,
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    content: 'resume text',
    file_data: Buffer.from('%PDF-1.4 fake bytes'),
    owner_user_id: ownerId ?? null
  })
}

/** A resume attached to no job — enough for the /api/resume read routes (.plan/032). */
async function ownedResume(store: Store, ownerId?: string | null) {
  const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
  return store.createResume({
    candidate_id: candidate.id,
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    content: 'resume text',
    file_data: Buffer.from('%PDF-1.4 fake bytes'),
    owner_user_id: ownerId ?? null
  })
}

/**
 * The three-resume set every ownership-scoped read case below is judged
 * against: one owned by `ownerId`, one owned by another candidate, one with a
 * null owner (Admin-uploaded / pre-column). .plan/032's Open Question 2 puts
 * the null-owner row on the same side of the boundary as another candidate's.
 */
async function seedMixedOwnership(store: Store, ownerId: string, otherOwnerId: string) {
  const own = await ownedResume(store, ownerId)
  const other = await ownedResume(store, otherOwnerId)
  const unowned = await ownedResume(store)
  return { own, other, unowned }
}

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const admin = await createAuthedUser(store, 'admin')
  const recruiter = await createAuthedUser(store, 'recruiter')
  const candidate = await createAuthedUser(store, 'candidate')
  const otherCandidate = await createAuthedUser(store, 'candidate')
  return { store, app, admin, recruiter, candidate, otherCandidate }
}

describe('Candidate role — job mutation routes', () => {
  it('403s on POST /api/job', async () => {
    const { app, candidate } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', candidate.cookie)
      .send({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  it('403s on PATCH /api/job/:id', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app)
      .patch(`/api/job/${job.id}`)
      .set('Cookie', candidate.cookie)
      .send({ title: 'New title' })

    expect(response.status).toBe(403)
  })

  it('403s on DELETE /api/job/:id', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).delete(`/api/job/${job.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it('403s on POST /api/job/:id/duplicate', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).post(`/api/job/${job.id}/duplicate`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })
})

describe('Candidate role — job attach/detach routes (ownership-scoped, .plan/009)', () => {
  it('allows attach (POST /api/job/:id/resumes) for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const domainCandidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: domainCandidate.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes'),
      owner_user_id: candidate.user.id
    })

    const response = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', candidate.cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(200)
  })

  it('403s on attach for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const domainCandidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: domainCandidate.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const response = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', candidate.cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(403)
  })

  it("403s on attach for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', candidate.cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(403)
  })

  it('allows detach (DELETE /api/job/:id/resumes/:resumeId) for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)

    const response = await request(app)
      .delete(`/api/job/${job.id}/resumes/${resume.id}`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(204)
  })

  it('403s on detach for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .delete(`/api/job/${job.id}/resumes/${resume.id}`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it("403s on detach for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app)
      .delete(`/api/job/${job.id}/resumes/${resume.id}`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })
})

describe('Candidate role — read-only job routes remain accessible', () => {
  it('GET /api/job is allowed', async () => {
    const { app, candidate } = await setup()

    const response = await request(app).get('/api/job?org_id=demo-org').set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
  })

  it('GET /api/job/:id/resumes is allowed', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
  })

  it('GET /api/job/:id/resumes list-narrows to only the candidate\'s own resume (.plan/011)', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const ownResume = await attachedResume(store, job.id, candidate.user.id)
    await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].id).toBe(ownResume.id)
  })

  // Adversarial (QA, .plan/011): the plan's Assumptions section says a null-owner resume
  // (Admin-uploaded, or pre-existing the column) must be excluded from a Candidate's filtered
  // list the same as another candidate's resume. The implementing agent's test above only
  // proves exclusion of an *other-candidate-owned* resume in a 2-resume set; this proves a
  // *null-owner* resume is excluded too, in the same response, alongside an other-owner one.
  it("excludes a null-owner resume from the candidate's filtered list too, not just another candidate's (.plan/011 adversarial)", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const ownResume = await attachedResume(store, job.id, candidate.user.id)
    await attachedResume(store, job.id, otherCandidate.user.id)
    await attachedResume(store, job.id) // owner_user_id: null

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].id).toBe(ownResume.id)
  })

  // Adversarial (QA, .plan/011): GET /:jobId/resumes/:resumeId/match is a separate route
  // (.plan/010) that doesn't call listResumesForJob at all — it looks up the resume directly by
  // id via getResume/isResumeAttachedToJob. Confirm the list-narrowing on GET /:id/resumes
  // doesn't regress this unrelated route: a candidate can still fetch their own match even when
  // the same job also has another candidate's and a null-owner resume attached (i.e. the exact
  // set that gets filtered out of the list response above).
  it('does not regress GET /:jobId/resumes/:resumeId/match for the candidate\'s own resume on a job with mixed-ownership attachments (.plan/011 adversarial)', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const ownResume = await attachedResume(store, job.id, candidate.user.id)
    await attachedResume(store, job.id, otherCandidate.user.id)
    await attachedResume(store, job.id) // owner_user_id: null
    await store.createMatch({ resume_id: ownResume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app)
      .get(`/api/job/${job.id}/resumes/${ownResume.id}/match`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
  })
})

describe('Recruiter role — GET /api/job/:id/resumes stays unfiltered (.plan/011)', () => {
  it('returns both resumes for a mixed-ownership job', async () => {
    const { store, app, recruiter, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    await attachedResume(store, job.id, candidate.user.id)
    await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(2)
  })
})

describe('Candidate role — /api/resume routes (ownership-scoped mutations, .plan/009)', () => {
  // .plan/032: the list narrows to the candidate's own CVs — `total` too, not
  // just `items`, or the pagination footer would still advertise other
  // candidates' rows (.plan/028).
  it('narrows GET /api/resume to only the candidate\'s own resume, in items and total (.plan/032)', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const { own } = await seedMixedOwnership(store, candidate.user.id, otherCandidate.user.id)

    const response = await request(app).get('/api/resume').set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].id).toBe(own.id)
    expect(response.body.total).toBe(1)
  })

  it('allows GET /api/resume/:id for the candidate\'s own resume', async () => {
    const { store, app, candidate } = await setup()
    const resume = await ownedResume(store, candidate.user.id)

    const response = await request(app).get(`/api/resume/${resume.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(resume.id)
  })

  it("403s on GET /api/resume/:id for another candidate's resume (.plan/032)", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const resume = await ownedResume(store, otherCandidate.user.id)

    const response = await request(app).get(`/api/resume/${resume.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  it('403s on GET /api/resume/:id for a resume with no owner (.plan/032 Open Question 2)', async () => {
    const { store, app, candidate } = await setup()
    const resume = await ownedResume(store)

    const response = await request(app).get(`/api/resume/${resume.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it('allows GET /api/resume/:id/file for the candidate\'s own resume', async () => {
    const { store, app, candidate } = await setup()
    const resume = await ownedResume(store, candidate.user.id)

    const response = await request(app).get(`/api/resume/${resume.id}/file`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
  })

  it("403s on GET /api/resume/:id/file for another candidate's resume (.plan/032)", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const resume = await ownedResume(store, otherCandidate.user.id)

    const response = await request(app).get(`/api/resume/${resume.id}/file`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  it('403s on GET /api/resume/:id/file for a resume with no owner (.plan/032 Open Question 2)', async () => {
    const { store, app, candidate } = await setup()
    const resume = await ownedResume(store)

    const response = await request(app).get(`/api/resume/${resume.id}/file`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  // The new ownership check must not swallow the not-found case into a 403:
  // a nonexistent id is still a 404 for a Candidate, on both read routes.
  it('404s (not 403s) on GET /api/resume/:id and /:id/file for an id that does not exist', async () => {
    const { app, candidate } = await setup()

    const detail = await request(app).get('/api/resume/does-not-exist').set('Cookie', candidate.cookie)
    const file = await request(app).get('/api/resume/does-not-exist/file').set('Cookie', candidate.cookie)

    expect(detail.status).toBe(404)
    expect(file.status).toBe(404)
  })

  it('allows POST /api/resume (upload), which becomes the uploading candidate\'s own resume', async () => {
    const { app, candidate } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', candidate.cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(201)
    expect(response.body.owner_user_id).toBe(candidate.user.id)
  })

  // .plan/030-2026-09-08-remove-docx-cv-support.md: a Candidate is allowed to
  // upload, so a .docx attempt must fail the format gate (400), not the role
  // gate (403) — this pins that the PDF-only rule is enforced independently of
  // the Permission Matrix row above.
  it('400s (not 403s) on POST /api/resume with a .docx — an allowed role, a rejected format', async () => {
    const { app, candidate } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', candidate.cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('PK fake docx bytes'), {
        filename: 'resume.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.error.message).toBe('file must be a PDF document')
  })

  it('allows PATCH /api/resume/:id (edit) for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)

    const response = await request(app)
      .patch(`/api/resume/${resume.id}`)
      .set('Cookie', candidate.cookie)
      .send({ name: 'New Name' })

    expect(response.status).toBe(200)
  })

  it('403s on PATCH /api/resume/:id for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .patch(`/api/resume/${resume.id}`)
      .set('Cookie', candidate.cookie)
      .send({ name: 'New Name' })

    expect(response.status).toBe(403)
  })

  it("403s on PATCH /api/resume/:id for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app)
      .patch(`/api/resume/${resume.id}`)
      .set('Cookie', candidate.cookie)
      .send({ name: 'New Name' })

    expect(response.status).toBe(403)
  })

  it('allows PUT /api/resume/:id/file (replace) for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', candidate.cookie)
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(200)
  })

  it('403s on PUT /api/resume/:id/file for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', candidate.cookie)
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(403)
  })

  it("403s on PUT /api/resume/:id/file for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', candidate.cookie)
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(403)
  })

  it('allows DELETE /api/resume/:id for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)

    const response = await request(app).delete(`/api/resume/${resume.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(204)
  })

  it('403s on DELETE /api/resume/:id for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app).delete(`/api/resume/${resume.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it("403s on DELETE /api/resume/:id for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app).delete(`/api/resume/${resume.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })
})

describe('Candidate role — /api/match (ownership-scoped, .plan/010)', () => {
  it('allows POST /api/match for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', candidate.cookie)
      .send({ resume_id: resume.id, job_id: job.id })

    expect(response.status).toBe(201)
  })

  it('403s on POST /api/match for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', candidate.cookie)
      .send({ resume_id: resume.id, job_id: job.id })

    expect(response.status).toBe(403)
  })

  it("403s on POST /api/match for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', candidate.cookie)
      .send({ resume_id: resume.id, job_id: job.id })

    expect(response.status).toBe(403)
  })

  it('allows GET /api/match/:id for a match on a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)
    const match = await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app).get(`/api/match/${match.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
  })

  it('403s on GET /api/match/:id for a match on a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    const match = await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app).get(`/api/match/${match.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it("403s on GET /api/match/:id for a match on another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)
    const match = await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app).get(`/api/match/${match.id}`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })
})

describe('Candidate role — GET /api/job/:jobId/resumes/:resumeId/match (ownership-scoped, .plan/010)', () => {
  it('allows the lookup for a resume the candidate owns', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app)
      .get(`/api/job/${job.id}/resumes/${resume.id}/match`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
  })

  it('403s on the lookup for a resume with no owner', async () => {
    const { store, app, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app)
      .get(`/api/job/${job.id}/resumes/${resume.id}/match`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it("403s on the lookup for another candidate's resume", async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, otherCandidate.user.id)
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app)
      .get(`/api/job/${job.id}/resumes/${resume.id}/match`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })
})

describe('Recruiter role — /api/match (unrestricted, .plan/010)', () => {
  it('allows POST /api/match for a resume owned by a candidate', async () => {
    const { store, app, recruiter, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)

    const response = await request(app)
      .post('/api/match')
      .set('Cookie', recruiter.cookie)
      .send({ resume_id: resume.id, job_id: job.id })

    expect(response.status).toBe(201)
  })

  it('allows GET /api/match/:id for a match on a resume owned by a candidate', async () => {
    const { store, app, recruiter, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)
    const match = await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app).get(`/api/match/${match.id}`).set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
  })

  it('allows GET /api/match/:id for a match on an unowned resume', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    const match = await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app).get(`/api/match/${match.id}`).set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
  })
})

describe('Recruiter role — GET /api/job/:jobId/resumes/:resumeId/match (unrestricted, .plan/010)', () => {
  it('allows the lookup for a resume owned by a candidate', async () => {
    const { store, app, recruiter, candidate } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id, candidate.user.id)
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app)
      .get(`/api/job/${job.id}/resumes/${resume.id}/match`)
      .set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
  })

  it('allows the lookup for an unowned resume', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)
    await store.createMatch({ resume_id: resume.id, job_id: job.id, score: 70, explanation: 'ok' })

    const response = await request(app)
      .get(`/api/job/${job.id}/resumes/${resume.id}/match`)
      .set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
  })
})

describe('Recruiter role — /api/resume mutation routes', () => {
  it('403s on POST /api/resume', async () => {
    const { app, recruiter } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', recruiter.cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(403)
  })

  it('403s on PATCH /api/resume/:id', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .patch(`/api/resume/${resume.id}`)
      .set('Cookie', recruiter.cookie)
      .send({ name: 'New Name' })

    expect(response.status).toBe(403)
  })

  it('403s on PUT /api/resume/:id/file', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', recruiter.cookie)
      .attach('file', Buffer.from('%PDF-1.4 bytes'), { filename: 'resume.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(403)
  })

  it('403s on DELETE /api/resume/:id', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app).delete(`/api/resume/${resume.id}`).set('Cookie', recruiter.cookie)

    expect(response.status).toBe(403)
  })

  it('allows GET /api/resume (read only)', async () => {
    const { app, recruiter } = await setup()

    const response = await request(app).get('/api/resume').set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
  })
})

// .plan/032 narrows the CV read routes for Candidate only — these pin that the
// other two roles kept every row they could read before, including a resume
// owned by a candidate and one with a null owner.
describe('Admin and Recruiter — /api/resume read routes stay unfiltered (.plan/032)', () => {
  it('GET /api/resume returns every resume, and the unfiltered total, for Admin', async () => {
    const { store, app, admin, candidate, otherCandidate } = await setup()
    await seedMixedOwnership(store, candidate.user.id, otherCandidate.user.id)

    const response = await request(app).get('/api/resume').set('Cookie', admin.cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(3)
    expect(response.body.total).toBe(3)
  })

  it('GET /api/resume returns every resume, and the unfiltered total, for Recruiter', async () => {
    const { store, app, recruiter, candidate, otherCandidate } = await setup()
    await seedMixedOwnership(store, candidate.user.id, otherCandidate.user.id)

    const response = await request(app).get('/api/resume').set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(3)
    expect(response.body.total).toBe(3)
  })

  it("allows Admin GET /api/resume/:id and /:id/file for a candidate's resume and an unowned one", async () => {
    const { store, app, admin, candidate } = await setup()
    const owned = await ownedResume(store, candidate.user.id)
    const unowned = await ownedResume(store)

    for (const resume of [owned, unowned]) {
      expect((await request(app).get(`/api/resume/${resume.id}`).set('Cookie', admin.cookie)).status).toBe(200)
      expect((await request(app).get(`/api/resume/${resume.id}/file`).set('Cookie', admin.cookie)).status).toBe(200)
    }
  })

  it("allows Recruiter GET /api/resume/:id and /:id/file for a candidate's resume and an unowned one", async () => {
    const { store, app, recruiter, candidate } = await setup()
    const owned = await ownedResume(store, candidate.user.id)
    const unowned = await ownedResume(store)

    for (const resume of [owned, unowned]) {
      expect((await request(app).get(`/api/resume/${resume.id}`).set('Cookie', recruiter.cookie)).status).toBe(200)
      expect((await request(app).get(`/api/resume/${resume.id}/file`).set('Cookie', recruiter.cookie)).status).toBe(200)
    }
  })
})

describe('Recruiter role — job attach/detach routes (Admin-only, corrected 2026-08-04)', () => {
  it('403s on attach (POST /api/job/:id/resumes)', async () => {
    const { store, app, recruiter } = await setup()
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
      .set('Cookie', recruiter.cookie)
      .send({ resume_id: resume.id })

    expect(response.status).toBe(403)
  })

  it('403s on detach (DELETE /api/job/:id/resumes/:resumeId)', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    const response = await request(app)
      .delete(`/api/job/${job.id}/resumes/${resume.id}`)
      .set('Cookie', recruiter.cookie)

    expect(response.status).toBe(403)
  })

  it('allows the attached-CVs list (read only)', async () => {
    const { store, app, recruiter } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    await attachedResume(store, job.id)

    const response = await request(app).get(`/api/job/${job.id}/resumes`).set('Cookie', recruiter.cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
  })
})

describe('Admin role — job attach/detach routes still work', () => {
  it('attach then detach both succeed', async () => {
    const { store, app, admin } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'resume.pdf',
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })

    const attachResponse = await request(app)
      .post(`/api/job/${job.id}/resumes`)
      .set('Cookie', admin.cookie)
      .send({ resume_id: resume.id })
    expect(attachResponse.status).toBe(200)

    const detachResponse = await request(app)
      .delete(`/api/job/${job.id}/resumes/${resume.id}`)
      .set('Cookie', admin.cookie)
    expect(detachResponse.status).toBe(204)
  })
})

describe('Unauthenticated requests', () => {
  it('401s on /api/job without any cookie', async () => {
    const { app } = await setup()

    const response = await request(app).get('/api/job?org_id=demo-org')

    expect(response.status).toBe(401)
  })

  it('401s on /api/resume without any cookie', async () => {
    const { app } = await setup()

    const response = await request(app).get('/api/resume')

    expect(response.status).toBe(401)
  })

  it('401s on /api/match without any cookie', async () => {
    const { app } = await setup()

    const response = await request(app).post('/api/match').send({ resume_id: 'x', job_id: 'y' })

    expect(response.status).toBe(401)
  })
})
