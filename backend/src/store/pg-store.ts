import { Pool, type PoolClient } from 'pg'
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

/** Postgres unique_violation error code. */
const PG_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION
}

/**
 * Writes one resume's skill rows in a single statement via unnest, rather than
 * a query per skill — a CV carries up to 30 of them (the analysis cap). Values
 * arrive already normalized and de-duplicated from src/analysis, so the
 * `on conflict do nothing` is belt-and-braces against a caller that skipped
 * that, not the primary de-duplication. Takes the caller's transaction client
 * so it commits with the resume row it belongs to.
 */
async function insertResumeSkills(
  client: Pick<PoolClient, 'query'>,
  resume_id: string,
  skills: string[] | undefined
): Promise<void> {
  if (!skills || skills.length === 0) return

  await client.query(
    `insert into resume_skill (resume_id, skill)
     select $1, unnest($2::text[])
     on conflict (resume_id, skill) do nothing`,
    [resume_id, skills]
  )
}

// Aggregates a resume's skills into a single text[] column
// (.plan/029-2026-09-07-cv-recruiter-filter.md). Deliberately an aggregated
// scalar subquery rather than a join: every resume read path uses it,
// including the unpaged limit=500 request the attach dropdown makes, so a join
// would multiply rows and a per-row lookup would be N+1. coalesce to an empty
// array keeps the contract's "skills is never null" promise for a resume with
// no skill rows.
const SKILLS_SUBQUERY = `
    coalesce(
      (
        select array_agg(resume_skill.skill order by resume_skill.skill)
        from resume_skill
        where resume_skill.resume_id = resume.id
      ),
      '{}'::text[]
    ) as skills`

// Joins resume to its candidate and aggregates the jobs it's currently
// attached to (via job_resume), so every read matches the contract's Resume
// schema, which requires candidate_name/candidate_email/jobs on each item.
// Deliberately never selects resume.file_data — that's only ever fetched via
// getResumeFile, to avoid shipping raw file bytes in every list/get response.
const RESUME_WITH_CANDIDATE_SELECT = `
  select
    resume.id,
    resume.candidate_id,
    resume.file_name,
    resume.mime_type,
    resume.content,
    resume.created_at,
    resume.owner_user_id,
    resume.years_experience,
${SKILLS_SUBQUERY},
    candidate.name as candidate_name,
    candidate.email as candidate_email,
    coalesce(
      (
        select json_agg(json_build_object('id', job.id, 'title', job.title) order by job_resume.created_at)
        from job_resume
        join job on job.id = job_resume.job_id
        where job_resume.resume_id = resume.id
      ),
      '[]'::json
    ) as jobs
  from resume
  join candidate on candidate.id = resume.candidate_id
`

// Same shape as above, plus the job_resume.created_at for one specific
// (job_id, resume_id) pair, for GET /api/job/:id/resumes.
const JOB_RESUME_SELECT = `
  select
    resume.id,
    resume.candidate_id,
    resume.file_name,
    resume.mime_type,
    resume.content,
    resume.created_at,
    resume.owner_user_id,
    resume.years_experience,
${SKILLS_SUBQUERY},
    candidate.name as candidate_name,
    candidate.email as candidate_email,
    coalesce(
      (
        select json_agg(json_build_object('id', job2.id, 'title', job2.title) order by job_resume2.created_at)
        from job_resume job_resume2
        join job job2 on job2.id = job_resume2.job_id
        where job_resume2.resume_id = resume.id
      ),
      '[]'::json
    ) as jobs,
    job_resume.created_at as attached_at
  from job_resume
  join resume on resume.id = job_resume.resume_id
  join candidate on candidate.id = resume.candidate_id
`

/**
 * Postgres-backed store per .rule/database-rules.md. `connectionString` is
 * read from `DATABASE_URL` by the caller; passed explicitly here so this
 * module has no direct env dependency.
 */
export function createPgStore(connectionString: string | undefined): Store {
  const pool = new Pool({ connectionString })

  return {
    async createJob({ org_id, title, description, location }: CreateJobInput) {
      const result = await pool.query<Job>(
        'insert into job (org_id, title, description, location) values ($1, $2, $3, $4) returning *',
        [org_id, title, description, location ?? null]
      )
      return result.rows[0]
    },

    async getJob(id: string) {
      const result = await pool.query<Job>('select * from job where id = $1', [id])
      return result.rows[0] ?? null
    },

    // Two queries by design (.plan/028 Assumptions): the page itself, plus a
    // plain count(*) over the same `where org_id = $1` filter, chosen over a
    // count(*) over() window for readability at demo scale.
    async listJobs(org_id: string, params: PageParams): Promise<Page<Job>> {
      const { page, limit } = normalizePageParams(params)
      const result = await pool.query<Job>(
        'select * from job where org_id = $1 order by created_at desc limit $2 offset $3',
        [org_id, limit, (page - 1) * limit]
      )
      const countResult = await pool.query<{ count: string }>(
        'select count(*) from job where org_id = $1',
        [org_id]
      )
      return { items: result.rows, total: Number(countResult.rows[0].count) }
    },

    async updateJob(id: string, input: UpdateJobInput) {
      const fields: string[] = []
      const values: unknown[] = []
      let i = 1

      if (input.title !== undefined) {
        fields.push(`title = $${i++}`)
        values.push(input.title)
      }
      if (input.description !== undefined) {
        fields.push(`description = $${i++}`)
        values.push(input.description)
      }
      if (input.location !== undefined) {
        fields.push(`location = $${i++}`)
        values.push(input.location)
      }

      if (fields.length === 0) {
        const result = await pool.query<Job>('select * from job where id = $1', [id])
        return result.rows[0] ?? null
      }

      values.push(id)
      const result = await pool.query<Job>(
        `update job set ${fields.join(', ')} where id = $${i} returning *`,
        values
      )
      return result.rows[0] ?? null
    },

    // Relies on schema.sql's on-delete-cascade FKs (job_resume.job_id,
    // match.job_id) to clean up attachments and matches for this job.
    // resume has no FK to job, so resumes are correctly left untouched.
    async deleteJob(id: string) {
      const result = await pool.query('delete from job where id = $1', [id])
      return (result.rowCount ?? 0) > 0
    },

    async duplicateJob(id: string) {
      const jobResult = await pool.query<Job>('select * from job where id = $1', [id])
      const job = jobResult.rows[0]
      if (!job) return null

      const duplicateResult = await pool.query<Job>(
        'insert into job (org_id, title, description, location) values ($1, $2, $3, $4) returning *',
        [job.org_id, job.title, job.description, job.location]
      )
      const duplicate = duplicateResult.rows[0]

      await pool.query(
        `insert into job_resume (job_id, resume_id)
         select $1, resume_id from job_resume where job_id = $2`,
        [duplicate.id, id]
      )

      return duplicate
    },

    async createCandidate({ name, email }: CreateCandidateInput) {
      const result = await pool.query<Candidate>(
        'insert into candidate (name, email) values ($1, $2) returning *',
        [name, email]
      )
      return result.rows[0]
    },

    // Transactional: the resume row, its skill rows, and its auto-attachment
    // land together or not at all. A resume that committed without its skills
    // would read back as "analyzed, no skills" and be silently invisible to
    // every skill filter, with nothing to distinguish it from a genuine
    // no-skills CV.
    async createResume({
      candidate_id,
      job_id,
      file_name,
      mime_type,
      content,
      file_data,
      owner_user_id,
      years_experience,
      skills
    }: CreateResumeInput) {
      const client = await pool.connect()
      try {
        await client.query('begin')

        const result = await client.query<Resume>(
          `insert into resume (candidate_id, file_name, mime_type, content, file_data, owner_user_id, years_experience)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id, candidate_id, file_name, mime_type, content, created_at, owner_user_id, years_experience`,
          [candidate_id, file_name, mime_type, content, file_data, owner_user_id ?? null, years_experience ?? null]
        )
        const resume = result.rows[0]

        await insertResumeSkills(client, resume.id, skills)

        if (job_id) {
          await client.query(
            'insert into job_resume (job_id, resume_id) values ($1, $2) on conflict (job_id, resume_id) do nothing',
            [job_id, resume.id]
          )
        }

        await client.query('commit')
        return { ...resume, skills: skills ? [...skills] : [] }
      } catch (err) {
        await client.query('rollback')
        throw err
      } finally {
        client.release()
      }
    },

    async getResume(id: string) {
      const result = await pool.query<ResumeWithCandidate>(`${RESUME_WITH_CANDIDATE_SELECT} where resume.id = $1`, [
        id
      ])
      return result.rows[0] ?? null
    },

    // Still unfiltered by org (.plan/028 Assumptions), but ownership-scoped on
    // demand (.plan/032): with `owner_user_id` present the same parameterized
    // where clause goes on BOTH queries, so `total` is the filtered count and
    // per-owner pagination math stays correct. `= $n` never matches a null
    // owner_user_id, which is exactly the intended "not the candidate's" rule.
    // The count repeats the select's inner join on candidate so it counts the
    // same row set: a resume whose candidate row is missing is absent from
    // `items` and must not inflate `total`.
    async listResumes(params: PageParams & { owner_user_id?: string }): Promise<Page<ResumeWithCandidate>> {
      const { page, limit } = normalizePageParams(params)
      // $1/$2 stay limit/offset so the owner filter is appended as $3, leaving
      // the existing pagination params in place.
      const listWhere = params.owner_user_id === undefined ? '' : ' where resume.owner_user_id = $3'
      const listValues: unknown[] = [limit, (page - 1) * limit]
      if (params.owner_user_id !== undefined) listValues.push(params.owner_user_id)

      const result = await pool.query<ResumeWithCandidate>(
        `${RESUME_WITH_CANDIDATE_SELECT}${listWhere} order by resume.created_at desc limit $1 offset $2`,
        listValues
      )
      const countWhere = params.owner_user_id === undefined ? '' : ' where resume.owner_user_id = $1'
      const countResult = await pool.query<{ count: string }>(
        `select count(*) from resume join candidate on candidate.id = resume.candidate_id${countWhere}`,
        params.owner_user_id === undefined ? [] : [params.owner_user_id]
      )
      return { items: result.rows, total: Number(countResult.rows[0].count) }
    },

    async updateResume(id: string, input: UpdateResumeInput) {
      const fields: string[] = []
      const values: unknown[] = []
      let i = 1

      if (input.name !== undefined) {
        fields.push(`name = $${i++}`)
        values.push(input.name)
      }
      if (input.email !== undefined) {
        fields.push(`email = $${i++}`)
        values.push(input.email)
      }

      if (fields.length > 0) {
        values.push(id)
        await pool.query(
          `update candidate set ${fields.join(', ')}
           where id = (select candidate_id from resume where id = $${i})`,
          values
        )
      }

      const result = await pool.query<ResumeWithCandidate>(`${RESUME_WITH_CANDIDATE_SELECT} where resume.id = $1`, [
        id
      ])
      return result.rows[0] ?? null
    },

    // Relies on schema.sql's on-delete-cascade FKs (job_resume.resume_id,
    // match.resume_id) to clean up attachments and matches for this resume.
    async deleteResume(id: string) {
      const result = await pool.query('delete from resume where id = $1', [id])
      return (result.rowCount ?? 0) > 0
    },

    async getResumeFile(id: string): Promise<ResumeFile | null> {
      const result = await pool.query<ResumeFile>(
        'select file_name, mime_type, file_data from resume where id = $1',
        [id]
      )
      return result.rows[0] ?? null
    },

    // Transactional for the same reason createResume is, plus one of its own:
    // the old skill rows are deleted before the new ones are inserted, so a
    // failure between the two would leave the CV with no skills at all.
    async replaceResumeFile(id: string, input: ReplaceResumeFileInput) {
      const client = await pool.connect()
      try {
        await client.query('begin')

        const result = await client.query(
          `update resume
           set file_name = $1, mime_type = $2, content = $3, file_data = $4, years_experience = $5
           where id = $6`,
          [
            input.file_name,
            input.mime_type,
            input.content,
            input.file_data,
            input.years_experience ?? null,
            id
          ]
        )
        if ((result.rowCount ?? 0) === 0) {
          await client.query('rollback')
          return null
        }

        // Replaced wholesale, never merged — the previous file's skills
        // describe a CV this row no longer holds.
        await client.query('delete from resume_skill where resume_id = $1', [id])
        await insertResumeSkills(client, id, input.skills)

        const resumeResult = await client.query<ResumeWithCandidate>(
          `${RESUME_WITH_CANDIDATE_SELECT} where resume.id = $1`,
          [id]
        )

        await client.query('commit')
        return resumeResult.rows[0] ?? null
      } catch (err) {
        await client.query('rollback')
        throw err
      } finally {
        client.release()
      }
    },

    async attachResumeToJob(job_id: string, resume_id: string) {
      await pool.query(
        'insert into job_resume (job_id, resume_id) values ($1, $2) on conflict (job_id, resume_id) do nothing',
        [job_id, resume_id]
      )
    },

    async detachResumeFromJob(job_id: string, resume_id: string) {
      const result = await pool.query('delete from job_resume where job_id = $1 and resume_id = $2', [
        job_id,
        resume_id
      ])
      const detached = (result.rowCount ?? 0) > 0
      if (detached) {
        await pool.query('delete from match where job_id = $1 and resume_id = $2', [job_id, resume_id])
      }
      return detached
    },

    async isResumeAttachedToJob(job_id: string, resume_id: string) {
      const result = await pool.query('select 1 from job_resume where job_id = $1 and resume_id = $2', [
        job_id,
        resume_id
      ])
      return (result.rowCount ?? 0) > 0
    },

    async listResumesForJob(job_id: string): Promise<JobResume[]> {
      const result = await pool.query<JobResume>(
        `${JOB_RESUME_SELECT} where job_resume.job_id = $1 order by job_resume.created_at desc`,
        [job_id]
      )
      return result.rows
    },

    async createMatch({ resume_id, job_id, score, explanation }: CreateMatchInput) {
      const result = await pool.query<Match>(
        `insert into match (resume_id, job_id, score, explanation)
         values ($1, $2, $3, $4) returning *`,
        [resume_id, job_id, score, explanation]
      )
      return result.rows[0]
    },

    async getMatch(id: string) {
      const result = await pool.query<Match>('select * from match where id = $1', [id])
      return result.rows[0] ?? null
    },

    async getLatestMatchForPair(job_id: string, resume_id: string) {
      const result = await pool.query<Match>(
        'select * from match where job_id = $1 and resume_id = $2 order by created_at desc limit 1',
        [job_id, resume_id]
      )
      return result.rows[0] ?? null
    },

    async listLatestMatchesForJob(job_id: string): Promise<Match[]> {
      const result = await pool.query<Match>(
        'select distinct on (resume_id) * from match where job_id = $1 order by resume_id, created_at desc',
        [job_id]
      )
      return result.rows
    },

    async createUser({ org_id, name, email, password_hash, role }: CreateUserInput) {
      try {
        const result = await pool.query<AppUser>(
          `insert into app_user (org_id, name, email, password_hash, role)
           values ($1, $2, $3, $4, $5)
           returning *`,
          [org_id, name, email, password_hash, role]
        )
        return result.rows[0]
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError('Email is already registered')
        }
        throw err
      }
    },

    async getUserByEmail(email: string) {
      const result = await pool.query<AppUser>('select * from app_user where email = $1', [email])
      return result.rows[0] ?? null
    },

    async getUserById(id: string) {
      const result = await pool.query<AppUser>('select * from app_user where id = $1', [id])
      return result.rows[0] ?? null
    },

    async updateUser(id: string, input: UpdateUserInput) {
      const fields: string[] = []
      const values: unknown[] = []
      let i = 1

      if (input.name !== undefined) {
        fields.push(`name = $${i++}`)
        values.push(input.name)
      }
      if (input.email !== undefined) {
        fields.push(`email = $${i++}`)
        values.push(input.email)
      }
      if (input.password_hash !== undefined) {
        fields.push(`password_hash = $${i++}`)
        values.push(input.password_hash)
      }
      if (input.role !== undefined) {
        fields.push(`role = $${i++}`)
        values.push(input.role)
      }
      if (input.profile_image !== undefined) {
        fields.push(`profile_image = $${i++}`)
        values.push(input.profile_image)
      }
      if (input.profile_image_mime !== undefined) {
        fields.push(`profile_image_mime = $${i++}`)
        values.push(input.profile_image_mime)
      }

      if (fields.length === 0) {
        const result = await pool.query<AppUser>('select * from app_user where id = $1', [id])
        return result.rows[0] ?? null
      }

      fields.push(`updated_at = now()`)
      values.push(id)

      try {
        const result = await pool.query<AppUser>(
          `update app_user set ${fields.join(', ')} where id = $${i} returning *`,
          values
        )
        return result.rows[0] ?? null
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError('Email is already registered to another account')
        }
        throw err
      }
    },

    async createRefreshToken({ user_id, token_hash, expires_at }: CreateRefreshTokenInput) {
      const result = await pool.query<RefreshToken>(
        `insert into refresh_token (user_id, token_hash, expires_at)
         values ($1, $2, $3) returning *`,
        [user_id, token_hash, expires_at]
      )
      return result.rows[0]
    },

    async getRefreshTokenByHash(token_hash: string) {
      const result = await pool.query<RefreshToken>('select * from refresh_token where token_hash = $1', [
        token_hash
      ])
      return result.rows[0] ?? null
    },

    async revokeRefreshToken(id: string) {
      await pool.query('update refresh_token set revoked_at = now() where id = $1 and revoked_at is null', [id])
    },

    async revokeAllRefreshTokensForUser(user_id: string, exceptId?: string) {
      if (exceptId) {
        await pool.query(
          'update refresh_token set revoked_at = now() where user_id = $1 and revoked_at is null and id != $2',
          [user_id, exceptId]
        )
      } else {
        await pool.query('update refresh_token set revoked_at = now() where user_id = $1 and revoked_at is null', [
          user_id
        ])
      }
    }
  }
}
