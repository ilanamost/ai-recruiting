import { randomUUID } from 'crypto'
import { accessTokenCookieName, hashPassword, signAccessToken } from '../../src/lib/auth'
import type { Role, Store } from '../../src/store/types'

/**
 * Creates an app_user row for the given role and returns a `Cookie` header
 * value carrying a valid access_token for it — the shortcut every
 * route-level test in this suite uses to authenticate a supertest request,
 * instead of going through a real POST /api/auth/login round trip every time.
 */
export async function createAuthedUser(
  store: Store,
  role: Role,
  overrides: Partial<{ name: string; email: string; org_id: string; password: string }> = {}
) {
  const password = overrides.password ?? 'correct-password-123'
  const user = await store.createUser({
    org_id: overrides.org_id ?? 'demo-org',
    name: overrides.name ?? 'Test User',
    email: overrides.email ?? `${role}-${randomUUID()}@example.com`,
    password_hash: await hashPassword(password),
    role
  })
  const token = signAccessToken({ id: user.id, role: user.role, orgId: user.org_id })
  return { user, password, cookie: `${accessTokenCookieName()}=${token}` }
}
