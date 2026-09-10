import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

// QA adversarial pass for .plan/013-2026-08-10-job-search-filter.md.
// backend/tests/job.test.ts already covers the happy paths (location persists, null when
// omitted, '' normalizes to null on create and patch, duplicate copies it). These are the
// hostile inputs it does not exercise: wrong types, whitespace-only, explicit null, the
// patch "at least one field" guard reached via location alone, oversized input, and the
// role gate still holding when a location is present in the body.

async function setup(role: 'admin' | 'recruiter' | 'candidate' = 'admin') {
  const store = createMemoryStore()
  const app = createApp(store)
  const { cookie, user } = await createAuthedUser(store, role)
  return { store, app, cookie, user }
}

const baseJob = { org_id: 'demo-org', title: 'Backend Engineer', description: 'Node and TypeScript' }

describe('POST /api/job — location adversarial input', () => {
  it('400s when location is a non-string (number)', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: 42 })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toContain('location must be a string')
  })

  it('400s when location is an object', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: { city: 'Berlin' } })

    expect(response.status).toBe(400)
  })

  it('normalizes a whitespace-only location to null rather than storing spaces', async () => {
    const { app, cookie, store } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: '   \t  ' })

    expect(response.status).toBe(201)
    expect(response.body.location).toBeNull()
    expect((await store.getJob(response.body.id))?.location).toBeNull()
  })

  it('accepts an explicit null location', async () => {
    const { app, cookie } = await setup()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: null })

    expect(response.status).toBe(201)
    expect(response.body.location).toBeNull()
  })

  it('persists a long location string without truncating it', async () => {
    const { app, cookie, store } = await setup()
    const longLocation = 'Berlin, '.repeat(200).trim()

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: longLocation })

    expect(response.status).toBe(201)
    expect(response.body.location).toBe(longLocation)
    expect((await store.getJob(response.body.id))?.location).toBe(longLocation)
  })

  it('still 403s a candidate creating a job, location in the body or not', async () => {
    const { app, cookie } = await setup('candidate')

    const response = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: 'Tel Aviv' })

    expect(response.status).toBe(403)
  })

  it('still 401s an unauthenticated create carrying a location', async () => {
    const { app } = await setup()

    const response = await request(app).post('/api/job').send({ ...baseJob, location: 'Tel Aviv' })

    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/job/:id — location adversarial input', () => {
  async function createJob(app: ReturnType<typeof createApp>, cookie: string, location?: string) {
    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send(location === undefined ? baseJob : { ...baseJob, location })
    return created.body
  }

  it('400s when location is a non-string', async () => {
    const { app, cookie } = await setup()
    const job = await createJob(app, cookie, 'Tel Aviv')

    const response = await request(app).patch(`/api/job/${job.id}`).set('Cookie', cookie).send({ location: 7 })

    expect(response.status).toBe(400)
    // The rejected patch must not have partially applied.
    expect((await request(app).get(`/api/job/${job.id}`).set('Cookie', cookie)).body.location).toBe('Tel Aviv')
  })

  it('satisfies the "at least one field" guard with location alone', async () => {
    const { app, cookie } = await setup()
    const job = await createJob(app, cookie)

    const response = await request(app)
      .patch(`/api/job/${job.id}`)
      .set('Cookie', cookie)
      .send({ location: 'Haifa' })

    expect(response.status).toBe(200)
    expect(response.body.location).toBe('Haifa')
    expect(response.body.title).toBe(baseJob.title)
    expect(response.body.description).toBe(baseJob.description)
  })

  it('still 400s an empty patch body now that location counts toward the guard', async () => {
    const { app, cookie } = await setup()
    const job = await createJob(app, cookie)

    const response = await request(app).patch(`/api/job/${job.id}`).set('Cookie', cookie).send({})

    expect(response.status).toBe(400)
  })

  it('clears a location with an explicit null', async () => {
    const { app, cookie, store } = await setup()
    const job = await createJob(app, cookie, 'Tel Aviv')

    const response = await request(app).patch(`/api/job/${job.id}`).set('Cookie', cookie).send({ location: null })

    expect(response.status).toBe(200)
    expect(response.body.location).toBeNull()
    expect((await store.getJob(job.id))?.location).toBeNull()
  })

  it('normalizes a whitespace-only location to null on patch', async () => {
    const { app, cookie, store } = await setup()
    const job = await createJob(app, cookie, 'Tel Aviv')

    const response = await request(app).patch(`/api/job/${job.id}`).set('Cookie', cookie).send({ location: '  ' })

    expect(response.status).toBe(200)
    expect(response.body.location).toBeNull()
    expect((await store.getJob(job.id))?.location).toBeNull()
  })

  it('still 403s a candidate patching a location', async () => {
    const { app, cookie, store } = await setup()
    const job = await createJob(app, cookie, 'Tel Aviv')
    const { cookie: candidateCookie } = await createAuthedUser(store, 'candidate')

    const response = await request(app)
      .patch(`/api/job/${job.id}`)
      .set('Cookie', candidateCookie)
      .send({ location: 'Haifa' })

    expect(response.status).toBe(403)
  })

  it('does not store an empty string anywhere the frontend can send one', async () => {
    // JobForm.vue / JobsListPage.vue send the raw input value, so a blank field arrives as ''.
    // The frontend's location search never matches a stored '', so a leaked '' would silently
    // hide jobs from every location search — this asserts the server-side normalization the
    // frontend report flagged as a dependency.
    const { app, cookie, store } = await setup()

    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: '' })
    const patched = await request(app)
      .patch(`/api/job/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Renamed', description: baseJob.description, location: '' })

    expect(created.body.location).toBeNull()
    expect(patched.body.location).toBeNull()
    expect((await store.getJob(created.body.id))?.location).toBeNull()
    const listed = await store.listJobs('demo-org', { page: 1, limit: 10 })
    expect(listed.items.every((job) => job.location !== '')).toBe(true)
  })
})

describe('POST /api/job/:id/duplicate — location adversarial', () => {
  it('carries a long location onto the duplicate unchanged', async () => {
    const { app, cookie } = await setup()
    const longLocation = 'Remote — EMEA / '.repeat(50).trim()
    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: longLocation })

    const response = await request(app).post(`/api/job/${created.body.id}/duplicate`).set('Cookie', cookie)

    expect(response.status).toBe(201)
    expect(response.body.location).toBe(longLocation)
    expect(response.body.id).not.toBe(created.body.id)
  })

  it('keeps the duplicate null when the source location was normalized away from an empty string', async () => {
    const { app, cookie } = await setup()
    const created = await request(app)
      .post('/api/job')
      .set('Cookie', cookie)
      .send({ ...baseJob, location: '   ' })

    const response = await request(app).post(`/api/job/${created.body.id}/duplicate`).set('Cookie', cookie)

    expect(response.status).toBe(201)
    expect(response.body.location).toBeNull()
  })
})
