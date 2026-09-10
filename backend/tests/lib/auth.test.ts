import { afterEach, describe, expect, it } from 'vitest'
import {
  accessTokenCookieOptions,
  clearAccessTokenCookieOptions,
  clearRefreshTokenCookieOptions,
  refreshTokenCookieOptions
} from '../../src/lib/auth'

/**
 * Cookie attributes are the difference between "login works" and "login appears
 * to succeed but every later request looks logged-out", so both NODE_ENV
 * branches of baseCookieOptions() are pinned here. See
 * .plan/025-2026-08-16-multi-environment-support.md step 6.
 */

const originalNodeEnv = process.env.NODE_ENV

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env.NODE_ENV
    return
  }
  process.env.NODE_ENV = value
}

afterEach(() => {
  setNodeEnv(originalNodeEnv)
})

const allCookieOptions = [
  ['accessTokenCookieOptions', accessTokenCookieOptions],
  ['refreshTokenCookieOptions', refreshTokenCookieOptions],
  ['clearAccessTokenCookieOptions', clearAccessTokenCookieOptions],
  ['clearRefreshTokenCookieOptions', clearRefreshTokenCookieOptions]
] as const

describe('auth cookie options', () => {
  describe("when NODE_ENV is 'development' or unset", () => {
    for (const nodeEnv of ['development', undefined]) {
      it.each(allCookieOptions)(
        `%s keeps local dev on sameSite=lax and secure=false for NODE_ENV=${nodeEnv ?? '(unset)'}`,
        (_name, build) => {
          setNodeEnv(nodeEnv)

          expect(build()).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false })
        }
      )
    }
  })

  describe('when NODE_ENV is anything else', () => {
    for (const nodeEnv of ['staging', 'production', 'test']) {
      it.each(allCookieOptions)(
        `%s uses sameSite=none and secure=true for NODE_ENV=${nodeEnv ?? '(unset)'}`,
        (_name, build) => {
          setNodeEnv(nodeEnv)

          expect(build()).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true })
        }
      )
    }
  })

  it('keeps the paths and expiries each cookie was set with', () => {
    setNodeEnv('production')

    expect(accessTokenCookieOptions()).toMatchObject({ path: '/', maxAge: 15 * 60 * 1000 })
    expect(refreshTokenCookieOptions()).toMatchObject({ path: '/api/auth', maxAge: 30 * 24 * 60 * 60 * 1000 })
    // Clearing a cookie only works when path matches the path it was set with.
    expect(clearAccessTokenCookieOptions().path).toBe('/')
    expect(clearRefreshTokenCookieOptions().path).toBe('/api/auth')
  })
})
