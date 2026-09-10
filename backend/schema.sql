-- Standalone bootstrap script for the AI Recruiting Platform.
-- Run against an empty Postgres database to create all tables, indexes, and
-- seed data needed for local development. See .rule/database-rules.md.

create extension if not exists pgcrypto;

create table if not exists org (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists job (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references org(id),
  title text not null,
  description text not null,
  location text null,
  created_at timestamptz not null default now()
);

-- Free-text posting location, per .plan/013-2026-08-10-job-search-filter.md.
-- Null means "not set" — the field is optional on create/update, and a job
-- card simply omits the location line when it's null. `create table if not
-- exists` above won't retroactively add this column to an already-running
-- database, so this is also applied as a standalone `alter table` directly
-- against any such database, per .rule/database-rules.md.
alter table if exists job add column if not exists location text;

create index if not exists job_org_id_idx on job(org_id);

create table if not exists candidate (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists resume (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidate(id),
  file_name text not null,
  mime_type text not null,
  content text not null,
  file_data bytea not null,
  years_experience integer null,
  created_at timestamptz not null default now()
);

create index if not exists resume_candidate_id_idx on resume(candidate_id);

-- Years of industry experience read off the CV by the analysis step, per
-- .plan/029-2026-09-07-cv-recruiter-filter.md. Null means "unclassified", NOT
-- zero: a CV with no dated work history, one uploaded before analysis existed,
-- or one whose analysis call failed all stay null rather than being labelled a
-- junior. The Junior/Mid/Senior band is deliberately NOT a column — it is a
-- presentation rule over this number, so re-tuning the boundaries stays a
-- frontend change instead of a data migration. `create table if not exists`
-- above won't retroactively add this column to an already-running database, so
-- this is also applied as a standalone `alter table` directly against any such
-- database, per .rule/database-rules.md.
alter table if exists resume add column if not exists years_experience integer;

-- Skills read off the CV by the analysis step, one row per (resume, skill),
-- per .plan/029-2026-09-07-cv-recruiter-filter.md. Values are stored already
-- normalized (trimmed, lowercased, de-duplicated, at most 50 characters each
-- and 30 per CV) so an exact-match filter needs no normalization at read time;
-- the composite primary key makes the de-duplication a database guarantee too.
-- No rows for a resume means "no skills" — the read path coalesces that to an
-- empty array, never null.
create table if not exists resume_skill (
  resume_id uuid not null references resume(id) on delete cascade,
  skill text not null,
  primary key (resume_id, skill)
);

-- Supports the union-of-skills read the modal's skill picker is built from.
create index if not exists resume_skill_skill_idx on resume_skill(skill);

-- Many-to-many: a resume can be attached to more than one job, and a job can
-- have many resumes attached. Replaces the old resume.job_id column.
create table if not exists job_resume (
  job_id uuid not null references job(id) on delete cascade,
  resume_id uuid not null references resume(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, resume_id)
);

create index if not exists job_resume_resume_id_idx on job_resume(resume_id);

create table if not exists match (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null references resume(id) on delete cascade,
  job_id uuid not null references job(id) on delete cascade,
  score integer not null check (score >= 0 and score <= 100),
  explanation text not null,
  created_at timestamptz not null default now()
);

create index if not exists match_job_id_idx on match(job_id);
create index if not exists match_resume_id_idx on match(resume_id);

-- Idempotent seed org for local development.
insert into org (id, name)
values ('demo-org', 'Demo Org')
on conflict (id) do nothing;

-- Login identity + role (admin/recruiter/candidate), separate from `candidate`
-- (the anonymous resume-owner metadata captured at upload time) — see
-- .plan/008-2026-08-03-authentication-authorization.md Open Question 4.
create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references org(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'recruiter', 'candidate')),
  profile_image bytea null,
  profile_image_mime text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_user_org_id_idx on app_user(org_id);

-- Owning app_user (Candidate role) for edit/replace/delete/attach/detach
-- scoping, per .plan/009-2026-08-08-candidate-cv-ownership-scoping.md. Null
-- means "no candidate owns this" (Admin upload, or uploaded before this
-- column existed) — only Admin can manage such a resume. `create table if
-- not exists` above won't retroactively add this column to an already-running
-- database, so this is also applied as a standalone `alter table` directly
-- against any such database, per .rule/database-rules.md.
alter table if exists resume add column if not exists owner_user_id uuid references app_user(id);

-- Opaque rotating refresh tokens, stored only as a SHA-256 hash (never the
-- raw token value). One row per issued refresh token; rotated (old row
-- revoked, new row inserted) on every /api/auth/refresh call.
create table if not exists refresh_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists refresh_token_user_id_idx on refresh_token(user_id);
