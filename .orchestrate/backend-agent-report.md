# Backend Agent Report: 204 for "no match yet" (plan 041)

Branch: `fix/no-existing-match-state` (nothing committed). Status: DONE. Date: 2026-11-08.

Agent-reported results: `cd backend && npm test` 429 passed (23 files); `npx tsc --noEmit` clean; no lint script. QA must re-verify.

## Behavior
`GET /api/job/:jobId/resumes/:resumeId/match` answers `204 No Content` (empty body) when the pair is attached and viewable but has no match yet. Unchanged: 404 for an unknown job, an unattached pair or a missing resume; 403 for a candidate asking about another candidate's resume; 200 with the match when one exists.

## Changed files
- `backend/src/routes/job.ts`: the no-match branch does `res.status(204).end()` instead of throwing `NotFoundError`.
- `backend/tests/job-resume-match.test.ts`: the "404 when no match exists yet" test now expects 204 and an empty body; 3 new tests (204 for a candidate's own resume with no match, 403 for another candidate's resume with no match, 404 for an unknown resume on a known job); the `attachedResume` helper takes an optional `owner_user_id`.
- `.orchestrate/api-contract.yaml`: the route had no entry; added with 200, 204, 401, 403 and 404 responses and a `Match` schema (fields verified by the orchestrator against `frontend/src/types/index.ts`). Version left at 0.2.0.
- `.doc/backend-overview.md`: no longer describes "no match yet" as a 404; documents the 204.

## Rollout
Deploy the frontend first (it accepts `204` and the old `404`), then this backend change.
