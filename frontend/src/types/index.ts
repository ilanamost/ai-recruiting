export interface Job {
  id: string
  org_id: string
  title: string
  description: string
  // Free-text posting location. Null means "not set" — the field is optional.
  location: string | null
  created_at: string
}

export interface Resume {
  id: string
  candidate_id: string
  candidate_name: string
  candidate_email: string
  file_name: string
  mime_type: string
  content: string
  created_at: string
  jobs: { id: string; title: string }[]
  owner_user_id: string | null
  // Years of industry experience read off the CV by the backend's analysis step (.plan/029).
  // Null means "unclassified" — no dated work history, uploaded before analysis existed, or the
  // analysis call failed — and is NOT the same as zero. An unclassified CV belongs to no
  // experience level and appears only under the "All" tab; never coerce it to 0, which would
  // silently label a career-changer Junior.
  years_experience: number | null
  // Skills read off the CV by the same analysis step, already normalized server-side: trimmed,
  // lowercased, de-duplicated, capped (.orchestrate/api-contract.yaml). Always an array, never
  // null — no skills, no analysis yet, and a failed analysis all arrive as []. Matching is exact
  // on these normalized strings, so the UI capitalizes for display only and never re-normalizes.
  skills: string[]
}

// JobResume is the shape returned by GET /api/job/:id/resumes: a Resume plus the
// job-specific attachment timestamp (job_resume.created_at). It inherits `years_experience` and
// `skills` from Resume rather than restating them, mirroring the backend's
// `JobResume extends ResumeWithCandidate extends Resume` — there must not be two resume shapes
// that disagree about what a resume is.
export interface JobResume extends Resume {
  attached_at: string
}

// The experience bands a recruiter filters by (.plan/029 Open Question 4). Derived from
// `Resume.years_experience`, never persisted: the years are the fact, the band is a
// presentation rule over them, so re-tuning the boundaries must not need a data migration.
// The boundaries themselves live in `lib/experience.ts`, the single source of truth.
export type ExperienceLevel = 'junior' | 'mid' | 'senior'

// The pagination envelope both list endpoints return (.plan/028, Open Question 2), mirroring
// `.orchestrate/api-contract.yaml`'s `Page` schema. `page`/`limit` echo the *effective*,
// post-clamp values the server used, so a pager can render straight from the response without
// re-deriving what the server did with an out-of-range request.
export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

export interface Match {
  id: string
  resume_id: string
  job_id: string
  score: number
  explanation: string
  created_at: string
}
