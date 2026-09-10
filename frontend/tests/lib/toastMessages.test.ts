import { describe, expect, it } from 'vitest'
import { TOAST } from '../../src/lib/toastMessages'

// .plan/026-2026-08-17-toast-message-constants.md: relocation, not a rewrite. The copy has to stay
// byte-identical to what shipped before, so these assertions pin the visible text — an accidental
// edit to a constant is a user-visible copy change and should fail here first.

describe('TOAST module shape', () => {
  it('groups copy by toast type, mirroring toast.<type>(...)', () => {
    expect(Object.keys(TOAST).sort()).toEqual(['error', 'info', 'success'])
  })

  it('reserves info as an empty group, since no info-style toast exists yet', () => {
    expect(TOAST.info).toEqual({})
    expect(Object.keys(TOAST.info)).toHaveLength(0)
  })

  it('exposes every success and error constant the call sites reference', () => {
    expect(Object.keys(TOAST.success)).toHaveLength(14)
    expect(Object.keys(TOAST.error)).toHaveLength(16)
  })

  it('keeps keys unique across the flattened success and error groups', () => {
    const keys = [...Object.keys(TOAST.success), ...Object.keys(TOAST.error)]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has no empty or whitespace-only copy in any group', () => {
    const values = [...Object.values(TOAST.success), ...Object.values(TOAST.error)] as string[]
    for (const value of values) {
      expect(value.trim()).not.toBe('')
    }
  })
})

describe('TOAST copy is byte-identical to the pre-relocation literals', () => {
  it('pins the success copy', () => {
    expect(TOAST.success.jobCreated).toBe('Job created successfully')
    expect(TOAST.success.jobUpdated).toBe('Job updated')
    expect(TOAST.success.resumeAttached).toBe('CV attached')
    expect(TOAST.success.settingsUpdated).toBe('Settings updated')
    expect(TOAST.success.authAccountCreated).toBe('Account created')
  })

  it('pins the error copy', () => {
    expect(TOAST.error.jobValidationRequired).toBe('Title and description are required')
    expect(TOAST.error.resumeValidationRequired).toBe('Name and email are required')
    expect(TOAST.error.resumeAttachFailed).toBe('Failed to attach CV')
    expect(TOAST.error.matchLookupFailed).toBe('Failed to look up an existing match')
    expect(TOAST.error.settingsImageRemoveFailed).toBe('Failed to remove profile image')
  })

  it('keeps the product-facing "CV" wording even though the keys say resume', () => {
    // .doc/glossary.md: `resume` in code, "CV" in copy — both halves matter here.
    expect(TOAST.success.resumeUploaded).toBe('CV uploaded')
    expect(TOAST.error.resumeFileRequired).toBe('A CV file is required')
  })
})

describe('no call site passes a hardcoded string to toast.success / toast.error', () => {
  // The failure this plan exists to prevent: a call site (or a future one) keeping its copy inline
  // instead of referencing TOAST. Reading each source as text catches a stray literal that a
  // behavioral test cannot, because a literal renders identically to the constant it should be.
  const sources = [
    '../../src/components/JobForm.vue',
    '../../src/components/JobCvsModal.vue',
    '../../src/pages/JobsListPage.vue',
    '../../src/pages/CvsListPage.vue',
    '../../src/pages/SettingsPage.vue',
    '../../src/pages/LoginPage.vue'
  ]

  it.each(sources)('%s references TOAST for every toast argument', async (path) => {
    const source = (await import(/* @vite-ignore */ `${path}?raw`)).default as string

    // Every `toast.success(` / `toast.error(` argument list, up to the end of that line.
    const calls = source.match(/toast\.(?:success|error)\([^\n]*/g) ?? []
    expect(calls.length).toBeGreaterThan(0)

    for (const call of calls) {
      expect(call).toContain('TOAST.')
      // A quoted argument would mean copy still authored at the call site. The only quotes left on
      // these lines belong to call options like `{ toasterId: 'center' }`, which the plan keeps.
      const argument = call.slice(call.indexOf('(') + 1).split(', {')[0]
      expect(argument).not.toMatch(/['"`]/)
    }
  })
})
