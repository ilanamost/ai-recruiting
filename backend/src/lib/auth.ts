import { randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { CookieOptions } from 'express'
import type { Role } from '../store/types'

/**
 * Centralized auth primitives per .rule/security-rules.md ("keep
 * security-relevant logic centralized, not duplicated per endpoint"). See
 * .plan/008-2026-08-03-authentication-authorization.md's Data Model /
 * Assumptions sections for the exact cookie names/attributes/expiries.
 */

const BCRYPT_SALT_ROUNDS = 10

const ACCESS_TOKEN_COOKIE = 'access_token'
const REFRESH_TOKEN_COOKIE = 'refresh_token'
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AccessTokenPayload {
  id: string
  role: Role
  orgId: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS)
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash)
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  return secret
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL_SECONDS })
}

/** Returns the decoded payload, or null if the token is missing/invalid/expired. */
export function verifyAccessToken(token: string | undefined): AccessTokenPayload | null {
  if (!token) return null
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    if (typeof decoded !== 'object' || decoded === null) return null
    const { id, role, orgId } = decoded as Partial<AccessTokenPayload>
    if (typeof id !== 'string' || typeof role !== 'string' || typeof orgId !== 'string') return null
    return { id, role: role as Role, orgId }
  } catch {
    return null
  }
}

/** Opaque random refresh token: `token` goes in the cookie, `tokenHash` is what's stored (never the raw value). */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashRefreshToken(token) }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
}

/**
 * Outside local development the frontend and backend live on different origins
 * (e.g. GitHub Pages -> a separately hosted API), where `sameSite: 'lax'` makes
 * the browser silently drop the auth cookies on cross-site requests. SameSite=None
 * is only honored together with Secure, so the two flags move as a pair.
 * NODE_ENV unset counts as development (matches Node/Express's own convention) so an
 * existing local checkout isn't silently switched to cross-site cookies over plain http.
 */
function baseCookieOptions(): CookieOptions {
  const isDevelopment = (process.env.NODE_ENV ?? 'development') === 'development'
  return {
    httpOnly: true,
    sameSite: isDevelopment ? 'lax' : 'none',
    secure: !isDevelopment
  }
}

export function accessTokenCookieName(): string {
  return ACCESS_TOKEN_COOKIE
}

export function refreshTokenCookieName(): string {
  return REFRESH_TOKEN_COOKIE
}

export function accessTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 }
}

export function refreshTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/api/auth', maxAge: REFRESH_TOKEN_TTL_MS }
}

/** Options for clearing a cookie must match path (and other non-expiry attributes) it was set with. */
export function clearAccessTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/' }
}

export function clearRefreshTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: '/api/auth' }
}
