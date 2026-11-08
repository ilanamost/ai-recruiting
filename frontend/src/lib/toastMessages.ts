// Every toast copy string in the app, per .plan/026-2026-08-17-toast-message-constants.md.
// Grouped by toast type first (mirroring `toast.<type>(...)` at the call site), with a domain
// prefix on each key so names stay unique and traceable across the flattened groups.
//
// `info` is intentionally empty: no `toast.info(...)` / `toast.message(...)` call site exists
// today, but the slot is reserved so the first future info-style toast has an obvious home
// instead of prompting a restructure.
export const TOAST = {
  success: {
    jobCreated: 'Job created successfully',
    jobUpdated: 'Job updated',
    jobDeleted: 'Job deleted',
    jobDuplicated: 'Job duplicated',
    resumeUpdated: 'CV updated',
    resumeDeleted: 'CV deleted',
    resumeFileReplaced: 'CV file replaced',
    resumeUploaded: 'CV uploaded',
    resumeAttached: 'CV attached',
    resumeDetached: 'CV detached',
    settingsImageRemoved: 'Profile image removed',
    settingsUpdated: 'Settings updated',
    authLoggedIn: 'Logged in',
    authAccountCreated: 'Account created'
  },
  error: {
    jobValidationRequired: 'Title and description are required',
    jobCreateFailed: 'Failed to create job',
    jobUpdateFailed: 'Failed to update job',
    jobDeleteFailed: 'Failed to delete job',
    jobDuplicateFailed: 'Failed to duplicate job',
    resumeValidationRequired: 'Name and email are required',
    resumeFileRequired: 'A CV file is required',
    resumeUpdateFailed: 'Failed to update CV',
    resumeDeleteFailed: 'Failed to delete CV',
    resumeFileReplaceFailed: 'Failed to replace CV file',
    resumeUploadFailed: 'Failed to upload CV',
    resumeAttachFailed: 'Failed to attach CV',
    resumeDetachFailed: 'Failed to detach CV',
    resumeDownloadFailed: 'Failed to download CV',
    matchLoadFailed: 'Failed to load match scores',
    matchLookupFailed: 'Failed to look up an existing match',
    settingsImageRemoveFailed: 'Failed to remove profile image'
  },
  info: {}
} as const

// Shown when the API cannot be reached at all (server down, offline) - lib/http.ts turns the
// browser's bare "Failed to fetch" into an ApiError carrying this, so every caller shows it.
export const SERVER_UNREACHABLE_MESSAGE =
  "Can't reach the server right now. Check your connection or try again in a moment."
export const NETWORK_ERROR_CODE = 'network_error'
