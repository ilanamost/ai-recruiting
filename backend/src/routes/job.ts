import { Router } from 'express'
import type { Store } from '../store/types'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { parsePageParams } from '../lib/pagination'
import { requireAuth, requireRole } from '../middleware/auth'

// Permission matrix (.plan/008-2026-08-03-authentication-authorization.md,
// corrected 2026-08-04, ownership-scoped per
// .plan/009-2026-08-08-candidate-cv-ownership-scoping.md,
// .plan/010-2026-08-09-candidate-own-match-visibility.md,
// .plan/011-2026-08-09-candidate-job-cv-visibility.md and
// .plan/021-2026-08-11-best-match-star.md): every route
// requires authentication; job create/edit/delete/duplicate are
// Admin/Recruiter only (Candidate never). Attach/detach of CVs to a job are
// Admin/Candidate (Recruiter is read-only on CVs everywhere, including
// within a job) — Admin is unrestricted, Candidate may only attach/detach a
// resume whose owner_user_id equals their own user id (null or someone
// else's owner is 403); read routes are open to any authenticated role,
// except GET /:jobId/resumes/:resumeId/match, which is ownership-scoped for
// Candidate the same way (null or another owner's resume is 403;
// Admin/Recruiter unrestricted). GET /:id/resumes is a distinct kind of
// ownership scoping: it never 403s for Candidate, it stays 200 but
// list-narrows — a Candidate only sees resumes whose owner_user_id equals
// their own user id, silently filtered out of the response rather than
// blocked; Admin/Recruiter receive the unfiltered list.
// GET /:jobId/matches is the one read route Candidate is blocked from
// outright (Admin/Recruiter only): it returns every scored resume's latest
// match for the job in a single response, so letting a Candidate reach it
// would leak other candidates' scores and break the ownership boundary
// .plan/010-2026-08-09-candidate-own-match-visibility.md set — a Candidate
// may only ever see a match for a resume they own. Do not widen it.
/**
 * `location` is optional everywhere (.plan/013-2026-08-10-job-search-filter.md):
 * `undefined` means "not provided" (create stores null, patch leaves the
 * existing value alone), and an empty/whitespace-only string normalizes to
 * `null` rather than being stored as `''` or rejected — unlike title and
 * description, which reject an empty string outright.
 */
function normalizeLocation(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new ValidationError('location must be a string')
  }
  return value.trim() === '' ? null : value
}

export function createJobRouter(store: Store): Router {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res, next) => {
    try {
      const { org_id } = req.query

      if (typeof org_id !== 'string' || org_id.trim() === '') {
        throw new ValidationError('org_id is required')
      }

      const { page, limit } = parsePageParams(req.query)
      const jobs = await store.listJobs(org_id, { page, limit })
      res.json({ items: jobs.items, total: jobs.total, page, limit })
    } catch (error) {
      next(error)
    }
  })

  router.post('/', requireRole('admin', 'recruiter'), async (req, res, next) => {
    try {
      const { org_id, title, description, location } = req.body ?? {}

      if (typeof org_id !== 'string' || org_id.trim() === '') {
        throw new ValidationError('org_id is required')
      }
      if (typeof title !== 'string' || title.trim() === '') {
        throw new ValidationError('title is required')
      }
      if (typeof description !== 'string' || description.trim() === '') {
        throw new ValidationError('description is required')
      }

      const job = await store.createJob({
        org_id,
        title,
        description,
        location: normalizeLocation(location) ?? null
      })
      res.status(201).json(job)
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const job = await store.getJob(req.params.id)
      if (!job) {
        throw new NotFoundError('Job not found')
      }
      res.json(job)
    } catch (error) {
      next(error)
    }
  })

  router.patch('/:id', requireRole('admin', 'recruiter'), async (req, res, next) => {
    try {
      const { title, description, location } = req.body ?? {}

      if (title === undefined && description === undefined && location === undefined) {
        throw new ValidationError('At least one of title, description or location is required')
      }
      if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
        throw new ValidationError('title must be a non-empty string')
      }
      if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
        throw new ValidationError('description must be a non-empty string')
      }

      const job = await store.updateJob(req.params.id, {
        title,
        description,
        location: normalizeLocation(location)
      })
      if (!job) {
        throw new NotFoundError('Job not found')
      }
      res.json(job)
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id', requireRole('admin', 'recruiter'), async (req, res, next) => {
    try {
      const deleted = await store.deleteJob(req.params.id)
      if (!deleted) {
        throw new NotFoundError('Job not found')
      }
      res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  router.post('/:id/duplicate', requireRole('admin', 'recruiter'), async (req, res, next) => {
    try {
      const duplicate = await store.duplicateJob(req.params.id)
      if (!duplicate) {
        throw new NotFoundError('Job not found')
      }
      res.status(201).json(duplicate)
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id/resumes', async (req, res, next) => {
    try {
      const job = await store.getJob(req.params.id)
      if (!job) {
        throw new NotFoundError('Job not found')
      }

      let resumes = await store.listResumesForJob(req.params.id)
      if (req.user?.role === 'candidate') {
        resumes = resumes.filter((resume) => resume.owner_user_id === req.user!.id)
      }
      res.json(resumes)
    } catch (error) {
      next(error)
    }
  })

  router.post('/:id/resumes', requireRole('admin', 'candidate'), async (req, res, next) => {
    try {
      const { resume_id } = req.body ?? {}

      if (typeof resume_id !== 'string' || resume_id.trim() === '') {
        throw new ValidationError('resume_id is required')
      }

      const [job, resume] = await Promise.all([store.getJob(req.params.id), store.getResume(resume_id)])

      if (!job) {
        throw new NotFoundError('Job not found')
      }
      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }

      await store.attachResumeToJob(req.params.id, resume_id)
      res.status(200).json({ job_id: req.params.id, resume_id })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id/resumes/:resumeId', requireRole('admin', 'candidate'), async (req, res, next) => {
    try {
      const job = await store.getJob(req.params.id)
      if (!job) {
        throw new NotFoundError('Job not found')
      }

      const resume = await store.getResume(req.params.resumeId)
      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }

      const detached = await store.detachResumeFromJob(req.params.id, req.params.resumeId)
      if (!detached) {
        throw new NotFoundError('Resume is not attached to this job')
      }
      res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  router.get('/:jobId/matches', requireRole('admin', 'recruiter'), async (req, res, next) => {
    try {
      const job = await store.getJob(req.params.jobId)
      if (!job) {
        throw new NotFoundError('Job not found')
      }

      res.json(await store.listLatestMatchesForJob(req.params.jobId))
    } catch (error) {
      next(error)
    }
  })

  router.get('/:jobId/resumes/:resumeId/match', async (req, res, next) => {
    try {
      const { jobId, resumeId } = req.params

      const attached = await store.isResumeAttachedToJob(jobId, resumeId)
      if (!attached) {
        throw new NotFoundError('Resume is not attached to this job')
      }

      const resume = await store.getResume(resumeId)
      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      if (req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }

      const match = await store.getLatestMatchForPair(jobId, resumeId)
      if (!match) {
        throw new NotFoundError('No match found for this job and resume')
      }

      res.json(match)
    } catch (error) {
      next(error)
    }
  })

  return router
}
