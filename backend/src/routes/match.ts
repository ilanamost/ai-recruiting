import { Router } from 'express'
import type { Store } from '../store/types'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { scoreMatch } from '../scoring'
import { requireAuth, requireRole } from '../middleware/auth'

// Permission matrix (.plan/008-2026-08-03-authentication-authorization.md,
// ownership-scoped per .plan/010-2026-08-09-candidate-own-match-visibility.md):
// Admin/Recruiter have full, unrestricted access to create/score and fetch any
// match. Candidate may create/score a match, and fetch an existing match by
// id, only for a resume whose owner_user_id equals their own user id — a
// resume with a null owner (Admin-uploaded, or uploaded before that column
// existed) or owned by a different candidate is 403.
export function createMatchRouter(store: Store): Router {
  const router = Router()
  router.use(requireAuth)

  router.post('/', requireRole('admin', 'recruiter', 'candidate'), async (req, res, next) => {
    try {
      const { resume_id, job_id } = req.body ?? {}

      if (typeof resume_id !== 'string' || resume_id.trim() === '') {
        throw new ValidationError('resume_id is required')
      }
      if (typeof job_id !== 'string' || job_id.trim() === '') {
        throw new ValidationError('job_id is required')
      }

      const [resume, job] = await Promise.all([store.getResume(resume_id), store.getJob(job_id)])

      if (!resume) {
        throw new NotFoundError('Resume not found')
      }
      if (!job) {
        throw new NotFoundError('Job not found')
      }
      if (req.user?.role === 'candidate' && resume.owner_user_id !== req.user.id) {
        throw new ForbiddenError()
      }

      const attached = await store.isResumeAttachedToJob(job_id, resume_id)
      if (!attached) {
        throw new ValidationError('Resume is not attached to this job')
      }

      const { score, explanation } = await scoreMatch(job.description, resume.content)
      const match = await store.createMatch({ resume_id, job_id, score, explanation })

      res.status(201).json(match)
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const match = await store.getMatch(req.params.id)
      if (!match) {
        throw new NotFoundError('Match not found')
      }
      if (req.user?.role === 'candidate') {
        const resume = await store.getResume(match.resume_id)
        if (!resume || resume.owner_user_id !== req.user.id) {
          throw new ForbiddenError()
        }
      }
      res.json(match)
    } catch (error) {
      next(error)
    }
  })

  return router
}
