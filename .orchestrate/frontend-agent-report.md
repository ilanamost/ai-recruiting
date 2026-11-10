# Frontend agent report — plan 042 step 6 (AI-145)

Status: DONE — check only, no files changed, nothing committed.

## Finding
The backend's 422 message "Could not read this PDF. Please re-export it and try again." is surfaced to the user as a toast on both upload and replace.

## Path traced
- `frontend/src/lib/http.ts`: `parseErrorResponse` reads `body.error.message` and throws `ApiError(code, message)`; the 422 is not swallowed.
- `frontend/src/stores/resume.ts`: `uploadResume` and `replaceResumeFile` let the rejection propagate to the component.
- `frontend/src/pages/CvsListPage.vue`: `submitUpload` and `onReplaceFileChange` call `toast.error(err.message)`, falling back to `TOAST.error.resumeUploadFailed` / `resumeFileReplaceFailed` from `frontend/src/lib/toastMessages.ts`. The form stays open and the existing file stays in place.
- `JobCvsModal.vue` has no upload or replace call.

## Checks
- `npm test`: 877 passed, 10 failed. All 10 are in `frontend/tests/ui-polish.adversarial.test.ts` (reduced-motion and scrollbar stylesheet assertions). Not verified against a clean tree by the agent; `git status` shows no frontend changes on this branch.
- `npx vue-tsc --noEmit`: clean.
- `npm run lint`: not run — `frontend/package.json` has no `lint` script.

STATUS: DONE
