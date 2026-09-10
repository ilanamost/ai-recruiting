import { randomUUID } from 'crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { Store } from './store/types'
import { createAuthRouter } from './routes/auth'
import { createJobRouter } from './routes/job'
import { createResumeRouter } from './routes/resume'
import { createMatchRouter } from './routes/match'
import { AppError } from './lib/errors'

export function createApp(store: Store) {
  const app = express()

  // credentials: true is required so the browser sends/accepts the httpOnly
  // access_token/refresh_token cookies (see .plan/008-*'s Assumptions) —
  // every frontend request sends credentials: 'include'.
  app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173', credentials: true }))
  app.use(express.json())
  app.use(cookieParser())

  app.use((_req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID()
    res.locals.requestId = requestId
    res.setHeader('x-request-id', requestId)
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/api/auth', createAuthRouter(store))
  app.use('/api/job', createJobRouter(store))
  app.use('/api/resume', createResumeRouter(store))
  app.use('/api/match', createMatchRouter(store))

  // Error handler must be the last middleware and keep all four params so
  // Express recognizes it as an error handler. See .rule/error-handling-rules.md.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined

    if (isMulterError(err)) {
      res.status(400).json({
        error: { code: 'validation_error', message: 'Uploaded file is invalid or too large' },
        requestId
      })
      return
    }

    if (err instanceof AppError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
        requestId
      })
      return
    }

    console.error(`[${requestId}] unexpected error`, err)
    res.status(500).json({
      error: { code: 'internal_error', message: 'Something went wrong' },
      requestId
    })
  })

  return app
}

function isMulterError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'MulterError'
}
