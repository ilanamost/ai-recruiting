import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import type { Store } from '../src/store/types'
import { createAuthedUser } from './helpers/auth'

// QA adversarial pass on GET /api/job/:jobId/matches
// (.plan/021-2026-08-11-best-match-star.md). The happy paths live in
// job-resume-match.test.ts; this file only covers the cases that file's
// fixtures cannot fail on:
//  - the authorization boundary from the Candidate side that actually has
//    something to gain (they own the top-scoring attached CV),
//  - "latest wins" where latest is *lower* than the superseded score, so a
//    max-by-score bug can no longer pass by coincidence,
//  - a tie at the maximum, which the star renders on every tied row.

async function attachedResume(
  store: Store,
  jobId: string,
  overrides: Partial<{ name: string; email: string; owner_user_id: string }> = {}
) {
  const candidate = await store.createCandidate({
    name: overrides.name ?? 'Jane Doe',
    email: overrides.email ?? 'jane@example.com'
  })
  return store.createResume({
    candidate_id: candidate.id,
    job_id: jobId,
    file_name: 'resume.pdf',
    mime_type: 'application/pdf',
    content: 'resume text',
    file_data: Buffer.from('%PDF-1.4 fake bytes'),
    owner_user_id: overrides.owner_user_id
  })
}

/** Pins the clock so created_at ordering is deterministic, per the house pattern. */
async function matchAt(store: Store, at: string, input: { job_id: string; resume_id: string; score: number }) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(at))
  const match = await store.createMatch({ ...input, explanation: `Scored ${input.score} at ${at}` })
  vi.useRealTimers()
  return match
}

async function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  return { store, app }
}

describe('GET /api/job/:jobId/matches — authorization boundary (.plan/010 ownership)', () => {
  it('403s a Candidate who owns an attached resume that is the job\'s top scorer', async () => {
    const { store, app } = await setup()
    const { user, cookie } = await createAuthedUser(store, 'candidate')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    // The candidate's own CV is attached AND the highest scorer — the single
    // case where a "but it's their own data" shortcut would be tempting.
    const own = await attachedResume(store, job.id, { owner_user_id: user.id })
    const rival = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })
    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: own.id, score: 99 })
    await matchAt(store, '2026-01-02T00:00:00.000Z', { job_id: job.id, resume_id: rival.id, score: 40 })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('forbidden')
    // No score for anyone leaks through the error body — not the rival's, not their own.
    // Scoped to `error` rather than the whole body on purpose: `requestId` is a
    // server-generated UUID whose hex digits routinely contain '40' (and can
    // contain '99'), which made this a coin-flip failure with nothing leaked.
    // A score can only ever surface in the error payload, so that is what is
    // searched.
    expect(JSON.stringify(response.body.error)).not.toContain('99')
    expect(JSON.stringify(response.body.error)).not.toContain('40')
  })

  it('403s a Candidate before the job is even resolved, so it is not a job-existence oracle', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'candidate')

    // An unknown job 404s for Admin/Recruiter; Candidate must get 403 for both
    // known and unknown jobs, or the status code itself reveals job existence.
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const known = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)
    const unknown = await request(app).get('/api/job/unknown-job/matches').set('Cookie', cookie)

    expect(known.status).toBe(403)
    expect(unknown.status).toBe(403)
  })

  it('401s an unauthenticated request', async () => {
    const { store, app } = await setup()
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })

    const response = await request(app).get(`/api/job/${job.id}/matches`)

    expect(response.status).toBe(401)
  })
})

describe('GET /api/job/:jobId/matches — latest, not highest', () => {
  it('returns the most recent match even when it scores LOWER than the superseded one', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'admin')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const resume = await attachedResume(store, job.id)

    // A re-score that went DOWN. The existing suite's fixture re-scores upward,
    // so a "max score per resume" implementation would pass it by coincidence.
    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: resume.id, score: 95 })
    const newer = await matchAt(store, '2026-01-02T00:00:00.000Z', {
      job_id: job.id,
      resume_id: resume.id,
      score: 42
    })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ id: newer.id, score: 42 })
  })

  it('picks the latest per resume independently, across three re-scores each', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'admin')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const jane = await attachedResume(store, job.id)
    const john = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })

    // Interleaved re-scores: neither resume's latest is its own max, and the
    // globally-highest row (jane @ 98) is superseded — the star must land on
    // john, whose latest 70 beats jane's latest 55.
    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: jane.id, score: 98 })
    await matchAt(store, '2026-01-02T00:00:00.000Z', { job_id: job.id, resume_id: john.id, score: 88 })
    await matchAt(store, '2026-01-03T00:00:00.000Z', { job_id: job.id, resume_id: jane.id, score: 77 })
    const johnLatest = await matchAt(store, '2026-01-04T00:00:00.000Z', {
      job_id: job.id,
      resume_id: john.id,
      score: 70
    })
    const janeLatest = await matchAt(store, '2026-01-05T00:00:00.000Z', {
      job_id: job.id,
      resume_id: jane.id,
      score: 55
    })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(2)
    const byResume = Object.fromEntries(
      response.body.map((match: { resume_id: string; id: string; score: number }) => [match.resume_id, match])
    )
    expect(byResume[jane.id]).toMatchObject({ id: janeLatest.id, score: 55 })
    expect(byResume[john.id]).toMatchObject({ id: johnLatest.id, score: 70 })
    // The winner by latest score is john, not jane — despite jane holding the
    // highest row ever written for this job.
    const best = Math.max(...response.body.map((match: { score: number }) => match.score))
    expect(response.body.filter((match: { score: number }) => match.score === best)).toHaveLength(1)
    expect(byResume[john.id].score).toBe(best)
  })
})

describe('GET /api/job/:jobId/matches — ties and job isolation', () => {
  it('returns every resume tied at the maximum score, so the UI can star them all', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'admin')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const jane = await attachedResume(store, job.id)
    const john = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })
    const amy = await attachedResume(store, job.id, { name: 'Amy Lee', email: 'amy@example.com' })

    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: jane.id, score: 81 })
    await matchAt(store, '2026-01-02T00:00:00.000Z', { job_id: job.id, resume_id: john.id, score: 81 })
    await matchAt(store, '2026-01-03T00:00:00.000Z', { job_id: job.id, resume_id: amy.id, score: 12 })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    const best = Math.max(...response.body.map((match: { score: number }) => match.score))
    const tied = response.body
      .filter((match: { score: number }) => match.score === best)
      .map((match: { resume_id: string }) => match.resume_id)
      .sort()
    expect(tied).toEqual([jane.id, john.id].sort())
  })

  it('never lets a re-score for a DIFFERENT job move this job\'s best match', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'admin')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const otherJob = await store.createJob({ org_id: 'demo-org', title: 'Data Engineer', description: 'SQL' })
    const jane = await attachedResume(store, job.id)
    const john = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })
    await store.attachResumeToJob(otherJob.id, jane.id)

    // On THIS job john leads. On the other job jane scores 100 — later in time,
    // so any leaked cross-job row would both outrank john and look "latest".
    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: jane.id, score: 30 })
    await matchAt(store, '2026-01-02T00:00:00.000Z', { job_id: job.id, resume_id: john.id, score: 65 })
    await matchAt(store, '2026-01-09T00:00:00.000Z', { job_id: otherJob.id, resume_id: jane.id, score: 100 })

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(2)
    expect(response.body.every((match: { job_id: string }) => match.job_id === job.id)).toBe(true)
    const best = Math.max(...response.body.map((match: { score: number }) => match.score))
    expect(best).toBe(65)
    expect(response.body.find((match: { score: number }) => match.score === best).resume_id).toBe(john.id)
  })

  it('drops a detached resume\'s match, so a stale row cannot hold the star', async () => {
    const { store, app } = await setup()
    const { cookie } = await createAuthedUser(store, 'admin')
    const job = await store.createJob({ org_id: 'demo-org', title: 'Backend Engineer', description: 'Node' })
    const leaving = await attachedResume(store, job.id)
    const staying = await attachedResume(store, job.id, { name: 'John Roe', email: 'john@example.com' })

    await matchAt(store, '2026-01-01T00:00:00.000Z', { job_id: job.id, resume_id: leaving.id, score: 97 })
    await matchAt(store, '2026-01-02T00:00:00.000Z', { job_id: job.id, resume_id: staying.id, score: 51 })

    await store.detachResumeFromJob(job.id, leaving.id)

    const response = await request(app).get(`/api/job/${job.id}/matches`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].resume_id).toBe(staying.id)
  })
})
