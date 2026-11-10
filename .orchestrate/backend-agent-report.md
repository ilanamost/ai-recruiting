# Backend agent report — plan 042 (AI-146)

Status: DONE (nothing committed)

## Result
CV upload no longer returns a 500 on a damaged PDF. An unreadable PDF returns 422 and creates no resume.

## Tests
- `cd backend && npm test`: 23 files, 433 tests, all pass.
- `npm run typecheck`: clean.
- Not reproduced: the original `bad XRef entry` failure (the reporter's file is not in the repo). The damaged-xref test uses a synthetic PDF and only requires text or a 422.
- Not checked: which of text or 422 `unpdf` returns for that synthetic file.
- Not done: before/after comparison of extracted text whitespace (plan risk mitigation).
- `tsx` and a temporary `tsc` build (deleted) both returned 422 on a bad PDF, so `import('unpdf')` loads under both.

## Changes
- `pdf-parse` replaced by `unpdf@^2.1.0` in `backend/package.json` and lockfile; `backend/src/types/pdf-parse.d.ts` removed (removal staged via `git rm --cached`).
- `backend/src/extraction/index.ts`: parser failures become `ValidationError` (422), message "Could not read this PDF. Please re-export it and try again."; logs error name and message only.
- `backend/src/lib/errors.ts`: `ValidationError` takes an optional `status` (default 400).
- `backend/src/routes/resume.ts`: unchanged; both `extractText` call sites already use try/catch with `next(error)` and run before any store write.
- `backend/tests/extraction.test.ts`: 8 tests (valid PDF, damaged xref, empty buffer, non-PDF bytes, no file contents in logs, POST 422 with no new resume, PUT 422 leaving resume unchanged, existing unsupported mime test).
- `.doc/architecture.md`, `.doc/backend-overview.md`: library name updated.
- `.orchestrate/api-contract.yaml`: added `POST /api/resume` and `PUT /api/resume/{id}/file` documenting the 422.

## Open
Plan step 6 (frontend shows the 422 message) is left for the frontend agent.

STATUS: DONE
