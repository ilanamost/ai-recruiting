import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import { createApp } from '../src/app'
import { createMemoryStore } from '../src/store/memory-store'

/**
 * QA adversarial pass for .plan/025-2026-08-16-multi-environment-support.md.
 *
 * The plan's unit test (tests/lib/auth.test.ts) asserts what baseCookieOptions()
 * *returns*. This file asserts what the server actually *puts on the wire*, and
 * pins two claims the plan and .doc/deployment.md make but do not test:
 *
 *   1. The plan's Risks section claims local dev is "byte-for-byte unchanged" for
 *      "NODE_ENV unset or development". Only the 'development' half of that is true —
 *      this file pins the unset case as the regression it is.
 *   2. .doc/deployment.md / backend/.env*.example claim FRONTEND_URL must be
 *      scheme+host with no trailing slash. cors() does an exact string compare
 *      against the browser's Origin header, so a trailing slash silently fails CORS.
 */

const originalNodeEnv = process.env.NODE_ENV
const originalFrontendUrl = process.env.FRONTEND_URL

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

afterEach(() => {
  setEnv('NODE_ENV', originalNodeEnv)
  setEnv('FRONTEND_URL', originalFrontendUrl)
})

async function loginSetCookie(): Promise<string[]> {
  const store = createMemoryStore()
  const app = createApp(store)

  await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Jane', email: 'jane@example.com', password: 'correct-password-123', role: 'candidate' })

  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'jane@example.com', password: 'correct-password-123' })

  expect(response.status).toBe(200)
  const raw = response.headers['set-cookie']
  return Array.isArray(raw) ? raw : [raw as string]
}

describe('auth cookie attributes on the wire', () => {
  it("emits SameSite=Lax and no Secure when NODE_ENV is 'development'", async () => {
    setEnv('NODE_ENV', 'development')

    const cookies = await loginSetCookie()

    expect(cookies.length).toBeGreaterThan(0)
    for (const cookie of cookies) {
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).not.toContain('Secure')
      expect(cookie).toContain('HttpOnly')
    }
  })

  it("emits SameSite=None; Secure when NODE_ENV is 'production'", async () => {
    setEnv('NODE_ENV', 'production')

    const cookies = await loginSetCookie()

    for (const cookie of cookies) {
      expect(cookie).toContain('SameSite=None')
      expect(cookie).toContain('Secure')
    }
  })

  it("emits SameSite=None; Secure when NODE_ENV is 'staging'", async () => {
    setEnv('NODE_ENV', 'staging')

    const cookies = await loginSetCookie()

    for (const cookie of cookies) {
      expect(cookie).toContain('SameSite=None')
      expect(cookie).toContain('Secure')
    }
  })

  // QA finding F1 (.orchestrate/qa-report.md): baseCookieOptions() originally keyed only on
  // === 'development', so an unset NODE_ENV (true of this working tree's backend/.env) fell
  // into the cross-site branch over plain http://localhost. Fixed to treat unset as
  // development, matching the plan's Risks section and .doc/deployment.md. This test now
  // pins the fix on the wire.
  it('treats an unset NODE_ENV as development, not the cross-site cookie config', async () => {
    setEnv('NODE_ENV', undefined)

    const cookies = await loginSetCookie()

    for (const cookie of cookies) {
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).not.toContain('Secure')
    }
  })
})

describe('FRONTEND_URL / CORS origin contract', () => {
  const browserOrigin = 'https://ilana.github.io'

  async function corsAllowOriginFor(frontendUrl: string): Promise<string | undefined> {
    setEnv('FRONTEND_URL', frontendUrl)
    const app = createApp(createMemoryStore())

    const response = await request(app).get('/api/job').set('Origin', browserOrigin)

    return response.headers['access-control-allow-origin']
  }

  it('allows the origin when FRONTEND_URL matches it exactly', async () => {
    expect(await corsAllowOriginFor(browserOrigin)).toBe(browserOrigin)
  })

  it('silently fails CORS when FRONTEND_URL carries a trailing slash', async () => {
    // Proves .doc/deployment.md's "no trailing slash" callout is load-bearing:
    // the browser's Origin header never has one, and cors() compares exact strings.
    expect(await corsAllowOriginFor(`${browserOrigin}/`)).not.toBe(browserOrigin)
  })

  it('silently fails CORS when FRONTEND_URL includes the GitHub Pages project path', async () => {
    // The likeliest real mistake: pasting the full Pages URL
    // (https://<user>.github.io/ai-dev-agents/) instead of just the origin.
    expect(await corsAllowOriginFor(`${browserOrigin}/ai-dev-agents/`)).not.toBe(browserOrigin)
  })

  it('sets credentials:true so the cross-site auth cookie is accepted at all', async () => {
    setEnv('FRONTEND_URL', browserOrigin)
    const app = createApp(createMemoryStore())

    const response = await request(app).get('/api/job').set('Origin', browserOrigin)

    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })
})
