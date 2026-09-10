import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken, accessTokenCookieName } from '../lib/auth'
import { AuthenticationError, ForbiddenError } from '../lib/errors'
import type { Role } from '../store/types'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; orgId: string }
    }
  }
}

/**
 * Verifies the access_token cookie and attaches req.user. Throws a 401
 * AuthenticationError if the cookie is missing/invalid/expired — per the
 * plan, this never touches the store: the JWT payload itself carries
 * id/role/orgId, so every authenticated request is a single verify, not a
 * DB round trip.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[accessTokenCookieName()] as string | undefined
  const payload = verifyAccessToken(token)

  if (!payload) {
    next(new AuthenticationError())
    return
  }

  req.user = payload
  next()
}

/** Throws a 403 ForbiddenError if req.user.role isn't one of the allowed roles. Must run after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new ForbiddenError())
      return
    }
    next()
  }
}
