=== QA REPORT ===
Ticket: AI-147 (plan 042, CV upload "bad XRef entry" 500)
Scope: full stack (backend fix; frontend read-only check)

Static:      backend tsc PASS (clean) · frontend vue-tsc PASS (exit 0) · lint N/A (no lint script in frontend/package.json)
Unit:        backend 433 passed (23 files) + 25 new adversarial = all pass; frontend 877 passed, 10 failed (pre-existing, see below)
E2E:         not run (no Playwright in scope for this backend change; frontend e2e unaffected by an unchanged frontend tree)
Backend:     PASS

Checklist (plan Validation section)
- backend `npm test` passes incl. new extraction tests — PASS (433/433, then 25/25 in the new file)
- backend `npm run typecheck` — PASS
- Corrupt-xref PDF no longer a 500 — PASS. Probe: missing/bad startxref and bad xref entries now extract "Hello" (unpdf recovers); truncated file -> ValidationError 422. 10 damaged variants in the adversarial file all yield text or 422.
- POST unreadable PDF -> 422 standard shape, no resume persisted — PASS (extraction.test.ts; adversarial: zero bytes, header-only, garbage, NULs all 4xx with error body, resume count unchanged)
- Normal PDF still uploads and analyses — PASS (multi-page PDF -> 201, years_experience/skills from analysis, all pages' text present; real fixture .orchestrate/fixtures/Ilana_Mostovski_Resume.pdf extracts >100 chars). Analysis throwing on a good PDF -> still 201 (unclassified).
- Non-PDF mime still rejected — PASS (docx/text/png/octet-stream -> 400, no row; qa-docx-removal suite unchanged and green)
- frontend `npm test` / lint — PARTIAL: 877 pass, 10 fail (ui-polish.adversarial); lint script does not exist
- No secrets / docs dir / trailing semicolons — PASS for changed JS/TS (new test file has none); no docs/ created

Adversarial coverage (backend/tests/qa-pdf-extraction.adversarial.test.ts, 25 tests, all pass)
- valid 3-page PDF; no xref + bad startxref; bad startxref; bad xref offsets; truncated 60%; header-only; zero bytes; all-NUL; random binary; header+garbage; junk prefix before valid PDF; 4 MB damaged buffer (no hang)
- Route: oversize >5 MB -> 4xx, no row; 10 parallel bad uploads -> all 422, no rows; error body has no XRef/pdf.js/stack text; PUT bad file -> not 5xx, resume content unchanged, PUT good file -> 200 with new content; unauthenticated -> 401, no row.

Pre-existing frontend failures
- All 10 failures are in frontend/tests/ui-polish.adversarial.test.ts (reduced-motion / scrollbar stylesheet assertions, e.g. line 443 regex on CSS now split into SCSS partials `@use './basics'`, consistent with plan 027). `git status --short frontend` and `git diff --stat master -- frontend` are both empty: the frontend tree is identical to the branch base, so these cannot be caused by this change. Not re-run on a separate master worktree (would need a fresh npm install), but identical-tree evidence is conclusive.

No pdf-parse remnants in code/lockfile
- backend/package-lock.json: 0 occurrences of pdf-parse; unpdf@2.1.0 resolved with integrity hash; `npm ls` shows only unpdf; `npm ci --dry-run` succeeds. package.json lists unpdf ^2.1.0 only.
- Stale references (non-functional, FYI): comments in backend/tests/authorization.test.ts:7 and backend/tests/qa-docx-removal.adversarial.test.ts:13 still mention pdf-parse; git-ignored backend/build/extraction/index.js is an old compiled artifact still requiring pdf-parse (rebuild before any deploy from that dir).

Findings
- Low: backend/tests/authorization.test.ts:7 and qa-docx-removal.adversarial.test.ts:13 — comments say pdf-parse; should say unpdf (test files, not feature source).
- Low: .orchestrate/fixtures/Ilana_Mostovski_Resume.pdf is untracked but NOT git-ignored (plan said fixtures dir is git-ignored); contains a real person's CV. Do not commit; add to .gitignore. My adversarial test reads it only if present.
- Info: the damaged-xref unit test accepts either text or 422; actual behavior is text recovery for xref damage and 422 only for truncation/garbage/empty.
- Info: original reporter failure still not reproduced with their file; plan's whitespace before/after comparison not done.
- Info: log lines "Warning: Indexing all PDF objects" are emitted by pdf.js on recovery; harmless noise.

Unverified
- Real (non-mock, live LLM) analysis end-to-end; the reporter's actual PDF; Playwright e2e; frontend toast shown in browser (frontend report traces code path only; I did not independently render it); password-encrypted PDFs.

Overall: feature PASSES. New files by QA: backend/tests/qa-pdf-extraction.adversarial.test.ts. No feature source modified, nothing committed.

STATUS: DONE
