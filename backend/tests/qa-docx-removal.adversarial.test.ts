import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

/**
 * QA adversarial pass for .plan/030-2026-09-08-remove-docx-cv-support.md.
 *
 * Deliberately does NOT mock `../src/extraction`. Every other suite in this
 * repo replaces `SUPPORTED_MIME_TYPES` with a test double, which means a
 * regression that widened the real array back out (re-adding the DOCX mime
 * type) would still show green everywhere else. These cases run against the
 * real module so the rejection is proved by production config, not by a mock
 * that agrees with it. That is safe here because every upload case below is
 * rejected *before* `extractText` runs, so no case depends on pdf-parse.
 *
 * `../src/analysis` and `../src/scoring` are still mocked so that any case
 * reaching a handler cannot make a live Claude API call.
 */

vi.mock('../src/analysis', () => ({
  analyzeResume: vi.fn().mockResolvedValue({ years_experience: 5, skills: ['node'] })
}))

vi.mock('../src/scoring', () => ({
  scoreMatch: vi.fn().mockResolvedValue({ score: 82, explanation: 'Strong overlap.' })
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { SUPPORTED_MIME_TYPES } from '../src/extraction'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCX_BYTES = Buffer.from('PK fake docx bytes')

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const admin = await createAuthedUser(store, 'admin')
  const recruiter = await createAuthedUser(store, 'recruiter')
  const candidate = await createAuthedUser(store, 'candidate')
  return { store, app, admin, recruiter, candidate }
}

/** A resume row, optionally carrying a legacy non-PDF mime_type. */
async function seedResume(
  store: Store,
  overrides: Partial<{ mime_type: string; file_name: string; file_data: Buffer; owner_user_id: string | null }> = {}
) {
  const candidate = await store.createCandidate({ name: 'Jane Doe', email: 'jane@example.com' })
  return store.createResume({
    candidate_id: candidate.id,
    file_name: overrides.file_name ?? 'resume.pdf',
    mime_type: overrides.mime_type ?? 'application/pdf',
    content: 'resume text',
    file_data: overrides.file_data ?? Buffer.from('%PDF-1.4 fake bytes'),
    owner_user_id: overrides.owner_user_id ?? null
  })
}

describe('the real SUPPORTED_MIME_TYPES (not a mock)', () => {
  it('is exactly PDF, so no other suite\'s test double can hide a widened array', () => {
    expect([...SUPPORTED_MIME_TYPES]).toEqual(['application/pdf'])
  })
})

describe('POST /api/resume — .docx rejected for every role allowed to upload', () => {
  // The point of splitting admin and candidate: a .docx rejection that came
  // from the requireRole gate rather than the format gate would still "fail
  // the upload", but for the wrong reason, and would silently pass if only one
  // role were tested. Each case asserts 400 + the exact message, never 403.
  for (const role of ['admin', 'candidate'] as const) {
    it(`400s with "file must be a PDF document" for ${role}, not 403`, async () => {
      const { app, ...users } = await setup()
      const actor = users[role]

      const response = await request(app)
        .post('/api/resume')
        .set('Cookie', actor.cookie)
        .field('name', 'Jane Doe')
        .field('email', 'jane@example.com')
        .attach('file', DOCX_BYTES, { filename: 'resume.docx', contentType: DOCX_MIME })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('validation_error')
      expect(response.body.error.message).toBe('file must be a PDF document')
      expect(response.body.error.details.mime_type).toBe(DOCX_MIME)
    })
  }

  it('still 403s for recruiter — the role gate is independent of the format gate', async () => {
    const { app, recruiter } = await setup()

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', recruiter.cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', DOCX_BYTES, { filename: 'resume.docx', contentType: DOCX_MIME })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  it('rejects legacy .doc, octet-stream, and a long malformed filename the same way', async () => {
    const { app, admin } = await setup()
    const cases = [
      { filename: 'resume.doc', contentType: 'application/msword' },
      { filename: 'resume.docx', contentType: 'application/octet-stream' },
      { filename: `${'a'.repeat(400)}.docx`, contentType: DOCX_MIME },
      { filename: 'resume.docx', contentType: DOCX_MIME.toUpperCase() }
    ]

    for (const file of cases) {
      const response = await request(app)
        .post('/api/resume')
        .set('Cookie', admin.cookie)
        .field('name', 'Jane Doe')
        .field('email', 'jane@example.com')
        .attach('file', DOCX_BYTES, file)

      expect(response.status, `${file.contentType} should be rejected`).toBe(400)
      expect(response.body.error.message).toBe('file must be a PDF document')
    }
  })
})

describe('PUT /api/resume/:id/file — .docx rejected for every role allowed to replace', () => {
  it('400s for admin and leaves the stored file untouched', async () => {
    const { store, app, admin } = await setup()
    const resume = await seedResume(store)

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', admin.cookie)
      .attach('file', DOCX_BYTES, { filename: 'resume.docx', contentType: DOCX_MIME })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('file must be a PDF document')

    const stored = await store.getResumeFile(resume.id)
    expect(stored?.mime_type).toBe('application/pdf')
    expect(stored?.file_name).toBe('resume.pdf')
    expect(stored?.file_data?.toString()).toBe('%PDF-1.4 fake bytes')
  })

  it('400s — not 403 — for the owning candidate', async () => {
    const { store, app, candidate } = await setup()
    const resume = await seedResume(store, { owner_user_id: candidate.user.id })

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', candidate.cookie)
      .attach('file', DOCX_BYTES, { filename: 'resume.docx', contentType: DOCX_MIME })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.error.message).toBe('file must be a PDF document')
  })
})

describe('GET /api/resume/:id/html — removed route', () => {
  it('no longer exists for a PDF resume', async () => {
    const { store, app, admin } = await setup()
    const resume = await seedResume(store)

    const response = await request(app).get(`/api/resume/${resume.id}/html`).set('Cookie', admin.cookie)

    // 404 is Express's own unmatched-route page (which is itself text/html), so
    // the proof that no preview is being served is the status plus the absence
    // of any of the resume's own content in the body.
    expect(response.status).toBe(404)
    expect(response.text ?? '').not.toContain('resume text')
  })

  it('no longer exists for a legacy DOCX resume either — the case it used to serve', async () => {
    const { store, app, admin } = await setup()
    const resume = await seedResume(store, { mime_type: DOCX_MIME, file_name: 'legacy.docx', file_data: DOCX_BYTES })

    const response = await request(app).get(`/api/resume/${resume.id}/html`).set('Cookie', admin.cookie)

    expect(response.status).toBe(404)
  })
})

describe('legacy DOCX row — no migration ran, so it must stay readable', () => {
  it('still downloads via GET /:id/file with its original bytes and mime type', async () => {
    const { store, app, admin } = await setup()
    const resume = await seedResume(store, { mime_type: DOCX_MIME, file_name: 'legacy.docx', file_data: DOCX_BYTES })

    const response = await request(app)
      .get(`/api/resume/${resume.id}/file`)
      .set('Cookie', admin.cookie)
      .responseType('blob')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain(DOCX_MIME)
    expect(response.headers['content-disposition']).toContain('inline')
    expect(Buffer.from(response.body).toString()).toBe(DOCX_BYTES.toString())
  })

  // This case is about the attachment disposition, not about who may read the
  // row, so the seeded legacy CV is owned by the requesting candidate: since
  // .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md a Candidate
  // gets 403 on a null-owner CV, which would fail here for a reason that has
  // nothing to do with DOCX support. Ownership itself is covered in
  // tests/authorization.test.ts.
  it('still downloads as an attachment with ?download=1', async () => {
    const { store, app, candidate } = await setup()
    const resume = await seedResume(store, {
      mime_type: DOCX_MIME,
      file_name: 'legacy.docx',
      file_data: DOCX_BYTES,
      owner_user_id: candidate.user.id
    })

    const response = await request(app)
      .get(`/api/resume/${resume.id}/file?download=1`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain('attachment')
  })

  it('still lists and reads via GET /:id, keeping its legacy mime_type visible to the client', async () => {
    const { store, app, admin } = await setup()
    const resume = await seedResume(store, { mime_type: DOCX_MIME, file_name: 'legacy.docx', file_data: DOCX_BYTES })

    const response = await request(app).get(`/api/resume/${resume.id}`).set('Cookie', admin.cookie)

    expect(response.status).toBe(200)
    expect(response.body.mime_type).toBe(DOCX_MIME)
  })
})
