# Plan: AI Recruiting Platform

Status: draft
Owner: Ilana
Last updated: 2026-07-29

## Goal
Build a platform where a candidate uploads a CV, the platform extracts and analyzes it, matches it
against a job description, and produces a numeric match score with a plain-language, resume-grounded
explanation.

## Scope
- In scope:
	- Job creation (title + description).
	- Candidate CV upload (PDF/DOCX) and text extraction.
	- LLM-based resume analysis and job matching, producing `{ score, explanation }` via a Claude API
	  structured-output call.
	- Persisting job/resume/match records (Postgres) and displaying the match result in a minimal UI.
- Out of scope (this plan):
	- Full ATS workflow (pipeline stages, interview scheduling, offers).
	- Candidate accounts/auth, candidate-facing score visibility.
	- Ranking or comparing multiple candidates against each other.
	- Billing/payment.

See `.doc/product-definition.md` for the full product scope and success metrics, and
`.doc/architecture.md` for the target component design this plan implements.

## Assumptions
- This is a full pivot of the repository's product. The
`.doc/product-definition.md`, `.doc/architecture.md`, and `.doc/glossary.md` files have already been
  rewritten for this product as of this plan (done — see their Change Logs).
- One job description is matched against many resumes far more often than the reverse — the scoring
  design optimizes for that access pattern (job description cached, resume text varies per call).
- A numeric 0–100 score plus a free-text explanation is the right v1 output shape (see Open Question 3).

## Open Questions
1. **Model choice for scoring: Claude Sonnet 5 vs. Claude Haiku 4.5?**
   Recommended: **Claude Sonnet 5** for the analysis + scoring + explanation call. Explanation quality is
   the product's core differentiator (see `.doc/product-definition.md`'s value proposition) and depends on
   nuanced reading of resume vs. job-description text — Haiku 4.5 is faster and cheaper but weaker at
   that kind of reasoning. If volume becomes a cost concern later, consider a two-tier pipeline: Haiku 4.5
   for cheap structured field extraction (name, skills list, years of experience) as a pre-processing
   step, Sonnet 5 for the actual match scoring and explanation. Do not default to Claude Opus 5 here —
   this is a repeated, moderate-complexity classification-and-explanation task, not the kind of
   long-horizon agentic work Opus-tier is for.

2. **File storage for uploaded resumes: local disk vs. object storage (e.g. S3-compatible)?**
   Recommended: local disk behind a narrow storage interface for this stage (mirrors the "zero external
   setup" value the prior scaffold had), with the interface designed so it can be swapped for S3-compatible
   storage without touching route handlers, once multi-instance deployment is needed.

3. **Output shape: score + explanation only, or also a structured breakdown (matched skills / missing
   skills / experience gap)?**
   Recommended: ship `{ score, explanation }` first (see `.doc/architecture.md`'s structured-output
   schema) and validate the core loop before adding structured breakdown fields — extending the JSON
   schema later is additive and low-risk once the pipeline is proven.

4. **Candidate identity on upload: fully anonymous, or name/email captured but unauthenticated?**
   Recommended: capture `name` + `email` as plain fields on `candidate` (client-supplied, not verified),
   consistent with `.doc/product-definition.md`'s assumption that this must be revisited before candidates
   see their own scores.

*(Answer inline or in a follow-up message; this plan will be updated accordingly before implementation
starts.)*

## Steps
1. **Docs and domain rename** — done as part of this plan: `.doc/product-definition.md`,
   `.doc/architecture.md`, `.doc/glossary.md` rewritten for the new domain.
2. **Backend scaffold** — new Express + TypeScript app; Postgres schema for `org`, `job`, `candidate`,
   `resume`, `match` per `.rule/database-rules.md`.
3. **Resume upload + extraction** — `POST /api/resume` with file-type/size validation
   (`.rule/security-rules.md`), `extraction.extractText` for PDF/DOCX.
4. **Job routes** — `POST /api/job`, `GET /api/job/:id`.
5. **Scoring module** — Claude API integration: system block (instructions + job description, cached),
   user turn (resume text), `output_config.format` json_schema for `{ score, explanation }`. Server-side
   validation that `score` is 0–100.
6. **Match route** — `POST /api/match`, `GET /api/match/:id`; persists and returns the result.
7. **Frontend** — `JobForm`, `ResumeUpload`, `MatchResult` components wired into one flow.
9. **Tests** — per `.rule/testing-rules.md`: unit tests for extraction and scoring-schema validation,
   integration tests for each route (happy path + validation failures), a regression test asserting the
   Claude response always parses against the schema (mock the API call in tests — never hit the live API
   from the test suite).

## Validation
- `npm test` passes in both `backend/` and `frontend/` (vitest + supertest / testing-library).
- `npm run typecheck` passes in both packages.
- Manual smoke test: create a job, upload a sample resume, confirm a `match` is returned with a score in
  0–100 and a non-empty explanation referencing resume content.
- Confirm `.orchestration/api-contract.yaml` is updated to reflect the new routes before or alongside
  implementation (per `.doc/product-definition.md`'s prioritization rule to keep contract and tests in
  lockstep).

## Risks
- **PII exposure**: resumes and job descriptions are personal/business-sensitive data. Mitigate via
  `.rule/security-rules.md` — least data collected, no resume/JD text in logs, org-scoped queries.
- **Hallucinated or inconsistent scores**: LLM output can vary run-to-run. Mitigate with a fixed,
  cached system prompt, structured output (schema-constrained), and server-side score-range validation;
  monitor for drift once in use.
- **Cost at scale**: many resumes against one job can generate significant token spend without caching.
  Mitigate via the prompt-caching layout in `.doc/architecture.md` (job description cached, resume text
  varies) and, if volume grows, the Batch API for non-interactive bulk screening.
- **File upload risk**: malicious or malformed uploads. Mitigate via strict type/size validation before
  extraction, per `.rule/security-rules.md`.

## Rollout Order
1. Docs (done).
2. Approval to retire the WhatsApp scaffold.
3. Backend: schema → resume upload/extraction → job routes → scoring module → match route.
4. Frontend: job form → resume upload → match result display.
5. Tests alongside each backend step, not after all steps.

## Rollback
- Each step lands on a dedicated branch per `.rule/versioning-rules.md` (`feat/<topic>`); nothing merges
  to main without explicit approval, so rollback is "don't merge" at every stage before that point.
- Retiring the WhatsApp scaffold (step 2) is the one irreversible-feeling step — it will be done via a
  git commit on a branch, not an in-place delete outside version control, so `git revert` recovers the
  prior scaffold if needed even after merge.