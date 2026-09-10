import { Router } from 'express'
import multer from 'multer'
import type { Store } from '../store/types'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { parsePageParams } from '../lib/pagination'
import { extractText, SUPPORTED_MIME_TYPES } from '../extraction'
import { analyzeResume, type ResumeAnalysis } from '../analysis'
import { requireAuth, requireRole } from '../middleware/auth'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

/** What an un-analyzed CV looks like: null years is "unclassified" (never zero), skills always `[]`. */
const UNCLASSIFIED: ResumeAnalysis = { years_experience: null, skills: [] }

/**
 * Runs the analysis step, degrading to "unclassified" on any failure rather
 * than failing the request (.plan/029 Scope, and the `error-handling` skill's
 * dependency-failure guidance). A missing API key, a model refusal, a rate
 * limit, or a malformed response must never cost a candidate their upload —
 * an unanalyzed CV still shows under the modal's "All" tab, and the backfill
 * script can classify it later from the stored content.
 *
 * Logs the failure WITHOUT the resume text or the extracted skills: both are
 * derived personal data (.plan/029 Risks, .rule/security-rules.md). Only the
 * request id, the operation, and the error's name/message are recorded.
 */
async function analyzeOrUnclassified(
  resumeText: string,
  context: { requestId?: string; operation: string; resume_id?: string }
): Promise<ResumeAnalysis> {
  try {
    return await analyzeResume(resumeText)
  } catch (error) {
    console.error('resume analysis failed — storing the CV as unclassified', {
      requestId: context.requestId,
      operation: context.operation,
      resume_id: context.resume_id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    })
    return { ...UNCLASSIFIED }
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
})

function isSupportedMimeType(mimeType: string): mimeType is (typeof SUPPORTED_MIME_TYPES)[number] {
  return SUPPORTED_MIME_TYPES.includes(mimeType as (typeof SUPPORTED_MIME_TYPES)[number])
}

// Permission matrix (.plan/008-2026-08-03-authentication-authorization.md,
// corrected 2026-08-04, ownership-scoped per
// .plan/009-2026-08-08-candidate-cv-ownership-scoping.md and widened to the
// read routes by .plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md):
// Admin has full, unrestricted access. Recruiter is read-only but unrestricted
// on what it can read. Candidate can upload a new CV (which becomes their own),
// and can view/download/edit/replace/delete ONLY a CV whose
// resume.owner_user_id equals their own user id — a CV with a null owner
// (Admin-uploaded, or uploaded before this column existed) or owned by a
// different candidate is 403 on GET /:id and GET /:id/file just as it is on the
// mutating routes, and is absent from GET / entirely (both `items` and
// `total`). Read routes carry no requireRole beyond requireAuth; the boundary
// is the per-record ownership check.
export function createResumeRouter(store: Store): Router {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res, next) => {
    try {
      const { page, limit } = parsePageParams(req.query)
      const resumes = await store.listResumes({
        page,
        limit,
        // Admin/Recruiter omit the filter and get the unfiltered list.
        owner_user_id: req.user?.role === 'candidate' ? req.user.id : undefined
      })
      res.json({ items: resumes.items, total: resumes.total, page, limit })
    } catch (error) {
      next(error)
    }
  })

  router.post('/', requireRole('admin', 'candidate'), upload.single('file'), async (req, res, next) => {
    try {
      const { name, email, job_id } = req.body ?? {}

      if (typeof name !== 'string' || name.trim() === '') {
        throw new ValidationError('name is required')
      }
      if (typeof email !== 'string' || email.trim() === '') {
        throw new ValidationError('email is required')
      }
      if (job_id !== undefined && (typeof job_id !== 'string' || job_id.trim() === '')) {
        throw new ValidationError('job_id must be a non-empty string')
      }
      if (!req.file) {
        throw new ValidationError('file is required')
      }
      if (!isSupportedMimeType(req.file.mimetype)) {
        throw new ValidationError('file must be a PDF document', { mime_type: req.file.mimetype })
      }

      if (job_id) {
        const job = await store.getJob(job_id)
        if (!job) {
          throw new NotFoundError('job_id does not reference an existing job')
        }
      }

      const content = await extractText(req.file.buffer, req.file.mimetype)
      const analysis = await analyzeOrUnclassified(content, {
        requestId: res.locals.requestId as string | undefined,
        operation: 'resume.upload'
      })
      const candidate = await store.createCandidate({ name, email })
      const resume = await store.createResume({
        candidate_id: candidate.id,
        job_id: job_id || undefined,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        content,
        file_data: req.file.buffer,
        owner_user_id: req.user?.role === 'candidate' ? req.user.id : undefined,
        years_experience: analysis.years_experience,
        skills: analysis.skills
      })
      const resumeWithCandidate = await store.getResume(resume.id)

      res.status(201).json(resumeWithCandidate)
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const resume = await store.getResume(req.params.id)
      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }
      res.json(resume)
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id/file', async (req, res, next) => {
    try {
      // getResumeFile's ResumeFile shape carries no owner_user_id, so the
      // ownership check (.plan/032) reads the resume record itself. Only a
      // Candidate pays the extra lookup — Admin/Recruiter go straight to the
      // file, unrestricted as before.
      if (req.user?.role === 'candidate') {
        const resume = await store.getResume(req.params.id)
        if (!resume) {
          throw new NotFoundError('Resume not found')
        }
        if (resume.owner_user_id !== req.user.id) {
          throw new ForbiddenError()
        }
      }

      const file = await store.getResumeFile(req.params.id)
      if (!file) {
        throw new NotFoundError('Resume not found')
      }
      if (!file.file_data) {
        throw new NotFoundError("Resume file not available — re-upload or replace this CV's file")
      }

      const disposition = req.query.download === '1' ? 'attachment' : 'inline'
      res.setHeader('Content-Type', file.mime_type)
      res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.file_name)}"`)
      res.send(file.file_data)
    } catch (error) {
      next(error)
    }
  })

  router.put('/:id/file', requireRole('admin', 'candidate'), upload.single('file'), async (req, res, next) => {
    try {
      const resume = await store.getResume(req.params.id)
      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }
      if (!req.file) {
        throw new ValidationError('file is required')
      }
      if (!isSupportedMimeType(req.file.mimetype)) {
        throw new ValidationError('file must be a PDF document', { mime_type: req.file.mimetype })
      }

      const content = await extractText(req.file.buffer, req.file.mimetype)
      // A replaced file is a different CV, so it is re-analyzed and the old
      // years/skills are dropped — including when the re-analysis fails, which
      // correctly leaves the CV unclassified rather than describing it with
      // the previous file's data.
      const analysis = await analyzeOrUnclassified(content, {
        requestId: res.locals.requestId as string | undefined,
        operation: 'resume.replaceFile',
        resume_id: req.params.id
      })
      const updated = await store.replaceResumeFile(req.params.id, {
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        content,
        file_data: req.file.buffer,
        years_experience: analysis.years_experience,
        skills: analysis.skills
      })
      if (!updated) {
        throw new NotFoundError('Resume not found')
      }
      res.json(updated)
    } catch (error) {
      next(error)
    }
  })

  router.patch('/:id', requireRole('admin', 'candidate'), async (req, res, next) => {
    try {
      const existing = await store.getResume(req.params.id)
      if (!existing) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && existing.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }

      const { name, email } = req.body ?? {}

      if (name === undefined && email === undefined) {
        throw new ValidationError('At least one of name or email is required')
      }
      if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
        throw new ValidationError('name must be a non-empty string')
      }
      if (email !== undefined && (typeof email !== 'string' || email.trim() === '')) {
        throw new ValidationError('email must be a non-empty string')
      }

      const resume = await store.updateResume(req.params.id, { name, email })
      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      res.json(resume)
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id', requireRole('admin', 'candidate'), async (req, res, next) => {
    try {
      const existing = await store.getResume(req.params.id)
      if (!existing) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && existing.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }

      const deleted = await store.deleteResume(req.params.id)
      if (!deleted) {
        throw new NotFoundError('Resume not found')
      }
      res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  return router
}
