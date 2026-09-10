import { randomUUID } from 'crypto'
import { ConflictError } from '../lib/errors'
import { normalizePageParams } from '../lib/pagination'
import type {
  AppUser,
  Candidate,
  CreateCandidateInput,
  CreateJobInput,
  CreateMatchInput,
  CreateRefreshTokenInput,
  CreateResumeInput,
  CreateUserInput,
  Job,
  JobResume,
  Match,
  Page,
  PageParams,
  RefreshToken,
  ReplaceResumeFileInput,
  Resume,
  ResumeFile,
  ResumeWithCandidate,
  Store,
  UpdateJobInput,
  UpdateResumeInput,
  UpdateUserInput
} from './types'

interface JobResumeRow {
  job_id: string
  resume_id: string
  created_at: string
}

function jobResumeKey(job_id: string, resume_id: string): string {
  return `${job_id}::${resume_id}`
}

/**
 * Process-local store used in tests so route and scoring logic can be
 * exercised without a live Postgres instance. `createPgStore` is the
 * production-backed equivalent — both implement the same `Store` interface.
 */
export function createMemoryStore(): Store {
  const jobs = new Map<string, Job>()
  const candidates = new Map<string, Candidate>()
  const resumes = new Map<string, Resume>()
  const resumeFiles = new Map<string, Buffer>()
  const jobResumes = new Map<string, JobResumeRow>()
  const matches = new Map<string, Match>()
  const users = new Map<string, AppUser>()
  const refreshTokens = new Map<string, RefreshToken>()

  function jobsForResume(resume_id: string): { id: string; title: string }[] {
    return [...jobResumes.values()]
      .filter((row) => row.resume_id === resume_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((row) => jobs.get(row.job_id))
      .filter((job): job is Job => job !== undefined)
      .map((job) => ({ id: job.id, title: job.title }))
  }

  function toResumeWithCandidate(resume: Resume): ResumeWithCandidate | null {
    const candidate = candidates.get(resume.candidate_id)
    if (!candidate) return null
    return {
      ...resume,
      // Copied, not shared: a caller mutating the returned array must not
      // reach back into the stored resume. pg-store hands out a fresh array
      // from array_agg on every read, so this keeps the two behaviorally
      // identical.
      skills: [...resume.skills],
      candidate_name: candidate.name,
      candidate_email: candidate.email,
      jobs: jobsForResume(resume.id)
    }
  }

  return {
    async createJob(input: CreateJobInput) {
      const job: Job = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        ...input,
        location: input.location ?? null
      }
      jobs.set(job.id, job)
      return job
    },

    async getJob(id: string) {
      return jobs.get(id) ?? null
    },

    async listJobs(org_id: string, params: PageParams): Promise<Page<Job>> {
      const { page, limit } = normalizePageParams(params)
      const filtered = [...jobs.values()]
        .filter((job) => job.org_id === org_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      const offset = (page - 1) * limit
      return { items: filtered.slice(offset, offset + limit), total: filtered.length }
    },

    async updateJob(id: string, input: UpdateJobInput) {
      const job = jobs.get(id)
      if (!job) return null

      const updated: Job = {
        ...job,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.location !== undefined ? { location: input.location } : {})
      }
      jobs.set(id, updated)
      return updated
    },

    async deleteJob(id: string) {
      if (!jobs.has(id)) return false

      for (const [key, row] of jobResumes) {
        if (row.job_id === id) {
          jobResumes.delete(key)
        }
      }
      for (const [matchId, match] of matches) {
        if (match.job_id === id) {
          matches.delete(matchId)
        }
      }
      jobs.delete(id)
      return true
    },

    async duplicateJob(id: string) {
      const job = jobs.get(id)
      if (!job) return null

      const duplicate: Job = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        org_id: job.org_id,
        title: job.title,
        description: job.description,
        location: job.location
      }
      jobs.set(duplicate.id, duplicate)

      for (const row of [...jobResumes.values()]) {
        if (row.job_id === id) {
          const key = jobResumeKey(duplicate.id, row.resume_id)
          jobResumes.set(key, { job_id: duplicate.id, resume_id: row.resume_id, created_at: new Date().toISOString() })
        }
      }

      return duplicate
    },

    async createCandidate(input: CreateCandidateInput) {
      const candidate: Candidate = { id: randomUUID(), created_at: new Date().toISOString(), ...input }
      candidates.set(candidate.id, candidate)
      return candidate
    },

    async createResume(input: CreateResumeInput) {
      const { job_id, file_data, owner_user_id, years_experience, skills, ...rest } = input
      const resume: Resume = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        owner_user_id: owner_user_id ?? null,
        // Null is "unclassified", never zero; skills are always an array.
        years_experience: years_experience ?? null,
        skills: skills ? [...skills] : [],
        ...rest
      }
      resumes.set(resume.id, resume)
      resumeFiles.set(resume.id, file_data)

      if (job_id) {
        const key = jobResumeKey(job_id, resume.id)
        jobResumes.set(key, { job_id, resume_id: resume.id, created_at: new Date().toISOString() })
      }

      return resume
    },

    async getResume(id: string) {
      const resume = resumes.get(id)
      if (!resume) return null
      return toResumeWithCandidate(resume)
    },

    // The owner filter runs before the slice below, so `total` is the filtered
    // count and per-owner pagination math stays correct (.plan/032).
    async listResumes(params: PageParams & { owner_user_id?: string }): Promise<Page<ResumeWithCandidate>> {
      const { page, limit } = normalizePageParams(params)
      const filtered = [...resumes.values()]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((resume) => toResumeWithCandidate(resume))
        .filter((resume): resume is ResumeWithCandidate => resume !== null)
        .filter((resume) => params.owner_user_id === undefined || resume.owner_user_id === params.owner_user_id)
      const offset = (page - 1) * limit
      return { items: filtered.slice(offset, offset + limit), total: filtered.length }
    },

    async updateResume(id: string, input: UpdateResumeInput) {
      const resume = resumes.get(id)
      if (!resume) return null

      const candidate = candidates.get(resume.candidate_id)
      if (!candidate) return null

      const updatedCandidate: Candidate = {
        ...candidate,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {})
      }
      candidates.set(candidate.id, updatedCandidate)

      return toResumeWithCandidate(resume)
    },

    async deleteResume(id: string) {
      if (!resumes.has(id)) return false

      for (const [key, row] of jobResumes) {
        if (row.resume_id === id) {
          jobResumes.delete(key)
        }
      }
      for (const [matchId, match] of matches) {
        if (match.resume_id === id) {
          matches.delete(matchId)
        }
      }
      resumes.delete(id)
      resumeFiles.delete(id)
      return true
    },

    async getResumeFile(id: string): Promise<ResumeFile | null> {
      const resume = resumes.get(id)
      const fileData = resumeFiles.get(id)
      if (!resume || !fileData) return null
      return { file_name: resume.file_name, mime_type: resume.mime_type, file_data: fileData }
    },

    async replaceResumeFile(id: string, input: ReplaceResumeFileInput) {
      const resume = resumes.get(id)
      if (!resume) return null

      const updated: Resume = {
        ...resume,
        file_name: input.file_name,
        mime_type: input.mime_type,
        content: input.content,
        // Replaced wholesale, not merged — the previous file's analysis
        // describes a CV that no longer exists here. Mirrors pg-store's
        // delete-then-insert of the resume_skill rows.
        years_experience: input.years_experience ?? null,
        skills: input.skills ? [...input.skills] : []
      }
      resumes.set(id, updated)
      resumeFiles.set(id, input.file_data)

      return toResumeWithCandidate(updated)
    },

    async attachResumeToJob(job_id: string, resume_id: string) {
      const key = jobResumeKey(job_id, resume_id)
      if (!jobResumes.has(key)) {
        jobResumes.set(key, { job_id, resume_id, created_at: new Date().toISOString() })
      }
    },

    async detachResumeFromJob(job_id: string, resume_id: string) {
      const key = jobResumeKey(job_id, resume_id)
      if (!jobResumes.has(key)) return false

      jobResumes.delete(key)
      for (const [matchId, match] of matches) {
        if (match.job_id === job_id && match.resume_id === resume_id) {
          matches.delete(matchId)
        }
      }
      return true
    },

    async isResumeAttachedToJob(job_id: string, resume_id: string) {
      return jobResumes.has(jobResumeKey(job_id, resume_id))
    },

    async listResumesForJob(job_id: string): Promise<JobResume[]> {
      return [...jobResumes.values()]
        .filter((row) => row.job_id === job_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((row) => {
          const resume = resumes.get(row.resume_id)
          if (!resume) return null
          const withCandidate = toResumeWithCandidate(resume)
          if (!withCandidate) return null
          return { ...withCandidate, attached_at: row.created_at }
        })
        .filter((row): row is JobResume => row !== null)
    },

    async createMatch(input: CreateMatchInput) {
      const match: Match = { id: randomUUID(), created_at: new Date().toISOString(), ...input }
      matches.set(match.id, match)
      return match
    },

    async getMatch(id: string) {
      return matches.get(id) ?? null
    },

    async getLatestMatchForPair(job_id: string, resume_id: string) {
      const forPair = [...matches.values()]
        .filter((match) => match.job_id === job_id && match.resume_id === resume_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      return forPair[0] ?? null
    },

    async listLatestMatchesForJob(job_id: string): Promise<Match[]> {
      const latestByResume = new Map<string, Match>()
      for (const match of [...matches.values()]
        .filter((row) => row.job_id === job_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))) {
        if (!latestByResume.has(match.resume_id)) {
          latestByResume.set(match.resume_id, match)
        }
      }
      return [...latestByResume.values()]
    },

    async createUser(input: CreateUserInput) {
      const existing = [...users.values()].find((user) => user.email === input.email)
      if (existing) {
        throw new ConflictError('Email is already registered')
      }

      const now = new Date().toISOString()
      const user: AppUser = {
        id: randomUUID(),
        profile_image: null,
        profile_image_mime: null,
        created_at: now,
        updated_at: now,
        ...input
      }
      users.set(user.id, user)
      return user
    },

    async getUserByEmail(email: string) {
      return [...users.values()].find((user) => user.email === email) ?? null
    },

    async getUserById(id: string) {
      return users.get(id) ?? null
    },

    async updateUser(id: string, input: UpdateUserInput) {
      const user = users.get(id)
      if (!user) return null

      if (input.email !== undefined && input.email !== user.email) {
        const existing = [...users.values()].find((u) => u.email === input.email && u.id !== id)
        if (existing) {
          throw new ConflictError('Email is already registered to another account')
        }
      }

      const updated: AppUser = {
        ...user,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.password_hash !== undefined ? { password_hash: input.password_hash } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.profile_image !== undefined ? { profile_image: input.profile_image } : {}),
        ...(input.profile_image_mime !== undefined ? { profile_image_mime: input.profile_image_mime } : {}),
        updated_at: new Date().toISOString()
      }
      users.set(id, updated)
      return updated
    },

    async createRefreshToken(input: CreateRefreshTokenInput) {
      const token: RefreshToken = { id: randomUUID(), revoked_at: null, created_at: new Date().toISOString(), ...input }
      refreshTokens.set(token.id, token)
      return token
    },

    async getRefreshTokenByHash(token_hash: string) {
      return [...refreshTokens.values()].find((token) => token.token_hash === token_hash) ?? null
    },

    async revokeRefreshToken(id: string) {
      const token = refreshTokens.get(id)
      if (!token || token.revoked_at) return
      refreshTokens.set(id, { ...token, revoked_at: new Date().toISOString() })
    },

    async revokeAllRefreshTokensForUser(user_id: string, exceptId?: string) {
      const now = new Date().toISOString()
      for (const [id, token] of refreshTokens) {
        if (token.user_id === user_id && !token.revoked_at && id !== exceptId) {
          refreshTokens.set(id, { ...token, revoked_at: now })
        }
      }
    }
  }
}
