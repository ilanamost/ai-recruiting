import 'dotenv/config'
import { Pool, type PoolClient } from 'pg'
import { analyzeResume } from '../src/analysis'

/**
 * One-off backfill for .plan/029-2026-09-07-cv-recruiter-filter.md Open
 * Question 7: CVs uploaded before the analysis step existed have no
 * years_experience and no skill rows, so they are "unclassified" and appear
 * only under the modal's "All" tab. This classifies them from the `content`
 * the extraction step already stored — no re-upload, and no need for the
 * original file bytes.
 *
 * Run once against a database after applying the schema.sql additions:
 *
 *   cd backend && npx tsx scripts/backfill-resume-analysis.ts
 *
 * Idempotent and safe to re-run: it only selects resumes that have neither a
 * years_experience nor any resume_skill row, and each resume's write is its
 * own transaction, so an interrupted run resumes where it stopped. A CV the
 * model genuinely reads as unclassified (null years, no skills) stays in the
 * candidate set and will be re-analyzed on the next run — the database is
 * unchanged by that, it just costs one more call.
 *
 * Logs resume ids and counts only, never resume text or extracted skills —
 * both are personal data (.plan/029 Risks).
 */

interface UnanalyzedResume {
  id: string
  content: string
}

const SELECT_UNANALYZED = `
  select resume.id, resume.content
  from resume
  where resume.years_experience is null
    and not exists (select 1 from resume_skill where resume_skill.resume_id = resume.id)
  order by resume.created_at
`

async function persistAnalysis(
  client: PoolClient,
  resume_id: string,
  years_experience: number | null,
  skills: string[]
): Promise<void> {
  try {
    await client.query('begin')
    await client.query('update resume set years_experience = $1 where id = $2', [years_experience, resume_id])
    await client.query('delete from resume_skill where resume_id = $1', [resume_id])
    if (skills.length > 0) {
      await client.query(
        `insert into resume_skill (resume_id, skill)
         select $1, unnest($2::text[])
         on conflict (resume_id, skill) do nothing`,
        [resume_id, skills]
      )
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  try {
    const { rows } = await pool.query<UnanalyzedResume>(SELECT_UNANALYZED)
    console.log(`backfill-resume-analysis: ${rows.length} resume(s) with no analysis yet`)

    let analyzed = 0
    let unclassified = 0
    let failed = 0

    for (const resume of rows) {
      let years_experience: number | null = null
      let skills: string[] = []

      try {
        const analysis = await analyzeResume(resume.content)
        years_experience = analysis.years_experience
        skills = analysis.skills
      } catch (error) {
        // Same degradation as the upload path: one CV the model can't read
        // must not abort the whole backfill. It stays unclassified and is
        // picked up again by the next run.
        failed++
        console.error(`  ${resume.id}: analysis failed, left unclassified`, {
          error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
        })
        continue
      }

      const client = await pool.connect()
      try {
        await persistAnalysis(client, resume.id, years_experience, skills)
      } finally {
        client.release()
      }

      if (years_experience === null && skills.length === 0) {
        unclassified++
        console.log(`  ${resume.id}: no years and no skills found — still unclassified`)
      } else {
        analyzed++
        console.log(`  ${resume.id}: years=${years_experience ?? 'null'}, ${skills.length} skill(s)`)
      }
    }

    console.log(
      `backfill-resume-analysis: done — ${analyzed} classified, ${unclassified} unclassified, ${failed} failed`
    )
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('backfill-resume-analysis: aborted', err instanceof Error ? `${err.name}: ${err.message}` : err)
  process.exitCode = 1
})
