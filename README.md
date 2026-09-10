# AI Recruiting Platform

A candidate uploads a CV; the platform extracts and analyzes it, matches it against a job
description, and returns a numeric match score with a plain-language, resume-grounded
explanation. Built on reusable AI-project scaffolding — rules, docs, and planning conventions
that agents (and humans) follow, wired together from [AGENTS.md](AGENTS.md).

See [.doc/product-definition.md](.doc/product-definition.md) for the product vision and scope, and
[.plan/002-2026-07-29-ai-recruiting-platform.md](.plan/002-2026-07-29-ai-recruiting-platform.md) for
the implementation plan.

## Run it

Two terminals, from the repo root:

```bash
cd backend  && npm install && npm run dev    # http://localhost:3001
cd frontend && npm install && npm run dev    # http://localhost:5173
```

The backend needs a `.env` file (copy the variables below into `backend/.env` — never commit it):

| Variable | Purpose |
|---|---|
| `PORT` | Port the backend listens on (default `3001`) |
| `FRONTEND_URL` | Allowed CORS origin (default `http://localhost:5173`) |
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://postgres:<password>@localhost:5432/recruiting_platform` |
| `ANTHROPIC_API_KEY` | Anthropic API key used for resume analysis and match scoring |
| `SCORING_MODEL` | Claude model id for scoring (default `claude-sonnet-5`) |

### Load the database schema

Run `backend/schema.sql` once against an empty database to create the tables and seed the demo org:

```bash
psql "$DATABASE_URL" -f backend/schema.sql
```

On Windows, if `psql` isn't on your `PATH` (open a new terminal after installing PostgreSQL so the
installer's `PATH` change takes effect — if it's still not found, call the executable directly):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres:<password>@localhost:5432/recruiting_platform" -f "C:\path\to\ai-dev-agents\backend\schema.sql"
```

Open http://localhost:5173, create a job, upload a candidate resume (PDF or DOCX), and see the
match score and explanation.

## Test it

```bash
cd backend  && npm test                     # API tests (vitest + supertest, mocked Anthropic calls)
cd frontend && npm test                     # component tests (vitest + @vue/test-utils)
```

`npm run typecheck` works in both packages.

## Layout

| Folder | Purpose |
|---|---|
| [backend/](backend/) | Express + TypeScript server: resume extraction, Postgres store, Claude API scoring |
| [frontend/](frontend/) | Vue 3 + Vite + TypeScript + Tailwind client |
| [.orchestration/](.orchestration/) | [api-contract.yaml](.orchestration/api-contract.yaml) — the source of truth for REST endpoints |
| [.agents/](.agents/) | Specialist agent roles — orchestrator, frontend, backend, QA — each with its own `AGENT.md` |
| [.claude/](.claude/) | Guardrails: permissions in [settings.json](.claude/settings.json) and enforcement hooks in [.claude/hooks/](.claude/hooks/) |
| [.rule/](.rule/) | Required conventions agents must follow — coding, naming, security, testing, error handling, versioning, UI/style |
| [.doc/](.doc/) | Living reference docs — architecture, glossary, product definition |
| [.plan/](.plan/) | Backlog and task planning |

## .rule

| File | Covers |
|---|---|
| [coding-rules.md](.rule/coding-rules.md) | JS/TS coding conventions |
| [naming-rules.md](.rule/naming-rules.md) | Naming conventions |
| [database-rules.md](.rule/database-rules.md) | Schema, migrations, bootstrap |
| [error-handling-rules.md](.rule/error-handling-rules.md) | Error shapes, logging, status codes |
| [security-rules.md](.rule/security-rules.md) | Secrets, auth, input validation, dependencies |
| [testing-rules.md](.rule/testing-rules.md) | Test coverage and design expectations |
| [planning-rules.md](.rule/planning-rules.md) | Planning approach before implementation |
| [versioning-rules.md](.rule/versioning-rules.md) | Versioning and release conventions |
| [ui-rules.md](.rule/ui-rules.md) | UI-specific guidance |
| [style-rules.md](.rule/style-rules.md) | CSS and styling conventions |

Rule files may cross-reference each other using `[[name]]` links.

## .doc

| File | Covers |
|---|---|
| [architecture.md](.doc/architecture.md) | Service boundaries, ownership, data flow, scoring pipeline |
| [glossary.md](.doc/glossary.md) | Canonical domain terms used across code, API, docs, and plans |
| [product-definition.md](.doc/product-definition.md) | Product vision, target users, scope, success metrics |

## .plan

| File | Covers |
|---|---|
| [000-backlog.md](.plan/000-backlog.md) | Prioritized backlog of current and completed tasks |
| [001-2026-07-27-scaffold.md](.plan/001-2026-07-27-scaffold.md) | Scaffolding plan for a prior demo project (superseded) |
| [002-2026-07-29-ai-recruiting-platform.md](.plan/002-2026-07-29-ai-recruiting-platform.md) | Implementation plan for the AI Recruiting Platform |

## How it fits together

[AGENTS.md](AGENTS.md) is the entry point: it tells agents which `.rule` file governs each area of work, and where to find `.doc` references and `.plan` backlog state. Update the relevant file when its underlying convention or reference changes — see each file's own update triggers.
