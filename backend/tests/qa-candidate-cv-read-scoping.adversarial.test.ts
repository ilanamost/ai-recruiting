import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/extraction', () => ({
  SUPPORTED_MIME_TYPES: ['application/pdf'],
  extractText: vi.fn().mockResolvedValue('mocked extracted text')
}))

vi.mock('../src/analysis', () => ({
  analyzeResume: vi.fn().mockResolvedValue({ years_experience: 5, skills: ['node'] })
}))

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

/**
 * QA adversarial pass over
 * .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md.
 *
 * tests/authorization.test.ts already covers the plan's own cases (list
 * narrowing, 403 on another candidate's / a null-owner CV by id and by file,
 * Admin+Recruiter staying unfiltered). This file only tries to get AROUND
 * that boundary: the paginated door, the `?download=1` door, the HEAD
 * request JobCvsModal's preview actually issues, a client-supplied
 * `owner_user_id` query param, and a hostile id.
 */

async function seedResume(store: Store, ownerId: string | null, name: string) {
  const candidate = await store.createCandidate({ name, email: `${name.replace(/\s+/g, '.')}@example.com` })
  return store.createResume({
    candidate_id: candidate.id,
    file_name: `${name.replace(/\s+/g, '-')}.pdf`,
    mime_type: 'application/pdf',
    content: 'resume text',
    file_data: Buffer.from('%PDF-1.4 fake bytes'),
    owner_user_id: ownerId
  })
}

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  const admin = await createAuthedUser(store, 'admin')
  const candidate = await createAuthedUser(store, 'candidate')
  const otherCandidate = await createAuthedUser(store, 'candidate')
  return { store, app, admin, candidate, otherCandidate }
}

describe('.plan/032 adversarial — the paginated door', () => {
  // The plan puts the owner filter BEFORE the slice specifically so `total` is
  // the per-owner count. If it ran after, page 1 of a limit-2 request would
  // show 0-2 rows out of an inflated total and page 2 would leak whatever the
  // global ordering pushed into that window.
  it('pages a candidate through only their own CVs, with a per-owner total on every page', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    // Interleaved so a filter that ran after the slice would land other
    // candidates' rows inside page 1's window.
    await seedResume(store, otherCandidate.user.id, 'Other One')
    const ownA = await seedResume(store, candidate.user.id, 'Own A')
    await seedResume(store, null, 'Unowned One')
    const ownB = await seedResume(store, candidate.user.id, 'Own B')
    await seedResume(store, otherCandidate.user.id, 'Other Two')
    const ownC = await seedResume(store, candidate.user.id, 'Own C')

    const first = await request(app).get('/api/resume?page=1&limit=2').set('Cookie', candidate.cookie)
    const second = await request(app).get('/api/resume?page=2&limit=2').set('Cookie', candidate.cookie)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.total).toBe(3)
    expect(second.body.total).toBe(3)
    expect(first.body.items).toHaveLength(2)
    expect(second.body.items).toHaveLength(1)

    const seen = [...first.body.items, ...second.body.items].map((resume: { id: string }) => resume.id)
    expect(new Set(seen)).toEqual(new Set([ownA.id, ownB.id, ownC.id]))
  })

  it('returns an empty page, not somebody else\'s, for a candidate who owns nothing', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    await seedResume(store, otherCandidate.user.id, 'Other One')
    await seedResume(store, null, 'Unowned One')

    const response = await request(app).get('/api/resume').set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
    expect(response.body.total).toBe(0)
    // Nothing of the other candidate survives anywhere in the payload — not the
    // name, the email, or the file name. Asserting on the raw body catches a
    // leak through a field the item-level assertions above don't name.
    expect(JSON.stringify(response.body)).not.toContain('Other One')
    expect(JSON.stringify(response.body)).not.toContain('Unowned One')
  })

  // The route builds the store params itself; a client-supplied owner_user_id
  // must not reach listResumes and widen (or redirect) the filter.
  it('ignores a client-supplied owner_user_id query param', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const own = await seedResume(store, candidate.user.id, 'Own A')
    await seedResume(store, otherCandidate.user.id, 'Other One')

    const response = await request(app)
      .get(`/api/resume?owner_user_id=${otherCandidate.user.id}`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].id).toBe(own.id)
    expect(response.body.total).toBe(1)
  })
})

describe('.plan/032 adversarial — the file-route doors', () => {
  it('403s on GET /api/resume/:id/file?download=1 for another candidate\'s resume', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const other = await seedResume(store, otherCandidate.user.id, 'Other One')

    const response = await request(app)
      .get(`/api/resume/${other.id}/file?download=1`)
      .set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  // JobCvsModal's preview probes the file with HEAD before rendering the
  // iframe. Express serves HEAD off the same router.get handler, so the
  // ownership check has to hold there too — otherwise a HEAD probe would
  // confirm the existence of another candidate's CV file.
  it('403s on HEAD /api/resume/:id/file for another candidate\'s resume', async () => {
    const { store, app, candidate, otherCandidate } = await setup()
    const other = await seedResume(store, otherCandidate.user.id, 'Other One')

    const response = await request(app).head(`/api/resume/${other.id}/file`).set('Cookie', candidate.cookie)

    expect(response.status).toBe(403)
  })

  it('still serves the candidate\'s own file on GET, HEAD, and ?download=1', async () => {
    const { store, app, candidate } = await setup()
    const own = await seedResume(store, candidate.user.id, 'Own A')

    expect((await request(app).get(`/api/resume/${own.id}/file`).set('Cookie', candidate.cookie)).status).toBe(200)
    expect((await request(app).head(`/api/resume/${own.id}/file`).set('Cookie', candidate.cookie)).status).toBe(200)
    expect(
      (await request(app).get(`/api/resume/${own.id}/file?download=1`).set('Cookie', candidate.cookie)).status
    ).toBe(200)
  })

  // The new candidate-only getResume lookup on the file route must not turn a
  // hostile id into a 500 (or a different status than the detail route gives).
  it('404s on a very long / malformed id on both read routes rather than erroring', async () => {
    const { app, candidate } = await setup()
    const hostileId = `${'a'.repeat(4000)}%20or%201=1`

    const detail = await request(app).get(`/api/resume/${hostileId}`).set('Cookie', candidate.cookie)
    const file = await request(app).get(`/api/resume/${hostileId}/file`).set('Cookie', candidate.cookie)

    expect(detail.status).toBe(404)
    expect(file.status).toBe(404)
  })
})

describe('.plan/032 adversarial — the boundary is per-role, not per-request', () => {
  // The filter keys off req.user.role, so an Admin request made while a
  // candidate's rows exist must stay wide, and a candidate request must stay
  // narrow, against the exact same store.
  it('serves the same store wide to Admin and narrow to the candidate', async () => {
    const { store, app, admin, candidate, otherCandidate } = await setup()
    await seedResume(store, candidate.user.id, 'Own A')
    const other = await seedResume(store, otherCandidate.user.id, 'Other One')
    await seedResume(store, null, 'Unowned One')

    const adminList = await request(app).get('/api/resume').set('Cookie', admin.cookie)
    const candidateList = await request(app).get('/api/resume').set('Cookie', candidate.cookie)

    expect(adminList.body.total).toBe(3)
    expect(candidateList.body.total).toBe(1)
    // And the id the candidate was denied is one the Admin can still open.
    expect((await request(app).get(`/api/resume/${other.id}`).set('Cookie', admin.cookie)).status).toBe(200)
    expect((await request(app).get(`/api/resume/${other.id}`).set('Cookie', candidate.cookie)).status).toBe(403)
  })

  // The other candidate is not a special case of "some other user": a
  // Candidate must not reach a CV owned by an Admin user either.
  it('403s a candidate on a CV owned by an admin user', async () => {
    const { store, app, admin, candidate } = await setup()
    const adminOwned = await seedResume(store, admin.user.id, 'Admin Owned')

    expect((await request(app).get(`/api/resume/${adminOwned.id}`).set('Cookie', candidate.cookie)).status).toBe(403)
    expect(
      (await request(app).get(`/api/resume/${adminOwned.id}/file`).set('Cookie', candidate.cookie)).status
    ).toBe(403)
  })
})
