import { Router, type Response } from 'express'
import multer from 'multer'
import type { AppUser, Store, UpdateUserInput } from '../store/types'
import { AuthenticationError, NotFoundError, ValidationError } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
  clearRefreshTokenCookieOptions,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
  refreshTokenExpiresAt,
  signAccessToken,
  verifyPassword
} from '../lib/auth'

const MAX_PROFILE_IMAGE_SIZE_BYTES = 2 * 1024 * 1024
const SUPPORTED_PROFILE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// New signups are assigned to the single seeded org — no org picker yet, per
// the plan's Assumptions (matches the rest of the app's single-org model).
const DEFAULT_ORG_ID = 'demo-org'

const uploadProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_IMAGE_SIZE_BYTES }
})

function isSupportedProfileImageMimeType(mimeType: string): boolean {
  return SUPPORTED_PROFILE_IMAGE_MIME_TYPES.includes(mimeType)
}

function toAuthUser(user: AppUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    org_id: user.org_id,
    has_profile_image: user.profile_image !== null
  }
}

/**
 * Sets both session cookies on the response and returns the freshly-created
 * refresh_token row (callers that need to exclude "the session just
 * re-issued" from a bulk revoke — e.g. PATCH /me's password-change flow —
 * use its id).
 */
async function issueSession(store: Store, res: Response, user: AppUser) {
  const accessToken = signAccessToken({ id: user.id, role: user.role, orgId: user.org_id })
  const { token: refreshToken, tokenHash } = generateRefreshToken()
  const refreshTokenRow = await store.createRefreshToken({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: refreshTokenExpiresAt().toISOString()
  })

  res.cookie(accessTokenCookieName(), accessToken, accessTokenCookieOptions())
  res.cookie(refreshTokenCookieName(), refreshToken, refreshTokenCookieOptions())

  return refreshTokenRow
}

function clearSessionCookies(res: Response) {
  res.clearCookie(accessTokenCookieName(), clearAccessTokenCookieOptions())
  res.clearCookie(refreshTokenCookieName(), clearRefreshTokenCookieOptions())
}

export function createAuthRouter(store: Store): Router {
  const router = Router()

  router.post('/signup', async (req, res, next) => {
    try {
      const { name, email, password, role } = req.body ?? {}

      if (typeof name !== 'string' || name.trim() === '') {
        throw new ValidationError('name is required')
      }
      if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
        throw new ValidationError('A valid email is required')
      }
      if (typeof password !== 'string' || password.length < 8) {
        throw new ValidationError('password must be at least 8 characters')
      }
      // Signup never offers 'admin' — a client-sent role of anything other than
      // recruiter/candidate is rejected outright. See plan Open Question 2.
      if (role !== 'recruiter' && role !== 'candidate') {
        throw new ValidationError("role must be 'recruiter' or 'candidate'")
      }

      const passwordHash = await hashPassword(password)
      const user = await store.createUser({
        org_id: DEFAULT_ORG_ID,
        name,
        email,
        password_hash: passwordHash,
        role
      })

      await issueSession(store, res, user)
      res.status(201).json(toAuthUser(user))
    } catch (error) {
      next(error)
    }
  })

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {}
      const invalidCredentials = () => new AuthenticationError('Invalid email or password')

      if (typeof email !== 'string' || typeof password !== 'string' || email === '' || password === '') {
        throw invalidCredentials()
      }

      const user = await store.getUserByEmail(email)
      if (!user) {
        throw invalidCredentials()
      }

      const validPassword = await verifyPassword(password, user.password_hash)
      if (!validPassword) {
        throw invalidCredentials()
      }

      await issueSession(store, res, user)
      res.status(200).json(toAuthUser(user))
    } catch (error) {
      next(error)
    }
  })

  router.post('/logout', requireAuth, async (req, res, next) => {
    try {
      const refreshToken = req.cookies?.[refreshTokenCookieName()] as string | undefined
      if (refreshToken) {
        const tokenRow = await store.getRefreshTokenByHash(hashRefreshToken(refreshToken))
        if (tokenRow) {
          await store.revokeRefreshToken(tokenRow.id)
        }
      }

      clearSessionCookies(res)
      res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  router.post('/refresh', async (req, res, next) => {
    try {
      const refreshToken = req.cookies?.[refreshTokenCookieName()] as string | undefined
      const invalid = () => {
        clearSessionCookies(res)
        return new AuthenticationError('Invalid or expired refresh token')
      }

      if (!refreshToken) {
        throw invalid()
      }

      const tokenRow = await store.getRefreshTokenByHash(hashRefreshToken(refreshToken))
      if (!tokenRow) {
        throw invalid()
      }

      if (tokenRow.revoked_at) {
        // Reuse of an already-rotated token — treat as a possible stolen
        // token and revoke every outstanding session for this user, not
        // just this one. See .rule/security-rules.md ("invalidate sessions
        // on ... privilege change") and the plan's refresh-rotation Data
        // Model notes.
        await store.revokeAllRefreshTokensForUser(tokenRow.user_id)
        throw invalid()
      }

      if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
        throw invalid()
      }

      const user = await store.getUserById(tokenRow.user_id)
      if (!user) {
        throw invalid()
      }

      await store.revokeRefreshToken(tokenRow.id)
      await issueSession(store, res, user)
      res.status(200).send()
    } catch (error) {
      next(error)
    }
  })

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = await store.getUserById(req.user!.id)
      if (!user) {
        throw new AuthenticationError()
      }
      res.json(toAuthUser(user))
    } catch (error) {
      next(error)
    }
  })

  router.patch('/me', requireAuth, uploadProfileImage.single('profile_image'), async (req, res, next) => {
    try {
      const currentUser = await store.getUserById(req.user!.id)
      if (!currentUser) {
        throw new AuthenticationError()
      }

      const {
        name,
        email,
        role,
        remove_profile_image: removeProfileImage,
        new_password: newPassword,
        current_password: currentPassword
      } = req.body ?? {}

      const updates: UpdateUserInput = {}

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim() === '') {
          throw new ValidationError('name must be a non-empty string')
        }
        updates.name = name
      }

      if (email !== undefined) {
        if (typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
          throw new ValidationError('email must be a valid email address')
        }
        updates.email = email
      }

      // Self-service role change — 'admin' is never a valid target here (it's
      // only ever set directly in the database, same as at signup); a user
      // may only switch between the two self-service roles.
      let privilegeChanged = false
      if (role !== undefined) {
        if (role !== 'recruiter' && role !== 'candidate') {
          throw new ValidationError("role must be 'recruiter' or 'candidate'")
        }
        if (role !== currentUser.role) {
          updates.role = role
          privilegeChanged = true
        }
      }

      let rotatedSession = false
      if (newPassword !== undefined) {
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
          throw new ValidationError('new_password must be at least 8 characters')
        }
        if (typeof currentPassword !== 'string' || currentPassword === '') {
          throw new ValidationError('current_password is required to change password')
        }
        const validCurrentPassword = await verifyPassword(currentPassword, currentUser.password_hash)
        if (!validCurrentPassword) {
          throw new ValidationError('current_password is incorrect')
        }
        updates.password_hash = await hashPassword(newPassword)
        rotatedSession = true
      }

      if (req.file) {
        if (!isSupportedProfileImageMimeType(req.file.mimetype)) {
          throw new ValidationError('profile_image must be image/png, image/jpeg, or image/webp', {
            mime_type: req.file.mimetype
          })
        }
        updates.profile_image = req.file.buffer
        updates.profile_image_mime = req.file.mimetype
      } else if (removeProfileImage === 'true' || removeProfileImage === true) {
        updates.profile_image = null
        updates.profile_image_mime = null
      }

      const updated = await store.updateUser(req.user!.id, updates)
      if (!updated) {
        throw new AuthenticationError()
      }

      if (rotatedSession || privilegeChanged) {
        // Changing the password or role invalidates every other outstanding
        // session for this user (.rule/security-rules.md: "invalidate
        // sessions on ... privilege change"), while keeping the session
        // making this very request alive: issue a fresh pair of cookies
        // first, then revoke every other refresh token, excluding the one
        // just issued.
        const newSessionToken = await issueSession(store, res, updated)
        await store.revokeAllRefreshTokensForUser(updated.id, newSessionToken.id)
      }

      res.json(toAuthUser(updated))
    } catch (error) {
      next(error)
    }
  })

  router.get('/me/profile-image', requireAuth, async (req, res, next) => {
    try {
      const user = await store.getUserById(req.user!.id)
      if (!user) {
        throw new AuthenticationError()
      }
      if (!user.profile_image || !user.profile_image_mime) {
        throw new NotFoundError('No profile image has been uploaded for this user')
      }

      res.setHeader('Content-Type', user.profile_image_mime)
      res.send(user.profile_image)
    } catch (error) {
      next(error)
    }
  })

  return router
}
