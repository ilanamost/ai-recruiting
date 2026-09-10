import type { Job, JobResume, Match, Page, Resume } from '../types'
import { apiFetch, parseErrorResponse } from './http'

export { ApiError } from './http'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Paging params for the two list endpoints (.plan/028). Both are optional on the wire — the
// server clamps a missing/invalid value to its default (page 1, limit 10, limit capped at
// UNPAGED_LIMIT) rather than erroring, per `.orchestrate/api-contract.yaml`.
export interface PageParams {
  page?: number
  limit?: number
}

// The server's `limit` cap (api-contract.yaml), and so the largest page anything can ask for —
// requesting more is silently clamped to this. Callers that need a whole list rather than one
// page pass exactly this: JobsListPage while a client-side filter is active, and JobCvsModal's
// attach dropdown. It lives here, beside PageParams, so the number has exactly one home — this
// task already drifted once when the same cap was spelled 1000 in one place and 100 in another.
export const UNPAGED_LIMIT = 500

function pageQuery(params?: PageParams): string {
  const query = new URLSearchParams()
  if (params?.page !== undefined) {
    query.set('page', String(params.page))
  }
  if (params?.limit !== undefined) {
    query.set('limit', String(params.limit))
  }
  return query.toString()
}

export interface CreateJobInput {
  org_id: string
  title: string
  description: string
  // Optional. An empty string is normalized to null server-side.
  location?: string | null
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const response = await apiFetch(`${API_URL}/api/job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function getJob(id: string): Promise<Job> {
  const response = await apiFetch(`${API_URL}/api/job/${id}`)
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function listJobs(orgId: string, params?: PageParams): Promise<Page<Job>> {
  const paging = pageQuery(params)
  const url = `${API_URL}/api/job?org_id=${encodeURIComponent(orgId)}${paging ? `&${paging}` : ''}`
  const response = await apiFetch(url)
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export interface UpdateJobInput {
  title?: string
  description?: string
  // Optional. An empty string is normalized to null server-side.
  location?: string | null
}

export async function updateJob(id: string, input: UpdateJobInput): Promise<Job> {
  const response = await apiFetch(`${API_URL}/api/job/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function deleteJob(id: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/api/job/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
}

export async function duplicateJob(id: string): Promise<Job> {
  const response = await apiFetch(`${API_URL}/api/job/${id}/duplicate`, { method: 'POST' })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function listJobResumes(jobId: string): Promise<JobResume[]> {
  const response = await apiFetch(`${API_URL}/api/job/${jobId}/resumes`)
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function attachResumeToJob(jobId: string, resumeId: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/api/job/${jobId}/resumes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume_id: resumeId })
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
}

export async function detachResumeFromJob(jobId: string, resumeId: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/api/job/${jobId}/resumes/${resumeId}`, { method: 'DELETE' })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
}

export interface UploadResumeInput {
  name: string
  email: string
  file: File
  job_id?: string
}

export async function uploadResume(input: UploadResumeInput): Promise<Resume> {
  const formData = new FormData()
  formData.append('name', input.name)
  formData.append('email', input.email)
  formData.append('file', input.file)
  if (input.job_id) {
    formData.append('job_id', input.job_id)
  }

  const response = await apiFetch(`${API_URL}/api/resume`, { method: 'POST', body: formData })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function listResumes(params?: PageParams): Promise<Page<Resume>> {
  const paging = pageQuery(params)
  const response = await apiFetch(`${API_URL}/api/resume${paging ? `?${paging}` : ''}`)
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export function getResumeFileUrl(id: string, options?: { download?: boolean }): string {
  const query = options?.download ? '?download=1' : ''
  return `${API_URL}/api/resume/${id}/file${query}`
}

export async function replaceResumeFile(id: string, file: File): Promise<Resume> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await apiFetch(`${API_URL}/api/resume/${id}/file`, { method: 'PUT', body: formData })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export interface UpdateResumeInput {
  name?: string
  email?: string
}

export async function updateResume(id: string, input: UpdateResumeInput): Promise<Resume> {
  const response = await apiFetch(`${API_URL}/api/resume/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function deleteResume(id: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/api/resume/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
}

export interface CreateMatchInput {
  resume_id: string
  job_id: string
}

export async function createMatch(input: CreateMatchInput): Promise<Match> {
  const response = await apiFetch(`${API_URL}/api/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function getMatch(id: string): Promise<Match> {
  const response = await apiFetch(`${API_URL}/api/match/${id}`)
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

export async function getMatchForPair(jobId: string, resumeId: string): Promise<Match | null> {
  const response = await apiFetch(`${API_URL}/api/job/${jobId}/resumes/${resumeId}/match`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}

// One entry per resume ever scored for this job — each being that resume's latest match, so a
// re-score never leaves a superseded duplicate behind. Admin/Recruiter only server-side.
export async function listLatestMatchesForJob(jobId: string): Promise<Match[]> {
  const response = await apiFetch(`${API_URL}/api/job/${jobId}/matches`)
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  return response.json()
}
