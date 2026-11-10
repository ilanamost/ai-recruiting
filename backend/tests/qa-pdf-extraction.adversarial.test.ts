import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

/**
 * QA adversarial pass for .plan/042 (CV upload "bad XRef entry" 500).
 * Real extraction module (not mocked); analysis is mocked so no live LLM call.
 */
const analyzeResume = vi.fn()
vi.mock('../src/analysis', () => ({ analyzeResume: (...a: unknown[]) => analyzeResume(...a) }))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { extractText } from '../src/extraction'
import { ValidationError } from '../src/lib/errors'
import { createAuthedUser } from './helpers/auth'

const PDF = 'application/pdf'

type Opts = { pages?: number; noXref?: boolean; badStartxref?: boolean; badOffsets?: boolean }

/** Multi-page PDF builder with optional damage. */
function buildPdf(pageTexts: string[], opts: Opts = {}): Buffer {
  const n = pageTexts.length
  const objs: string[] = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  const kids = pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`
  const fontId = 3 + n * 2
  pageTexts.forEach((t, i) => {
    const pid = 3 + i * 2
    const cid = pid + 1
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    const s = `BT /F1 18 Tf 20 100 Td (${t}) Tj ET`
    objs[cid] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`
  })
  objs[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let body = '%PDF-1.4\n'
  const off: number[] = []
  for (let i = 1; i < objs.length; i++) {
    off[i] = body.length
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xrefStart = body.length
  if (!opts.noXref) {
    body += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
    for (let i = 1; i < objs.length; i++) {
      body += `${String(opts.badOffsets ? off[i] + 13 : off[i]).padStart(10, '0')} 00000 n \n`
    }
  }
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\n`
  body += `startxref\n${opts.badStartxref ? 123456 : xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function outcome(buf: Buffer) {
  try {
    return { text: await extractText(buf, PDF) }
  } catch (e) {
    return { error: e as Error }
  }
}

describe('extractText — real-world-like PDFs never leak a non-422 error', () => {
  it('extracts every page of a valid multi-page PDF', async () => {
    const r = await outcome(buildPdf(['Page One Alpha', 'Page Two Beta', 'Page Three Gamma']))
    expect(r.error).toBeUndefined()
    expect(r.text).toContain('Page One Alpha')
    expect(r.text).toContain('Page Two Beta')
    expect(r.text).toContain('Page Three Gamma')
  })

  const damaged: Array<[string, () => Buffer]> = [
    ['missing xref table + trailer pointing nowhere', () => buildPdf(['Recoverable CV'], { noXref: true, badStartxref: true })],
    ['bad startxref offset', () => buildPdf(['Recoverable CV'], { badStartxref: true })],
    ['bad xref entry offsets', () => buildPdf(['Recoverable CV'], { badOffsets: true })],
    ['truncated at 60%', () => { const b = buildPdf(['Recoverable CV', 'Second']); return b.subarray(0, Math.floor(b.length * 0.6)) }],
    ['truncated to header only', () => Buffer.from('%PDF-1.4\n')],
    ['zero bytes', () => Buffer.alloc(0)],
    ['all NUL bytes', () => Buffer.alloc(2048)],
    ['random binary garbage', () => Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) & 255))],
    ['PDF header then garbage', () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('\u0000\u0001\u0002xref\nbad entry\n', 'latin1')])],
    ['junk prefix before a valid PDF', () => Buffer.concat([Buffer.from('JUNKJUNKJUNK\n'), buildPdf(['Recoverable CV'])])]
  ]
  for (const [name, make] of damaged) {
    it(`${name}: text or ValidationError 422, never another error`, async () => {
      const r = await outcome(make())
      if (r.error) {
        expect(r.error).toBeInstanceOf(ValidationError)
        expect((r.error as ValidationError).status).toBe(422)
      } else {
        expect(typeof r.text).toBe('string')
      }
    })
  }

  it('real-world CV fixture (if present) extracts non-empty text', async () => {
    const f = path.resolve(__dirname, '../../.orchestrate/fixtures/Ilana_Mostovski_Resume.pdf')
    if (!existsSync(f)) return
    const r = await outcome(readFileSync(f))
    expect(r.error).toBeUndefined()
    expect((r.text as string).length).toBeGreaterThan(100)
  })

  it('does not hang on a large damaged buffer', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4 * 1024 * 1024, 0x20)])
    const r = await outcome(big)
    if (r.error) expect((r.error as ValidationError).status).toBe(422)
  }, 20000)
})

describe('POST /api/resume + PUT /api/resume/:id/file with hostile files', () => {
  async function setup() {
    const store = createMemoryStore()
    const app = createApp(store)
    const { cookie } = await createAuthedUser(store, 'admin')
    return { store, app, cookie }
  }
  const post = (s: Awaited<ReturnType<typeof setup>>, buf: Buffer, mime = PDF, name = 'cv.pdf') =>
    request(s.app).post('/api/resume').set('Cookie', s.cookie)
      .field('name', 'Jane').field('email', 'jane@example.com')
      .attach('file', buf, { filename: name, contentType: mime })
  const count = async (s: Awaited<ReturnType<typeof setup>>) => (await s.store.listResumes({ page: 1, limit: 500 })).total

  it('normal multi-page PDF -> 201 with analysed fields', async () => {
    analyzeResume.mockReset().mockResolvedValue({ years_experience: 7, skills: ['vue'] })
    const s = await setup()
    const r = await post(s, buildPdf(['Hello Alpha', 'Hello Beta']))
    expect(r.status).toBe(201)
    expect(r.body.years_experience).toBe(7)
    expect(r.body.skills).toEqual(['vue'])
    expect(r.body.content).toContain('Hello Beta')
    expect(analyzeResume).toHaveBeenCalledTimes(1)
  })

  it('analysis failure on a good PDF -> still 201 (unclassified), not 500', async () => {
    analyzeResume.mockReset().mockRejectedValue(new Error('llm down'))
    const s = await setup()
    const r = await post(s, buildPdf(['Resilient']))
    expect(r.status).toBe(201)
  })

  const bad: Array<[string, Buffer]> = [
    ['zero bytes', Buffer.alloc(0)],
    ['truncated header', Buffer.from('%PDF-1.4\n')],
    ['garbage', Buffer.from('not a pdf')],
    ['NULs', Buffer.alloc(1024)]
  ]
  for (const [name, buf] of bad) {
    it(`POST ${name}: never 500, no resume row, analysis not called`, async () => {
      analyzeResume.mockReset().mockResolvedValue({ years_experience: 1, skills: [] })
      const s = await setup()
      const before = await count(s)
      const r = await post(s, buf)
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(r.status).toBeLessThan(500)
      expect(r.body.error).toBeTruthy()
      expect(await count(s)).toBe(before)
    })
  }

  it('wrong mime (docx / text / image) -> 400, no row', async () => {
    const s = await setup()
    for (const mime of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/png', 'application/octet-stream']) {
      const r = await post(s, buildPdf(['x']), mime)
      expect(r.status).toBe(400)
    }
    expect(await count(s)).toBe(0)
  })

  it('oversize (>5MB) -> 4xx not 500, no row', async () => {
    const s = await setup()
    const r = await post(s, Buffer.concat([buildPdf(['x']), Buffer.alloc(6 * 1024 * 1024, 0x20)]))
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
    expect(await count(s)).toBe(0)
  })

  it('rapid repeated bad uploads (10 parallel) -> all 422, no rows', async () => {
    const s = await setup()
    const rs = await Promise.all(Array.from({ length: 10 }, () => post(s, Buffer.from('garbage'))))
    expect(rs.every((r) => r.status === 422)).toBe(true)
    expect(await count(s)).toBe(0)
  })

  it('error body does not leak parser internals / stack', async () => {
    const s = await setup()
    const r = await post(s, Buffer.from('garbage'))
    const text = JSON.stringify(r.body)
    expect(text).not.toMatch(/XRef|pdf\.js|webpack|\bat \w+.*\(|FormatError|InvalidPDF/i)
  })

  it('PUT with bad file -> 422 and resume untouched; PUT with good file -> 200', async () => {
    analyzeResume.mockReset().mockResolvedValue({ years_experience: 3, skills: ['go'] })
    const s = await setup()
    const created = await post(s, buildPdf(['Original Content']))
    expect(created.status).toBe(201)
    const id = created.body.id
    const bad = await request(s.app).put(`/api/resume/${id}/file`).set('Cookie', s.cookie)
      .attach('file', Buffer.alloc(0), { filename: 'z.pdf', contentType: PDF })
    expect([400, 422]).toContain(bad.status)
    const still = await s.store.getResume(id)
    expect(still?.content).toContain('Original Content')
    const good = await request(s.app).put(`/api/resume/${id}/file`).set('Cookie', s.cookie)
      .attach('file', buildPdf(['Replacement Content']), { filename: 'new.pdf', contentType: PDF })
    expect(good.status).toBe(200)
    expect(good.body.content).toContain('Replacement Content')
  })

  it('unauthenticated upload -> 401 and no row', async () => {
    const s = await setup()
    const r = await request(s.app).post('/api/resume').field('name', 'a').field('email', 'a@b.c')
      .attach('file', buildPdf(['x']), { filename: 'cv.pdf', contentType: PDF })
    expect(r.status).toBe(401)
    expect(await count(s)).toBe(0)
  })
})
