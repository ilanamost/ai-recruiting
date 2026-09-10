// Reactive auth composable — mirrors lib/theme.ts's module-level reactive-state style so every
// caller (router guard, NavBar, LoginPage, SettingsPage) shares one source of truth for the
// signed-in user. Auth is cookie-based (httpOnly access_token/refresh_token, see
// .plan/008-2026-08-03-authentication-authorization.md) — there is no bearer token to store here.

import { computed, ref } from 'vue'
import { apiFetch, parseErrorResponse } from './http'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export type Role = 'admin' | 'recruiter' | 'candidate'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
  org_id: string
  has_profile_image: boolean
}

export interface UpdateProfileInput {
  name?: string
  email?: string
  /** Self-service role change — never 'admin' (that's only ever set directly in the database). */
  role?: 'recruiter' | 'candidate'
  new_password?: string
  current_password?: string
  profile_image?: File
  /** Clears the stored profile image. Ignored if `profile_image` is also set. */
  remove_profile_image?: boolean
}

const user = ref<AuthUser | null>(null)
const isLoading = ref(true)
// Bumped on every successful updateProfile. The image endpoint's URL is otherwise derived from
// the has_profile_image boolean alone, so *replacing* an already-set image produced the identical
// string before and after — Vue never re-touched the <img src> binding and the browser never
// re-fetched. Appending the counter makes the string actually change, which both re-triggers
// reactivity and busts the browser cache for that exact URL.
const profileImageVersion = ref(0)

const profileImageUrl = computed(() =>
  user.value?.has_profile_image ? `${API_URL}/api/auth/me/profile-image?v=${profileImageVersion.value}` : null
)

// The login/signup/logout/refresh endpoints manage the session itself, so they go through the
// plain fetch (not apiFetch's 401-retry loop, which only makes sense for already-authenticated
// requests hitting an expired access token).
async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  user.value = await response.json()
  return user.value as AuthUser
}

async function signup(name: string, email: string, password: string, role: 'recruiter' | 'candidate'): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, role })
  })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  user.value = await response.json()
  return user.value as AuthUser
}

async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
  } catch {
    // Best-effort: the client forgets its session even if the network request itself failed —
    // the caller (NavBar) redirects to /login regardless.
  } finally {
    user.value = null
    // QA finding, .plan/024: without this, a different user logging in the same browser
    // session could land on a profile-image URL (same path, same counter value) already cached
    // for the previous user. Resetting on logout removes that collision window entirely.
    profileImageVersion.value = 0
  }
}

// Memoizes the in-flight request so concurrent router-guard invocations (e.g. rapid navigation
// before the first fetchMe resolves) share one network call instead of racing.
let fetchMePromise: Promise<AuthUser | null> | null = null

async function fetchMe(): Promise<AuthUser | null> {
  if (fetchMePromise) {
    return fetchMePromise
  }
  fetchMePromise = (async () => {
    isLoading.value = true
    try {
      const response = await apiFetch(`${API_URL}/api/auth/me`)
      if (!response.ok) {
        user.value = null
        return null
      }
      user.value = await response.json()
      return user.value
    } finally {
      isLoading.value = false
    }
  })()
  try {
    return await fetchMePromise
  } finally {
    fetchMePromise = null
  }
}

async function updateProfile(input: UpdateProfileInput): Promise<AuthUser> {
  const formData = new FormData()
  if (input.name !== undefined) {
    formData.append('name', input.name)
  }
  if (input.email !== undefined) {
    formData.append('email', input.email)
  }
  if (input.role !== undefined) {
    formData.append('role', input.role)
  }
  if (input.new_password) {
    formData.append('new_password', input.new_password)
    if (input.current_password) {
      formData.append('current_password', input.current_password)
    }
  }
  if (input.profile_image) {
    formData.append('profile_image', input.profile_image)
  } else if (input.remove_profile_image) {
    formData.append('remove_profile_image', 'true')
  }

  const response = await apiFetch(`${API_URL}/api/auth/me`, { method: 'PATCH', body: formData })
  if (!response.ok) {
    return parseErrorResponse(response)
  }
  user.value = await response.json()
  profileImageVersion.value += 1
  return user.value as AuthUser
}

export function useAuth() {
  return { user, isLoading, profileImageUrl, login, signup, logout, fetchMe, updateProfile }
}
