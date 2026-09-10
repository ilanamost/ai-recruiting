import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  attachResumeToJob,
  detachResumeFromJob,
  duplicateJob,
  getResumeFileUrl,
  listJobResumes,
  listJobs,
  listResumes,
  replaceResumeFile,
  uploadResume
} from '../src/lib/api'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as Response
}

describe('lib/api — job/CV attach, duplicate, file endpoints', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('duplicateJob POSTs to /api/job/:id/duplicate and returns the new job', async () => {
    const newJob = {
      id: 'job-2',
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node and TypeScript',
      created_at: '2026-07-05T00:00:00.000Z'
    }
    fetchMock.mockResolvedValue(jsonResponse(newJob))

    const result = await duplicateJob('job-1')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job/job-1/duplicate', {
      method: 'POST',
      credentials: 'include'
    })
    expect(result).toEqual(newJob)
  })

  it('duplicateJob throws an ApiError when the job is not found', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'not_found', message: 'Job not found' }, requestId: 'req-1' }, { ok: false, status: 404 })
    )

    await expect(duplicateJob('missing')).rejects.toThrow(ApiError)
  })

  it('listJobResumes GETs /api/job/:id/resumes', async () => {
    const resumes = [{ id: 'resume-1', attached_at: '2026-07-01T00:00:00.000Z' }]
    fetchMock.mockResolvedValue(jsonResponse(resumes))

    const result = await listJobResumes('job-1')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job/job-1/resumes', { credentials: 'include' })
    expect(result).toEqual(resumes)
  })

  it('attachResumeToJob POSTs the resume_id as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))

    await attachResumeToJob('job-1', 'resume-1')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job/job-1/resumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
      credentials: 'include'
    })
  })

  it('detachResumeFromJob DELETEs the job/resume pair', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined } as Response)

    await detachResumeFromJob('job-1', 'resume-1')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job/job-1/resumes/resume-1', {
      method: 'DELETE',
      credentials: 'include'
    })
  })

  it('getResumeFileUrl builds an inline URL by default and an attachment URL with download', () => {
    expect(getResumeFileUrl('resume-1')).toBe('http://localhost:3001/api/resume/resume-1/file')
    expect(getResumeFileUrl('resume-1', { download: true })).toBe(
      'http://localhost:3001/api/resume/resume-1/file?download=1'
    )
  })

  it('replaceResumeFile PUTs multipart form data with the new file', async () => {
    const updatedResume = { id: 'resume-1', file_name: 'new.pdf' }
    fetchMock.mockResolvedValue(jsonResponse(updatedResume))
    const file = new File(['%PDF-1.4'], 'new.pdf', { type: 'application/pdf' })

    const result = await replaceResumeFile('resume-1', file)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/resume/resume-1/file')
    expect(init.method).toBe('PUT')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('file')).toBe(file)
    expect(result).toEqual(updatedResume)
  })

  it('uploadResume omits job_id from the form data when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'resume-1' }))
    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })

    await uploadResume({ name: 'Jane Doe', email: 'jane@example.com', file })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body.has('job_id')).toBe(false)
  })

  it('uploadResume includes job_id in the form data when provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'resume-1' }))
    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' })

    await uploadResume({ name: 'Jane Doe', email: 'jane@example.com', file, job_id: 'job-1' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body.get('job_id')).toBe('job-1')
  })

  it('listResumes GETs /api/resume with no query params when no paging is asked for', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, limit: 10 }))

    await listResumes()

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/resume', { credentials: 'include' })
  })
})

// .plan/028 / `.orchestrate/api-contract.yaml`: both list endpoints take `page`/`limit` and
// return a `{ items, total, page, limit }` envelope instead of a bare array.
describe('lib/api — paginated list endpoints', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listJobs appends page and limit after the existing org_id filter', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 2, limit: 10 }))

    await listJobs('demo-org', { page: 2, limit: 10 })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job?org_id=demo-org&page=2&limit=10', {
      credentials: 'include'
    })
  })

  it('listJobs keeps org_id url-encoded and omits paging params it was not given', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, limit: 10 }))

    await listJobs('acme corp/eu')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/job?org_id=acme%20corp%2Feu', {
      credentials: 'include'
    })
  })

  it('listJobs returns the envelope unchanged', async () => {
    const envelope = {
      items: [{ id: 'job-1', org_id: 'demo-org', title: 'Backend Engineer' }],
      total: 24,
      page: 2,
      limit: 10
    }
    fetchMock.mockResolvedValue(jsonResponse(envelope))

    await expect(listJobs('demo-org', { page: 2, limit: 10 })).resolves.toEqual(envelope)
  })

  it('listResumes puts page and limit in its own query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 3, limit: 25 }))

    await listResumes({ page: 3, limit: 25 })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/resume?page=3&limit=25', {
      credentials: 'include'
    })
  })

  // Failure path: a list endpoint's error response is an ApiError like any other, envelope or
  // not — the caller must not receive a half-built page object.
  it('listJobs throws an ApiError instead of returning a partial envelope on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'validation_error', message: 'org_id is required' }, requestId: 'req-9' },
        { ok: false, status: 400 }
      )
    )

    await expect(listJobs('', { page: 1, limit: 10 })).rejects.toThrow(ApiError)
  })
})
