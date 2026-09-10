import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { createAuthedUser } from './helpers/auth'

function setCookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie']
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

function extractCookie(response: request.Response, name: string): string {
  const match = setCookiesOf(response).find((c) => c.startsWith(`${name}=`))
  if (!match) throw new Error(`Expected a Set-Cookie for "${name}" but found none`)
  return match.split(';')[0]
}

function cookieHeader(...cookies: string[]): string {
  return cookies.join('; ')
}

function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  return { store, app }
}

describe('POST /api/auth/signup', () => {
  it('creates a recruiter account and starts a session', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane Recruiter', email: 'jane@example.com', password: 'correct-password-123', role: 'recruiter' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      name: 'Jane Recruiter',
      email: 'jane@example.com',
      role: 'recruiter',
      org_id: 'demo-org',
      has_profile_image: false
    })
    expect(response.body.id).toBeTypeOf('string')
    expect(response.body.password_hash).toBeUndefined()
    expect(setCookiesOf(response).some((c) => c.startsWith('access_token='))).toBe(true)
    expect(setCookiesOf(response).some((c) => c.startsWith('refresh_token='))).toBe(true)
  })

  it('rejects a duplicate email with a clean 409, not a raw Postgres error', async () => {
    const { app } = setup()
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'dup@example.com', password: 'correct-password-123', role: 'candidate' })

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Someone Else', email: 'dup@example.com', password: 'another-password-1', role: 'candidate' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('conflict')
    expect(response.body.error.message).not.toMatch(/duplicate key|constraint|postgres/i)
  })

  it('rejects a missing name', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('rejects an invalid email', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'not-an-email', password: 'correct-password-123', role: 'candidate' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('rejects a password under 8 characters', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'short', role: 'candidate' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('never trusts a client-sent admin role', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'admin' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })
})

describe('POST /api/auth/login', () => {
  it('authenticates with a valid email/password and starts a session', async () => {
    const { app } = setup()
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jane@example.com', password: 'correct-password-123' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ email: 'jane@example.com', role: 'candidate' })
    expect(setCookiesOf(response).some((c) => c.startsWith('access_token='))).toBe(true)
  })

  it('rejects a wrong password with a generic 401 message', async () => {
    const { app } = setup()
    await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jane@example.com', password: 'wrong-password' })

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Invalid email or password')
  })

  it('rejects an unknown email with the same generic message as a wrong password', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' })

    expect(response.status).toBe(401)
    expect(response.body.error.message).toBe('Invalid email or password')
  })
})

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const { app } = setup()
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })
    const oldRefresh = extractCookie(signup, 'refresh_token')

    const response = await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(oldRefresh))

    expect(response.status).toBe(200)
    const newAccess = extractCookie(response, 'access_token')
    const newRefresh = extractCookie(response, 'refresh_token')
    // The refresh token is always freshly randomized. The access token is a
    // JWT signed from the same payload — if refresh happens within the same
    // second as signup, the resulting token string can legitimately be
    // byte-identical (JWT has second-granularity iat, no nonce), so only the
    // refresh token's uniqueness is asserted here directly.
    expect(newRefresh).not.toBe(oldRefresh)

    // The new access token authenticates against a protected route.
    const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(newAccess))
    expect(me.status).toBe(200)
  })

  it('returns 401 and does not issue a new token when the refresh token was already rotated (reuse)', async () => {
    const { app } = setup()
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })
    const oldRefresh = extractCookie(signup, 'refresh_token')

    await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(oldRefresh))

    // Reusing the already-rotated (old) refresh token.
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(oldRefresh))

    expect(reuse.status).toBe(401)
    expect(reuse.body.error.code).toBe('unauthenticated')
  })

  it('returns 401 when no refresh_token cookie is present', async () => {
    const { app } = setup()

    const response = await request(app).post('/api/auth/refresh')

    expect(response.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token so a subsequent refresh with it fails', async () => {
    const { app } = setup()
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })
    const access = extractCookie(signup, 'access_token')
    const refresh = extractCookie(signup, 'refresh_token')

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(access, refresh))

    expect(logout.status).toBe(204)

    const refreshAfterLogout = await request(app).post('/api/auth/refresh').set('Cookie', cookieHeader(refresh))
    expect(refreshAfterLogout.status).toBe(401)
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = setup()

    const response = await request(app).post('/api/auth/logout')

    expect(response.status).toBe(401)
  })
})

describe('GET /api/auth/me', () => {
  it("returns the authenticated user's own profile", async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'recruiter', { name: 'Rex Recruiter', email: 'rex@example.com' })

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ name: 'Rex Recruiter', email: 'rex@example.com', role: 'recruiter' })
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = setup()

    const response = await request(app).get('/api/auth/me')

    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/auth/me', () => {
  it('updates name and email', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'candidate')

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .field('name', 'New Name')
      .field('email', 'new-email@example.com')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ name: 'New Name', email: 'new-email@example.com' })
  })

  it('rejects a new_password without the correct current_password', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'candidate', { password: 'correct-password-123' })

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .field('new_password', 'brand-new-password-1')
      .field('current_password', 'totally-wrong-password')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('changing the password revokes every other outstanding session, but not the one making the change', async () => {
    const { app } = setup()
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })
    const sessionAAccess = extractCookie(signup, 'access_token')

    // A second, independent session for the same user (e.g. logged in on
    // another device) — login again to mint a second refresh token.
    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jane@example.com', password: 'correct-password-123' })
    const sessionBRefresh = extractCookie(secondLogin, 'refresh_token')

    const passwordChange = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', sessionAAccess)
      .field('new_password', 'brand-new-password-1')
      .field('current_password', 'correct-password-123')

    expect(passwordChange.status).toBe(200)

    // Session B's refresh token was revoked by the password change.
    const sessionBRefreshAttempt = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(sessionBRefresh))
    expect(sessionBRefreshAttempt.status).toBe(401)

    // Session A keeps working via the newly-issued cookies from the PATCH response.
    const newSessionAAccess = extractCookie(passwordChange, 'access_token')
    const meWithNewSession = await request(app).get('/api/auth/me').set('Cookie', newSessionAAccess)
    expect(meWithNewSession.status).toBe(200)
  })

  it('uploads a profile image and makes it fetchable via GET /api/auth/me/profile-image', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'candidate')
    // Minimal valid PNG file signature bytes — enough for a mime-type-based check.
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .attach('profile_image', pngBytes, { filename: 'avatar.png', contentType: 'image/png' })

    expect(response.status).toBe(200)
    expect(response.body.has_profile_image).toBe(true)

    const image = await request(app).get('/api/auth/me/profile-image').set('Cookie', cookie)
    expect(image.status).toBe(200)
    expect(image.headers['content-type']).toContain('image/png')
    expect(image.body).toBeInstanceOf(Buffer)
  })

  it('rejects an unsupported profile image type', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'candidate')

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .attach('profile_image', Buffer.from('not an image'), { filename: 'avatar.txt', contentType: 'text/plain' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('changes role from recruiter to candidate (self-service)', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'recruiter')

    const response = await request(app).patch('/api/auth/me').set('Cookie', cookie).field('role', 'candidate')

    expect(response.status).toBe(200)
    expect(response.body.role).toBe('candidate')
  })

  it('rejects setting role to admin, even for an authenticated user', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'recruiter')

    const response = await request(app).patch('/api/auth/me').set('Cookie', cookie).field('role', 'admin')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
  })

  it('changing role revokes every other outstanding session, but not the one making the change', async () => {
    const { app } = setup()
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'recruiter' })
    const sessionAAccess = extractCookie(signup, 'access_token')

    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jane@example.com', password: 'correct-password-123' })
    const sessionBRefresh = extractCookie(secondLogin, 'refresh_token')

    const roleChange = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', sessionAAccess)
      .field('role', 'candidate')

    expect(roleChange.status).toBe(200)

    const sessionBRefreshAttempt = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(sessionBRefresh))
    expect(sessionBRefreshAttempt.status).toBe(401)

    const newSessionAAccess = extractCookie(roleChange, 'access_token')
    const meWithNewSession = await request(app).get('/api/auth/me').set('Cookie', newSessionAAccess)
    expect(meWithNewSession.status).toBe(200)
  })

  it('setting role to its current value is a no-op (no session revocation)', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'recruiter')

    const response = await request(app).patch('/api/auth/me').set('Cookie', cookie).field('role', 'recruiter')

    expect(response.status).toBe(200)
    // No new session was issued, so no fresh access_token cookie is set.
    expect(setCookiesOf(response).some((c) => c.startsWith('access_token='))).toBe(false)
  })

  it('removes an uploaded profile image via remove_profile_image', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'candidate')
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    await request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .attach('profile_image', pngBytes, { filename: 'avatar.png', contentType: 'image/png' })

    const removed = await request(app)
      .patch('/api/auth/me')
      .set('Cookie', cookie)
      .field('remove_profile_image', 'true')

    expect(removed.status).toBe(200)
    expect(removed.body.has_profile_image).toBe(false)

    const image = await request(app).get('/api/auth/me/profile-image').set('Cookie', cookie)
    expect(image.status).toBe(404)
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = setup()

    const response = await request(app).patch('/api/auth/me').field('name', 'New Name')

    expect(response.status).toBe(401)
  })
})

describe('GET /api/auth/me/profile-image', () => {
  it('returns 404 when the user has not uploaded a profile image', async () => {
    const { store, app } = setup()
    const { cookie } = await createAuthedUser(store, 'candidate')

    const response = await request(app).get('/api/auth/me/profile-image').set('Cookie', cookie)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = setup()

    const response = await request(app).get('/api/auth/me/profile-image')

    expect(response.status).toBe(401)
  })
})
