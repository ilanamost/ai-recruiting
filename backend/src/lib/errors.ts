/**
 * Stable codes returned in the `error.code` field of every failure response.
 * See .rule/error-handling-rules.md for the response shape.
 */
export interface ErrorCodes {
  readonly VALIDATION_ERROR: 'validation_error'
  readonly NOT_FOUND: 'not_found'
  readonly UPSTREAM_ERROR: 'upstream_error'
  readonly CONFLICT: 'conflict'
  readonly UNAUTHENTICATED: 'unauthenticated'
  readonly FORBIDDEN: 'forbidden'
  readonly INTERNAL_ERROR: 'internal_error'
}

export const ErrorCodes: ErrorCodes = {
  VALIDATION_ERROR: 'validation_error',
  NOT_FOUND: 'not_found',
  UPSTREAM_ERROR: 'upstream_error',
  CONFLICT: 'conflict',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  INTERNAL_ERROR: 'internal_error'
}

export type ErrorCode = ErrorCodes[keyof ErrorCodes]

/**
 * Base error type for every domain/validation failure. Route handlers throw
 * these; a single Express error handler (see app.ts) maps them to the stable
 * response shape from .rule/error-handling-rules.md.
 */
export class AppError extends Error {
  code: ErrorCode
  status: number
  details?: unknown

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.VALIDATION_ERROR, message, 400, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(ErrorCodes.NOT_FOUND, message, 404)
    this.name = 'NotFoundError'
  }
}

/** Upstream LLM provider failure — rate limit, overload, or refusal. */
export class UpstreamError extends AppError {
  constructor(message: string) {
    super(ErrorCodes.UPSTREAM_ERROR, message, 502)
    this.name = 'UpstreamError'
  }
}

/** State conflict — e.g. signup/PATCH /me with an email already registered to another account. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(ErrorCodes.CONFLICT, message, 409)
    this.name = 'ConflictError'
  }
}

/** Missing/invalid access_token cookie. See requireAuth in middleware/auth.ts. */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Not authenticated') {
    super(ErrorCodes.UNAUTHENTICATED, message, 401)
    this.name = 'AuthenticationError'
  }
}

/** Authenticated, but req.user.role isn't allowed for this route. See requireRole in middleware/auth.ts. */
export class ForbiddenError extends AppError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super(ErrorCodes.FORBIDDEN, message, 403)
    this.name = 'ForbiddenError'
  }
}
