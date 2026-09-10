import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// pg-store.ts's deleteJob/deleteResume do a bare `delete from job|resume where id = $1`
// and rely entirely on the database enforcing cascade deletes via foreign key
// constraints (see backend/src/store/pg-store.ts). That reliance is invisible to
// pg-store's own code and is never exercised by the vitest suite, which only runs
// against memory-store (no live Postgres instance is available in this environment).
// This test pins the schema-level guarantee those routes depend on, so an accidental
// change to schema.sql (e.g. dropping `on delete cascade`) fails CI instead of only
// surfacing as silent orphaned rows in production.
const schema = readFileSync(join(__dirname, '../schema.sql'), 'utf-8')

describe('schema.sql cascade constraints', () => {
  it('job_resume.job_id references job with on delete cascade', () => {
    expect(schema).toMatch(/job_id\s+uuid\s+not\s+null\s+references\s+job\(id\)\s+on\s+delete\s+cascade/i)
  })

  it('job_resume.resume_id references resume with on delete cascade', () => {
    expect(schema).toMatch(/resume_id\s+uuid\s+not\s+null\s+references\s+resume\(id\)\s+on\s+delete\s+cascade/i)
  })

  it('match.resume_id references resume with on delete cascade', () => {
    expect(schema).toMatch(/resume_id\s+uuid\s+not\s+null\s+references\s+resume\(id\)\s+on\s+delete\s+cascade/i)
  })

  it('match.job_id references job with on delete cascade', () => {
    expect(schema).toMatch(/job_id\s+uuid\s+not\s+null\s+references\s+job\(id\)\s+on\s+delete\s+cascade/i)
  })
})

describe('schema.sql resume/job_resume shape', () => {
  it('resume no longer has a job_id column', () => {
    expect(schema).not.toMatch(/job_id\s+uuid\s+not\s+null\s+references\s+job\(id\)\s+on\s+delete\s+cascade,?\s*\n\s*file_name/i)
  })

  it('resume has a required file_data bytea column', () => {
    expect(schema).toMatch(/file_data\s+bytea\s+not\s+null/i)
  })

  it('job_resume has a composite primary key on (job_id, resume_id)', () => {
    expect(schema).toMatch(/primary\s+key\s*\(\s*job_id\s*,\s*resume_id\s*\)/i)
  })

  it('job_resume has an index on resume_id', () => {
    expect(schema).toMatch(/create\s+index\s+if\s+not\s+exists\s+job_resume_resume_id_idx\s+on\s+job_resume\(resume_id\)/i)
  })
})

// .plan/029-2026-09-07-cv-recruiter-filter.md's analysis output. Same reasoning
// as the cascade tests above: pg-store's deleteResume is a bare `delete from
// resume`, so resume_skill's cleanup is a schema-level guarantee the vitest
// suite (memory-store only) can never exercise directly.
describe('schema.sql resume analysis columns and resume_skill', () => {
  it('resume has a nullable years_experience column', () => {
    expect(schema).toMatch(/years_experience\s+integer\s+null/i)
  })

  it('adds years_experience to an already-running database with a standalone alter', () => {
    expect(schema).toMatch(
      /alter\s+table\s+if\s+exists\s+resume\s+add\s+column\s+if\s+not\s+exists\s+years_experience\s+integer/i
    )
  })

  it('years_experience is nullable, never NOT NULL — null means unclassified, not zero', () => {
    expect(schema).not.toMatch(/years_experience\s+integer\s+not\s+null/i)
  })

  // The band is a presentation rule over years_experience, not stored data —
  // persisting it would need a migration every time the boundaries are tuned.
  it('does not persist a derived experience level column', () => {
    expect(schema).not.toMatch(/experience_level/i)
  })

  it('creates resume_skill with if not exists', () => {
    expect(schema).toMatch(/create\s+table\s+if\s+not\s+exists\s+resume_skill\s*\(/i)
  })

  it('resume_skill.resume_id references resume with on delete cascade', () => {
    expect(schema).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+resume_skill\s*\([^)]*resume_id\s+uuid\s+not\s+null\s+references\s+resume\(id\)\s+on\s+delete\s+cascade/i
    )
  })

  it('resume_skill has a composite primary key on (resume_id, skill), so skills de-duplicate', () => {
    expect(schema).toMatch(/primary\s+key\s*\(\s*resume_id\s*,\s*skill\s*\)/i)
  })

  it('resume_skill has an index on skill', () => {
    expect(schema).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+resume_skill_skill_idx\s+on\s+resume_skill\(skill\)/i
    )
  })
})
