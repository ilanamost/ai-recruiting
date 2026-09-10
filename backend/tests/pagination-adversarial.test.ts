import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi.fn().mockResolvedValue('resume text')
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, parsePageParams } from '../src/lib/pagination'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

// QA adversarial pass for .plan/028's pagination. The implementing agents covered the happy
// path and the documented clamping matrix; everything here is a case they did not run —
// duplicate query params, numeric forms that survive `Number()` but should not survive
// clamping, absurd page numbers, and the "no row is lost or duplicated across pages" property
// that a plain per-page length assertion cannot prove.
async function setup(role: 'admin' | 'recruiter' | 'candidate' = 'admin') {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie } = await createAuthedUser(store, role)
  return { store, app, cookie }
}

async function seedJobs(store: Store, count: number, org_id = 'demo-org') {
  for (let i = 0; i < count; i += 1) {
    await store.createJob({ org_id, title: `Job ${i}`, description: `Description ${i}` })
  }
}

async function seedResumes(store: Store, count: number) {
  for (let i = 0; i < count; i += 1) {
    const candidate = await store.createCandidate({ name: `Candidate ${i}`, email: `c${i}@example.com` })
    await store.createResume({
      candidate_id: candidate.id,
      file_name: `resume-${i}.pdf`,
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake')
    })
  }
}

describe('parsePageParams — clamping matrix beyond the documented cases', () => {
  it('defaults both params when the query object is empty', () => {
    expect(parsePageParams({})).toEqual({ page: 1, limit: DEFAULT_PAGE_LIMIT })
  })

  it('truncates a fractional value toward zero rather than passing a float to the store', () => {
    // A float `limit` would reach `slice`/`LIMIT` as-is; Postgres rejects a non-integer LIMIT.
    expect(parsePageParams({ page: '2.9', limit: '7.9' })).toEqual({ page: 2, limit: 7 })
  })

  it('falls back when a fraction truncates below 1 rather than producing a zero-row page', () => {
    expect(parsePageParams({ page: '0.5', limit: '0.9' })).toEqual({ page: 1, limit: DEFAULT_PAGE_LIMIT })
  })

  it('rejects Infinity and NaN-producing input instead of computing an Infinite offset', () => {
    for (const value of ['Infinity', '-Infinity', '1e400', 'NaN', 'null', 'undefined']) {
      expect(parsePageParams({ page: value, limit: value })).toEqual({ page: 1, limit: DEFAULT_PAGE_LIMIT })
    }
  })

  it('ignores a non-scalar param (object/boolean) rather than coercing it', () => {
    expect(parsePageParams({ page: { evil: true }, limit: true })).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_LIMIT
    })
  })

  it('takes the first value of a repeated param, deterministically', () => {
    // Express parses `?page=2&page=5` into an array. Silently using the last value, or NaN-ing
    // the whole request, would both be surprising.
    expect(parsePageParams({ page: ['2', '5'], limit: ['3', '9'] })).toEqual({ page: 2, limit: 3 })
  })

  it('caps limit but deliberately does NOT cap page — a large page is an empty page, not a cap', () => {
    const parsed = parsePageParams({ page: '10000', limit: '99999' })
    expect(parsed.limit).toBe(MAX_PAGE_LIMIT)
    expect(parsed.page).toBe(10000)
  })

  it('clamps a page far past Number.MAX_SAFE_INTEGER instead of overflowing', () => {
    const parsed = parsePageParams({ page: '99999999999999999999999' })
    expect(Number.isSafeInteger(parsed.page)).toBe(true)
    expect(parsed.page).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('GET /api/job — adversarial pagination', () => {
  it('partitions the full list across pages with no loss and no duplication', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 25)

    const seen: string[] = []
    for (let page = 1; page <= 4; page += 1) {
      const response = await request(app).get(`/api/job?org_id=demo-org&page=${page}&limit=7`).set('Cookie', cookie)
      expect(response.status).toBe(200)
      expect(response.body.total).toBe(25)
      seen.push(...response.body.items.map((job: { id: string }) => job.id))
    }

    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
  })

  it('survives a repeated page param without NaN-ing the offset', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 25)

    const response = await request(app).get('/api/job?org_id=demo-org&page=2&page=5&limit=10').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.page).toBe(2)
    expect(response.body.items).toHaveLength(10)
  })

  it('returns an empty page, not a crash or a 500, for an absurdly large page number', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 3)

    const response = await request(app)
      .get('/api/job?org_id=demo-org&page=99999999999999999999')
      .set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    expect(response.body.total).toBe(3)
  })

  it('treats an injection-shaped limit as invalid input and clamps it', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 12)

    const response = await request(app)
      .get(`/api/job?org_id=demo-org&limit=${encodeURIComponent('10; drop table job')}`)
      .set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.limit).toBe(DEFAULT_PAGE_LIMIT)
    expect(response.body.items).toHaveLength(10)
  })

  it('keeps org scoping ahead of paging — another org never bleeds onto a later page', async () => {
    const { store, app, cookie } = await setup()
    await seedJobs(store, 4, 'demo-org')
    await seedJobs(store, 30, 'other-org')

    const response = await request(app).get('/api/job?org_id=demo-org&page=2&limit=2').set('Cookie', cookie)

    expect(response.body.total).toBe(4)
    expect(response.body.items).toHaveLength(2)
    for (const job of response.body.items) {
      expect(job.org_id).toBe('demo-org')
    }
  })

  it('still validates org_id ahead of paging — a valid page does not excuse a missing org', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/job?page=1&limit=10').set('Cookie', cookie)

    expect(response.status).toBe(400)
    expect(response.body).not.toHaveProperty('items')
  })

  // Negative authorization case alongside the positive one (house style,
  // backend/tests/authorization.test.ts): pagination must not become an unauthenticated read.
  it('401s an unauthenticated paged request and leaks no items', async () => {
    const { store, app } = await setup()
    await seedJobs(store, 12)

    const response = await request(app).get('/api/job?org_id=demo-org&page=1&limit=500')

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('items')
    expect(response.body).not.toHaveProperty('total')
  })

  it('serves the same page to a recruiter as to an admin — this list is not role-narrowed', async () => {
    const { store, app, cookie } = await setup('recruiter')
    await seedJobs(store, 12)

    const response = await request(app).get('/api/job?org_id=demo-org&page=2').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(12)
    expect(response.body.items).toHaveLength(2)
  })
})

describe('GET /api/resume — adversarial pagination', () => {
  it('partitions the full list across pages with no loss and no duplication', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 23)

    const seen: string[] = []
    for (let page = 1; page <= 5; page += 1) {
      const response = await request(app).get(`/api/resume?page=${page}&limit=5`).set('Cookie', cookie)
      expect(response.status).toBe(200)
      expect(response.body.total).toBe(23)
      seen.push(...response.body.items.map((resume: { id: string }) => resume.id))
    }

    expect(seen).toHaveLength(23)
    expect(new Set(seen).size).toBe(23)
  })

  it('reports the true total on a page past the end so a pager can navigate back', async () => {
    const { store, app, cookie } = await setup()
    await seedResumes(store, 12)

    const response = await request(app).get('/api/resume?page=9&limit=10').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], total: 12, page: 9, limit: 10 })
  })

  it('returns a well-formed empty envelope for an empty table, not a bare array', async () => {
    const { app, cookie } = await setup()

    const response = await request(app).get('/api/resume').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ items: [], total: 0, page: 1, limit: 10 })
  })

  it('401s an unauthenticated paged request and leaks no items', async () => {
    const { store, app } = await setup()
    await seedResumes(store, 5)

    const response = await request(app).get('/api/resume?page=1&limit=500')

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('items')
  })
})

describe('memory-store Page<T> contract, called directly', () => {
  it('reports total as the pre-slice count, not the page length', async () => {
    const { store } = await setup()
    await seedJobs(store, 25)

    const page = await store.listJobs('demo-org', { page: 2, limit: 10 })

    expect(page.items).toHaveLength(10)
    expect(page.total).toBe(25)
  })

  it('returns an empty page rather than throwing when the offset is past the end', async () => {
    const { store } = await setup()
    await seedJobs(store, 3)

    const page = await store.listJobs('demo-org', { page: 50, limit: 10 })

    expect(page.items).toEqual([])
    expect(page.total).toBe(3)
  })

  // This case previously pinned the QA report's LOW finding as documentation: memory-store
  // answered a sub-1 page with an empty array while pg-store would send `OFFSET -10` to
  // Postgres and error. That divergence has since been fixed — both stores now clamp via
  // normalizePageParams, so a sub-1 page resolves to the first page exactly as it does at the
  // route layer (parsePageParams maps page=0 -> 1). Assertion flipped to the intended
  // behaviour; the cross-store equivalence is covered in tests/store-pagination.test.ts.
  it('clamps a sub-1 page to the first page, matching the route layer', async () => {
    const { store } = await setup()
    await seedJobs(store, 3)

    const page = await store.listJobs('demo-org', { page: 0, limit: 10 })
    const firstPage = await store.listJobs('demo-org', { page: 1, limit: 10 })

    expect(page.items.map((job) => job.id)).toEqual(firstPage.items.map((job) => job.id))
    expect(page.items).toHaveLength(3)
    expect(page.total).toBe(3)
  })
})
