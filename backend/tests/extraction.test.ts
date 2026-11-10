import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { extractText } from '../src/extraction'
import { ValidationError } from '../src/lib/errors'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

// Analysis is a live Claude call elsewhere — never reach it from these tests.
vi.mock('../src/analysis', () => ({
  analyzeResume: vi.fn().mockResolvedValue({ years_experience: 5, skills: ['node'] })
}))

const PDF = 'application/pdf'
const UNREADABLE = 'Could not read this PDF. Please re-export it and try again.'

/** Builds a minimal single-page PDF with a correct xref table. */
function buildPdf(text: string, opts: { brokenXref?: boolean } = {}): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    const shown = opts.brokenXref ? offset + 7777 : offset
    body += `${String(shown).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${opts.brokenXref ? 99999 : xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

describe('extractText', () => {
  it('rejects an unsupported mime type', async () => {
    await expect(extractText(Buffer.from('hello'), 'text/plain')).rejects.toThrow(
      'Unsupported resume file type'
    )
  })

  it('extracts text from a valid PDF', async () => {
    const text = await extractText(buildPdf('Senior Node Engineer'), PDF)
    expect(text).toContain('Senior Node Engineer')
  })

  it('never throws a non-validation error for a PDF with a damaged xref table', async () => {
    let outcome: string | Error
    try {
      outcome = await extractText(buildPdf('Damaged Xref CV', { brokenXref: true }), PDF)
    } catch (error) {
      outcome = error as Error
    }
    if (outcome instanceof Error) {
      expect(outcome).toBeInstanceOf(ValidationError)
      expect((outcome as ValidationError).status).toBe(422)
    } else {
      expect(outcome).toContain('Damaged Xref CV')
    }
  })

  it('maps an empty buffer to a 422 validation error', async () => {
    const error = await extractText(Buffer.alloc(0), PDF).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.status).toBe(422)
    expect(error.message).toBe(UNREADABLE)
  })

  it('maps non-PDF bytes declared as a PDF to a 422 validation error', async () => {
    const error = await extractText(Buffer.from('this is not a pdf at all'), PDF).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.status).toBe(422)
  })

  it('does not log file contents when parsing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await extractText(Buffer.from('SECRET-CV-CONTENT'), PDF).catch(() => {})
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-CV-CONTENT')
    spy.mockRestore()
  })
})

describe('resume upload with an unreadable PDF', () => {
  async function setup() {
    const store = createMemoryStore()
    const app = createApp(store)
    const { cookie } = await createAuthedUser(store, 'admin')
    return { store, app, cookie }
  }

  const bad = Buffer.from('definitely not a pdf')

  it('POST /api/resume returns 422 in the standard error shape and persists nothing', async () => {
    const { store, app, cookie } = await setup()
    const before = await store.listResumes({ page: 1, limit: 50 })

    const response = await request(app)
      .post('/api/resume')
      .set('Cookie', cookie)
      .field('name', 'Jane Doe')
      .field('email', 'jane@example.com')
      .attach('file', bad, { filename: 'cv.pdf', contentType: PDF })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.error.message).toBe(UNREADABLE)
    const after = await store.listResumes({ page: 1, limit: 50 })
    expect(after.total).toBe(before.total)
  })

  it('PUT /api/resume/:id/file returns 422 and leaves the resume unchanged', async () => {
    const { store, app, cookie } = await setup()
    const candidate = await store.createCandidate({ name: 'Jane', email: 'jane@example.com' })
    const resume = await store.createResume({
      candidate_id: candidate.id,
      file_name: 'old.pdf',
      mime_type: PDF,
      content: 'old content',
      file_data: Buffer.from('old')
    })

    const response = await request(app)
      .put(`/api/resume/${resume.id}/file`)
      .set('Cookie', cookie)
      .attach('file', bad, { filename: 'new.pdf', contentType: PDF })

    expect(response.status).toBe(422)
    expect(response.body.error.message).toBe(UNREADABLE)
    const unchanged = await store.getResume(resume.id)
    expect(unchanged?.file_name).toBe('old.pdf')
    expect(unchanged?.content).toBe('old content')
  })
})
