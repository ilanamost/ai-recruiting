# 042 — CV upload fails with 500 "bad XRef entry"

Status: done
Owner: Orchestrator
Last updated: 2026-11-10

Task: backlog item "When trying to upload a CV in the real, not mock version, I get 500
Internal server error … FormatError: bad XRef entry" (`stack:full`).

## Goal
Uploading a valid PDF CV against the real (non-mock) backend succeeds. A PDF that cannot
be parsed returns a user-safe 4xx validation error instead of a 500.

## Scope
In scope (`backend/` only — no frontend change expected):
- `backend/src/extraction/index.ts` — PDF text extraction (the only module touching file bytes).
- `backend/package.json` — swap or upgrade the PDF parsing dependency.
- `backend/src/routes/resume.ts` — the two `extractText` call sites (create + replace) map
  extraction failures to the standard error shape.
- `backend/tests/extraction.test.ts` — new tests with real PDF fixtures.
- `.doc/architecture.md` — note the extraction library if it names one.

Out of scope: DOCX/other formats (removed in plan 030), analysis and scoring logic,
frontend UI. The frontend only gets a new toast if its existing error handling does not
already surface a 4xx message (verify, do not assume).

## Assumptions
- Root cause: `pdf-parse@1.1.1` bundles pdf.js v1.10 (2017), which throws
  `FormatError: bad XRef entry` on PDFs with damaged/non-standard cross-reference tables
  that browsers and current readers open fine. Not yet reproduced; step 1 confirms it.
- The stack trace is `webpack:///src/shared/util.js` from the bundled pdf.js, so the error
  originates in the backend, not the browser.
- The mock mode (`LLM_MODE=mock`) still runs extraction, so "real vs mock" in the report
  probably refers to a different CV file or environment rather than a code path. Step 1
  checks this.
- The failing CV file is not in the repo; the reporter's file may be unavailable.

## Open Questions
1. **Which fix?**
   a. Replace `pdf-parse` with `unpdf` (maintained, current pdf.js, Node-friendly).
   b. Keep `pdf-parse`, point it at a newer `pdfjs-dist` build.
   c. Keep the library, only convert the failure into a 422 "could not read this PDF".
   **Recommended: (a) plus the 422 mapping from (c)** — fixes the root cause and still
   handles genuinely corrupt files.
2. **Can you share the failing PDF?** If yes, drop it in `.orchestrate/fixtures/` (git-ignored)
   so QA can use it. **Recommended: yes if possible**; otherwise we build a fixture with a
   deliberately broken xref table.
3. **Status code for unreadable PDFs?** **Recommended: 422** with the standard error shape
   (`error-handling` skill), message "Could not read this PDF. Please re-export it and try again."

## Steps
1. Reproduce: write a failing test in `backend/tests/extraction.test.ts` using a PDF with a
   corrupted xref table (generated in the test, or the fixture from question 2).
2. Apply the chosen library change in `backend/package.json` and
   `backend/src/extraction/index.ts`; keep the `extractText(buffer, mimeType)` signature.
3. Wrap parser failures in a `ValidationError` (422) inside `extractText` so routes need no
   parser-specific handling; log the original error server-side without file contents.
4. Confirm both `extractText` call sites in `backend/src/routes/resume.ts` return the
   standard error shape; adjust only if they bypass the error middleware.
5. Add tests: valid PDF extracts text; damaged-xref PDF extracts or returns 422 (never 500);
   non-PDF and empty buffer return 4xx; the route returns 422 and creates no `resume` row.
6. Check the frontend resume upload shows the 422 message (read-only check of the upload
   store/component). Add a message constant to the toast-constants util only if missing.
7. Update `.doc/architecture.md` if it names the PDF library.

## Validation
- [ ] `cd backend && npm test` passes, including the new extraction tests.
- [ ] `cd backend && npm run typecheck` passes.
- [ ] Test: a PDF with a corrupt xref table no longer produces a 500 (extracts text or 422).
- [ ] Test: POST to the resume upload route with an unreadable PDF returns 422 in the
      standard error shape and does not persist a `resume`.
- [ ] Test: a normal PDF still uploads and returns extracted/analysed fields unchanged.
- [ ] Test: non-PDF mime type still rejected as before (`qa-docx-removal` suite unchanged).
- [ ] `cd frontend && npm test` and `npm run lint` still pass; no new frontend code unless step 6 needed it.
- [ ] No secrets, no new `docs/` directory, no trailing semicolons in changed JS/TS files.

## Risks
- The new library may change extracted text whitespace and so shift analysis results
  slightly. Mitigation: compare output on a sample PDF before and after.
- `unpdf` is ESM-oriented while the backend is `"type": "commonjs"`. Mitigation: dynamic
  `import()` as already used today; verify under both `tsx` and the `tsc` build.
- A truly corrupt file can still fail; handled by the 422 mapping.
- The reporter's PDF may not reproduce with a synthetic fixture. Mitigation: question 2.

## Rollout Order
1. Backend fix and tests (backend agent).
2. Frontend check/message only if needed (frontend agent).
3. QA validation, then human approval in Linear.

## Rollback
Revert the commit on `fix/cv-upload-xref-error`; restore `pdf-parse` in
`backend/package.json` and re-run `npm install`. No schema or data migration is involved.
