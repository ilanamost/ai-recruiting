# Frontend Agent Report: "no match yet" state (plan 041)

Branch: `fix/no-existing-match-state` (nothing committed). Status: DONE. Date: 2026-11-08.

Agent-reported results: `npx vitest run` 912 passed (55 files); `npx vue-tsc --noEmit` clean; no lint script. QA must re-verify.

## Changes
- `frontend/src/lib/api.ts` `getMatchForPair`: resolves `null` on `204` and on `404` (old backend, rollout tolerance); returns the match on `200`; rejects with `ApiError` on any other non-ok status. `response.json()` is never called on a `204`. A comment records that "no match yet" is a state, not an error.
- `frontend/src/components/JobCvsModal.vue`: comment only (`null` means "no match yet": the pair is scored, nothing is toasted or logged). No behavior change was needed.
- `frontend/tests/api.test.ts`: 4 new cases (204 -> null without calling `json()`, 404 -> null, 200 -> match, 500 -> `ApiError`).
- `frontend/tests/JobCvsModal.test.ts`: new case, opening a CV with no match calls `createMatch({ resume_id, job_id })` with no toast and no `console.error`/`console.warn`. The modal test mocks the api module, so `POST /api/match` is checked through `createMatch`, not a real fetch.
- The existing "surfaces a failed match lookup as a toast" test covers a failed lookup still toasting (it rejects with a plain `Error`, not a 500 `ApiError`; left as is).

## Rollout
Deploy the frontend before the backend: the frontend accepts both `204` and `404`; an old frontend would fail on a `204` body.

## Not verified
- Real browser: no red console line and a `204` in the Network tab (jsdom cannot show DevTools).
