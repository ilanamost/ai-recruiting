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

/** Returns the token from an `Authorization: Bearer <token>` header, or undefined. */
export function readBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (typeof header !== 'string') return undefined
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1] : undefined
}

/**
 * Verifies the access token and attaches req.user. The token comes from the
 * access_token cookie or, as a fallback for browsers that drop cross-site
 * cookies (iOS Safari — .plan/036), from `Authorization: Bearer <jwt>`. Same
 * JWT, same TTL, same claims either way; a valid cookie wins over the header.
 * Throws a 401 AuthenticationError if neither carries a valid token — per the
 * plan, this never touches the store: the JWT payload itself carries
 * id/role/orgId, so every authenticated request is a single verify, not a
 * DB round trip.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[accessTokenCookieName()] as string | undefined
  const payload = verifyAccessToken(cookieToken) ?? verifyAccessToken(readBearerToken(req))

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
