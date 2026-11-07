import { describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'
import { signAccessToken } from '../src/lib/auth'
import { createAuthedUser } from './helpers/auth'

/**
 * Bearer-token fallback for browsers that drop cross-site cookies (iOS Safari).
 * .plan/036-2026-11-07-mobile-iphone-auth-and-layout.md, .orchestrate/api-contract.yaml.
 * The cookie flow is covered unchanged by tests/auth.test.ts.
 */

const FRONTEND_URL = 'http://localhost:5173'

function setup() {
  const store = createMemoryStore()
  const app = createApp(store)
  return { store, app }
}

function setCookiesOf(response: request.Response): string[] {
  const raw = response.headers['set-cookie']
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

async function signupForTokens(app: ReturnType<typeof createApp>, email = 'bearer@example.com') {
  const response = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Bearer User', email, password: 'correct-password-123', role: 'recruiter' })
  expect(response.status).toBe(201)
  return response.body as { id: string; access_token: string; refresh_token: string }
}

describe('token pair in the body', () => {
  it('signup returns the user plus access_token and refresh_token, and still sets cookies', async () => {
    const { app } = setup()

    const response = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ email: 'jane@example.com', role: 'candidate', has_profile_image: false })
    expect(response.body.access_token).toBeTypeOf('string')
    expect(response.body.refresh_token).toBeTypeOf('string')
    expect(response.body.password_hash).toBeUndefined()
    expect(setCookiesOf(response).some((c) => c.startsWith('access_token='))).toBe(true)
    expect(setCookiesOf(response).some((c) => c.startsWith('refresh_token='))).toBe(true)
  })

  it('login returns the user plus the token pair', async () => {
    const { app, store } = setup()
    const { user, password } = await createAuthedUser(store, 'recruiter')

    const response = await request(app).post('/api/auth/login').send({ email: user.email, password })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: user.id, email: user.email })
    expect(response.body.access_token).toBeTypeOf('string')
    expect(response.body.refresh_token).toBeTypeOf('string')
  })

  it('login with bad credentials returns 401 and no tokens', async () => {
    const { app, store } = setup()
    const { user } = await createAuthedUser(store, 'recruiter')

    const response = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('unauthenticated')
    expect(response.body.access_token).toBeUndefined()
  })
})

describe('requireAuth with Authorization: Bearer', () => {
  it('accepts a valid bearer access token with no cookie', async () => {
    const { app } = setup()
    const { id, access_token: accessToken } = await signupForTokens(app)

    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(id)
  })

  it('protects other resources the same way (GET /api/job)', async () => {
    const { app } = setup()
    const { access_token: accessToken } = await signupForTokens(app)

    const response = await request(app).get('/api/job?org_id=demo-org').set('Authorization', `Bearer ${accessToken}`)

    expect(response.status).toBe(200)
  })

  it('returns 401 for an expired bearer token', async () => {
    const { app, store } = setup()
    const { user } = await createAuthedUser(store, 'recruiter')
    const expired = jwt.sign(
      { id: user.id, role: user.role, orgId: user.org_id },
      process.env.JWT_SECRET as string,
      { expiresIn: -10 }
    )

    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('unauthenticated')
  })

  it('returns 401 for a bearer token signed with the wrong secret', async () => {
    const { app, store } = setup()
    const { user } = await createAuthedUser(store, 'recruiter')
    const forged = jwt.sign({ id: user.id, role: 'admin', orgId: user.org_id }, 'not-the-real-secret')

    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('unauthenticated')
  })

  it('returns 401 for a garbage bearer token or a non-Bearer scheme', async () => {
    const { app, store } = setup()
    const { user } = await createAuthedUser(store, 'recruiter')
    const valid = signAccessToken({ id: user.id, role: user.role, orgId: user.org_id })

    const garbage = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt')
    const wrongScheme = await request(app).get('/api/auth/me').set('Authorization', `Basic ${valid}`)

    expect(garbage.status).toBe(401)
    expect(wrongScheme.status).toBe(401)
  })

  it('a valid cookie wins over an invalid bearer header', async () => {
    const { app, store } = setup()
    const { user, cookie } = await createAuthedUser(store, 'recruiter')

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer not-a-jwt')

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(user.id)
  })

  it('a valid cookie wins over a valid bearer for a different user', async () => {
    const { app, store } = setup()
    const cookieUser = await createAuthedUser(store, 'recruiter')
    const bearerUser = await createAuthedUser(store, 'candidate')
    const bearer = signAccessToken({ id: bearerUser.user.id, role: 'candidate', orgId: 'demo-org' })

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieUser.cookie)
      .set('Authorization', `Bearer ${bearer}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(cookieUser.user.id)
  })

  it('falls back to a valid bearer when the cookie is invalid', async () => {
    const { app } = setup()
    const { id, access_token: accessToken } = await signupForTokens(app)

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'access_token=stale-garbage')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(response.status).toBe(200)
    expect(response.body.id).toBe(id)
  })
})

describe('POST /api/auth/refresh via body', () => {
  it('rotates the pair when the refresh token comes in the body', async () => {
    const { app } = setup()
    const { id, refresh_token: oldRefresh } = await signupForTokens(app)

    const response = await request(app).post('/api/auth/refresh').send({ refresh_token: oldRefresh })

    expect(response.status).toBe(200)
    expect(response.body.access_token).toBeTypeOf('string')
    expect(response.body.refresh_token).toBeTypeOf('string')
    expect(response.body.refresh_token).not.toBe(oldRefresh)
    // Cookies are still set for clients that can keep them.
    expect(setCookiesOf(response).some((c) => c.startsWith('refresh_token='))).toBe(true)

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${response.body.access_token}`)
    expect(me.status).toBe(200)
    expect(me.body.id).toBe(id)
  })

  it('the rotated refresh token works for the next refresh', async () => {
    const { app } = setup()
    const { refresh_token: first } = await signupForTokens(app)

    const second = await request(app).post('/api/auth/refresh').send({ refresh_token: first })
    const third = await request(app).post('/api/auth/refresh').send({ refresh_token: second.body.refresh_token })

    expect(third.status).toBe(200)
    expect(third.body.refresh_token).not.toBe(second.body.refresh_token)
  })

  it('reusing a rotated body token returns 401 and revokes every session of the user', async () => {
    const { app } = setup()
    const { refresh_token: oldRefresh } = await signupForTokens(app)

    const rotated = await request(app).post('/api/auth/refresh').send({ refresh_token: oldRefresh })
    expect(rotated.status).toBe(200)

    const reuse = await request(app).post('/api/auth/refresh').send({ refresh_token: oldRefresh })
    expect(reuse.status).toBe(401)
    expect(reuse.body.error.code).toBe('unauthenticated')

    // Reuse detection revoked the newer token too.
    const afterReuse = await request(app).post('/api/auth/refresh').send({ refresh_token: rotated.body.refresh_token })
    expect(afterReuse.status).toBe(401)
  })

  it('returns 401 for an unknown body token', async () => {
    const { app } = setup()

    const response = await request(app).post('/api/auth/refresh').send({ refresh_token: 'not-a-real-token' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('unauthenticated')
  })

  it('returns 401 for a non-string body token', async () => {
    const { app } = setup()

    const response = await request(app).post('/api/auth/refresh').send({ refresh_token: 12345 })

    expect(response.status).toBe(401)
  })

  it('cookie refresh token wins over the body', async () => {
    const { app } = setup()
    const { refresh_token: bodyToken } = await signupForTokens(app, 'a@example.com')
    const other = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Other', email: 'b@example.com', password: 'correct-password-123', role: 'candidate' })
    const cookieToken = other.body.refresh_token as string

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${cookieToken}`)
      .send({ refresh_token: bodyToken })
    expect(response.status).toBe(200)

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${response.body.access_token}`)
    expect(me.body.email).toBe('b@example.com')

    // The body token was not consumed.
    const bodyStillValid = await request(app).post('/api/auth/refresh').send({ refresh_token: bodyToken })
    expect(bodyStillValid.status).toBe(200)
  })
})

describe('POST /api/auth/logout via bearer + body', () => {
  it('revokes the body refresh token so a later refresh with it fails', async () => {
    const { app } = setup()
    const { access_token: accessToken, refresh_token: refreshToken } = await signupForTokens(app)

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refresh_token: refreshToken })
    expect(logout.status).toBe(204)

    const refresh = await request(app).post('/api/auth/refresh').send({ refresh_token: refreshToken })
    expect(refresh.status).toBe(401)
  })

  it('returns 401 without a cookie or a bearer', async () => {
    const { app } = setup()
    const { refresh_token: refreshToken } = await signupForTokens(app)

    const logout = await request(app).post('/api/auth/logout').send({ refresh_token: refreshToken })

    expect(logout.status).toBe(401)
  })
})

describe('CORS', () => {
  it('allows the Authorization header on preflight from the frontend origin', async () => {
    const { app } = setup()

    const response = await request(app)
      .options('/api/auth/me')
      .set('Origin', FRONTEND_URL)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type')

    expect(response.status).toBeLessThan(300)
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_URL)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization')
  })
})

describe('PATCH /api/auth/me token pair', () => {
  it('returns a new working pair when the password changes and revokes the old refresh token', async () => {
    const { app } = setup()
    const { access_token: accessToken, refresh_token: oldRefresh } = await signupForTokens(app)

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('new_password', 'brand-new-password-456')
      .field('current_password', 'correct-password-123')

    expect(response.status).toBe(200)
    expect(response.body.access_token).toBeTypeOf('string')
    expect(response.body.refresh_token).toBeTypeOf('string')
    expect(response.body.password_hash).toBeUndefined()

    // The new refresh token works. (Checked before replaying the old one: a
    // replay of a revoked token is reuse detection and revokes everything.)
    const newRefreshAttempt = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: response.body.refresh_token })
    expect(newRefreshAttempt.status).toBe(200)

    const oldRefreshAttempt = await request(app).post('/api/auth/refresh').send({ refresh_token: oldRefresh })
    expect(oldRefreshAttempt.status).toBe(401)
  })

  it('returns a new pair carrying the new role when the role changes', async () => {
    const { app } = setup()
    const { access_token: accessToken } = await signupForTokens(app)

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('role', 'candidate')

    expect(response.status).toBe(200)
    expect(response.body.role).toBe('candidate')
    const decoded = jwt.decode(response.body.access_token) as { role: string }
    expect(decoded.role).toBe('candidate')
  })

  it('returns no tokens for a plain profile edit', async () => {
    const { app } = setup()
    const { access_token: accessToken } = await signupForTokens(app)

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('name', 'Renamed')

    expect(response.status).toBe(200)
    expect(response.body.name).toBe('Renamed')
    expect(response.body.access_token).toBeUndefined()
    expect(response.body.refresh_token).toBeUndefined()
  })

  it('returns 400 with no tokens for a wrong current_password', async () => {
    const { app } = setup()
    const { access_token: accessToken } = await signupForTokens(app)

    const response = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('new_password', 'brand-new-password-456')
      .field('current_password', 'wrong-password')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation_error')
    expect(response.body.access_token).toBeUndefined()
  })
})
