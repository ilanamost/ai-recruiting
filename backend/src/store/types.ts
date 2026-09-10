export interface Job {
  id: string
  org_id: string
  title: string
  description: string
  /** Free-text posting location. Null means "not set" — the field is optional. */
  location: string | null
  created_at: string
}

export interface Candidate {
  id: string
  name: string
  email: string
  created_at: string
}

export interface Resume {
  id: string
  candidate_id: string
  file_name: string
  mime_type: string
  content: string
  created_at: string
  /** Owning app_user (Candidate role) for ownership-scoped edit/replace/delete/attach/detach. Null for an Admin upload, or a resume uploaded before this column existed. */
  owner_user_id: string | null
  /**
   * Years of industry experience produced by the analysis step at upload time
   * (.plan/029-2026-09-07-cv-recruiter-filter.md). **Null means
   * "unclassified", not zero** — a CV with no dated work history, one uploaded
   * before analysis existed, or one whose analysis call failed all yield null.
   * The Junior/Mid/Senior band is derived from this on the frontend; it is
   * deliberately not stored, so re-tuning the boundaries needs no migration.
   */
  years_experience: number | null
  /**
   * Skills produced by the analysis step, already normalized (trimmed,
   * lowercased, de-duplicated, each at most 50 characters, at most 30 per CV).
   * **Always an array, never null and never absent** — no skills, no analysis
   * yet, and a failed analysis all yield `[]`, per .orchestrate/api-contract.yaml.
   */
  skills: string[]
}

/**
 * Resume shape joined with its candidate's name/email and the jobs it's
 * currently attached to (via job_resume), per the contract's Resume schema.
 */
export interface ResumeWithCandidate extends Resume {
  candidate_name: string
  candidate_email: string
  jobs: { id: string; title: string }[]
}

/** A ResumeWithCandidate plus the job_resume.created_at for one specific (job_id, resume_id) pair. */
export interface JobResume extends ResumeWithCandidate {
  attached_at: string
}

/**
 * A resume's raw uploaded file bytes, for download/preview. `file_data` can be
 * `null` for a resume row whose bytes were never captured (e.g. uploaded
 * before `.plan/005-*` added the column on a dev DB where it wasn't
 * backfilled) — callers must treat that as "file not available", not crash.
 */
export interface ResumeFile {
  file_name: string
  mime_type: string
  file_data: Buffer | null
}

export interface Match {
  id: string
  resume_id: string
  job_id: string
  score: number
  explanation: string
  created_at: string
}

export interface CreateJobInput {
  org_id: string
  title: string
  description: string
  /** Optional. Omitted or null stores null — callers normalize an empty string to null. */
  location?: string | null
}

export interface UpdateJobInput {
  title?: string
  description?: string
  /** Undefined leaves the existing value alone; null clears it. */
  location?: string | null
}

export interface CreateCandidateInput {
  name: string
  email: string
}

export interface CreateResumeInput {
  candidate_id: string
  /** Optional. When present, the new resume is auto-attached to this job (via job_resume). */
  job_id?: string
  file_name: string
  mime_type: string
  content: string
  file_data: Buffer
  /** Owning app_user (Candidate role) for a Candidate upload. Left unset/null for an Admin upload. */
  owner_user_id?: string | null
  /** Analysis output. Omitted or null stores null — "unclassified", never zero. */
  years_experience?: number | null
  /** Analysis output, already normalized. Omitted stores no skills, read back as `[]`. */
  skills?: string[]
}

export interface UpdateResumeInput {
  name?: string
  email?: string
}

/**
 * A replaced file is a different CV, so its analysis is replaced wholesale
 * rather than merged: the previous years/skills are always dropped. Omitting
 * either field therefore means "unclassified"/"no skills", NOT "leave the old
 * value alone" — stale skills from the previous file must never survive a
 * replace.
 */
export interface ReplaceResumeFileInput {
  file_name: string
  mime_type: string
  content: string
  file_data: Buffer
  years_experience?: number | null
  skills?: string[]
}

export interface CreateMatchInput {
  resume_id: string
  job_id: string
  score: number
  explanation: string
}

export type Role = 'admin' | 'recruiter' | 'candidate'

/**
 * Login identity (app_user), separate from `candidate` (the anonymous
 * resume-owner metadata captured at upload time) — see
 * .plan/008-2026-08-03-authentication-authorization.md Open Question 4.
 * `profile_image`/`profile_image_mime` carry the raw uploaded bytes: unlike
 * `resume`'s `file_data` (only ever fetched via a dedicated getResumeFile
 * call), users are always fetched one at a time here, so there's no
 * list-endpoint payload-bloat concern in returning them on every read.
 */
export interface AppUser {
  id: string
  org_id: string
  name: string
  email: string
  password_hash: string
  role: Role
  profile_image: Buffer | null
  profile_image_mime: string | null
  created_at: string
  updated_at: string
}

export interface CreateUserInput {
  org_id: string
  name: string
  email: string
  password_hash: string
  role: Role
}

export interface UpdateUserInput {
  name?: string
  email?: string
  password_hash?: string
  /** Self-service role change — callers must reject 'admin' before it reaches the store. */
  role?: Role
  profile_image?: Buffer | null
  profile_image_mime?: string | null
}

export interface RefreshToken {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface CreateRefreshTokenInput {
  user_id: string
  token_hash: string
  expires_at: string
}

/**
 * One page of a list query plus the total number of rows matching that
 * query's filters, ignoring `page`/`limit` — the store half of the API's
 * `{ items, total, page, limit }` envelope
 * (.plan/028-2026-09-06-pagination-cvs-jobs.md). The route adds the
 * effective `page`/`limit` back onto the response.
 */
export interface Page<T> {
  items: T[]
  total: number
}

/** Effective, already-clamped pagination inputs. Both are 1-based/positive — routes clamp before calling the store. */
export interface PageParams {
  page: number
  limit: number
}

export interface Store {
  createJob(input: CreateJobInput): Promise<Job>
  getJob(id: string): Promise<Job | null>
  /** One page of the org's jobs, newest first. `total` counts the whole org, not the page. */
  listJobs(org_id: string, params: PageParams): Promise<Page<Job>>
  updateJob(id: string, input: UpdateJobInput): Promise<Job | null>
  /** Cascades: deletes the job's job_resume attachments and any matches for this job. Resumes are not deleted. */
  deleteJob(id: string): Promise<boolean>
  /** Creates a new job (same org_id/title/description/location) and copies the source job's job_resume rows (not its matches). */
  duplicateJob(id: string): Promise<Job | null>
  createCandidate(input: CreateCandidateInput): Promise<Candidate>
  createResume(input: CreateResumeInput): Promise<Resume>
  getResume(id: string): Promise<ResumeWithCandidate | null>
  /**
   * One page of resumes, newest first. No org filtering.
   *
   * `owner_user_id` is the optional ownership filter
   * (.plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md): when
   * present, both `items` and `total` narrow to resumes whose
   * `owner_user_id` equals it — the filter is applied before pagination, so
   * `total` is the filtered count, not the global one. A resume with a null
   * `owner_user_id` never matches. When omitted, nothing is filtered and
   * `total` counts every resume.
   */
  listResumes(params: PageParams & { owner_user_id?: string }): Promise<Page<ResumeWithCandidate>>
  updateResume(id: string, input: UpdateResumeInput): Promise<ResumeWithCandidate | null>
  /** Cascades: deletes the resume's job_resume attachments and any matches referencing it. */
  deleteResume(id: string): Promise<boolean>
  getResumeFile(id: string): Promise<ResumeFile | null>
  replaceResumeFile(id: string, input: ReplaceResumeFileInput): Promise<ResumeWithCandidate | null>
  /** Idempotent insert into job_resume. */
  attachResumeToJob(job_id: string, resume_id: string): Promise<void>
  /** Deletes the job_resume row and any match rows for this exact (resume_id, job_id) pair. Returns whether it was attached. */
  detachResumeFromJob(job_id: string, resume_id: string): Promise<boolean>
  isResumeAttachedToJob(job_id: string, resume_id: string): Promise<boolean>
  listResumesForJob(job_id: string): Promise<JobResume[]>
  createMatch(input: CreateMatchInput): Promise<Match>
  getMatch(id: string): Promise<Match | null>
  /** Most recent match row for this exact (job_id, resume_id) pair, or null if none exists yet. */
  getLatestMatchForPair(job_id: string, resume_id: string): Promise<Match | null>
  /**
   * One row per resume ever scored against this job — its most recent match
   * with that job, same "most recent wins" convention as getLatestMatchForPair.
   * A resume attached to the job but never scored for it is simply absent from
   * the result, not a null entry.
   */
  listLatestMatchesForJob(job_id: string): Promise<Match[]>
  /** Throws ConflictError (see lib/errors.ts) if the email is already registered. */
  createUser(input: CreateUserInput): Promise<AppUser>
  getUserByEmail(email: string): Promise<AppUser | null>
  getUserById(id: string): Promise<AppUser | null>
  /** Throws ConflictError if the input changes email to one already registered to another user. */
  updateUser(id: string, input: UpdateUserInput): Promise<AppUser | null>
  createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshToken>
  getRefreshTokenByHash(token_hash: string): Promise<RefreshToken | null>
  revokeRefreshToken(id: string): Promise<void>
  /** Revokes every non-revoked refresh token for this user, optionally excluding one row id (e.g. the session just re-issued). */
  revokeAllRefreshTokensForUser(user_id: string, exceptId?: string): Promise<void>
}
