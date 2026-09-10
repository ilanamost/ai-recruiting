Status: done
Owner: Ilana
Last updated: 2026-09-08

## Goal
CVs in the application are PDF-only. Remove every DOCX-specific code path — upload
acceptance, text extraction, HTML preview generation/rendering, UI copy and file-picker
filters, and their tests — plus the `mammoth` and `sanitize-html` libraries that exist only
to serve DOCX. Uploading a `.docx` file is rejected the same way an unsupported type is
today; only `.pdf` is accepted.

## Scope
In scope:
- `backend/src/extraction/index.ts`: drop the DOCX branch from `extractText`, drop
  `convertToPreviewHtml` entirely, drop the `DOCX_MIME_TYPE` export, and narrow
  `SUPPORTED_MIME_TYPES` to `['application/pdf']`. `PREVIEW_ALLOWED_TAGS`/
  `PREVIEW_ALLOWED_ATTRIBUTES` and the `sanitize-html` import go with it — that module is
  `convertToPreviewHtml`'s only caller.
- `backend/src/routes/resume.ts`: remove the `GET /:id/html` route and its `DOCX_MIME_TYPE`
  import; update both "file must be a PDF or DOCX document" validation messages to "file
  must be a PDF document".
- `backend/package.json`: remove the `mammoth` dependency. Remove `sanitize-html` and
  `@types/sanitize-html` too, once confirmed (per the grep already done) that
  `extraction/index.ts` is their only consumer.
- Backend tests:
  - Delete `backend/tests/resume-html.test.ts` (covers the removed route) in full.
  - `backend/tests/resume.test.ts` and `backend/tests/authorization.test.ts`: replace any
    DOCX upload/replace case with an equivalent PDF case, and add one case asserting a
    `.docx` upload now gets the "file must be a PDF document" `ValidationError`.
  - `backend/tests/resume.test.ts`, `authorization.test.ts`, `resume-analysis.test.ts`,
    `qa-analysis-degradation.adversarial.test.ts`, `pagination-adversarial.test.ts`: shrink
    each mocked `SUPPORTED_MIME_TYPES` array down to the single PDF entry so the test double
    matches the real module.
- `frontend/src/components/JobCvsModal.vue`: collapse the two-branch preview
  (`v-if="previewResume.mime_type === 'application/pdf'"` / DOCX-HTML `v-else`) down to the
  single PDF iframe branch. Remove `previewHtml`, the `getResumeHtmlPreview` call and its
  branch in `loadPreviewExtras`, and the now-stale "Covers both..." comment — `loadPreviewExtras`
  always runs the HEAD file-existence check.
  - Legacy data: a resume already stored with a non-PDF `mime_type` (there is no migration
    in scope — see Open Questions) must not hit a route that no longer exists. Show the
    existing `previewFileStatus === 'error'` fallback ("This CV's file couldn't be loaded —
    replace it from the CVs page.") for any `mime_type !== 'application/pdf'` instead of
    calling the removed HTML-preview path.
- `frontend/src/stores/resume.ts` and `frontend/src/lib/api.ts`: remove
  `getResumeHtmlPreview` (store action + the `GET /api/resume/:id/html` fetch call).
- `frontend/src/pages/CvsListPage.vue`: both file inputs' `accept` narrows from
  `.pdf,.docx` to `.pdf`; the upload label changes from "CV (PDF or DOCX)" to "CV (PDF)".
- `frontend/src/pages/HomePage.vue`: update the three "PDF or DOCX" copy strings to "PDF"
  (How-it-works step text, key-features text, and the intro paragraph).
- `frontend/tests/JobCvsModal.test.ts`: remove the `attachedDocx` fixture and its four
  DOCX-preview tests ("renders the fetched, sanitized HTML for a DOCX CV...", "wraps the
  DOCX preview HTML in a sized, bordered, shadowed container...", "shows the shared
  file-load failure message when the DOCX HTML fetch fails", "clears the loading spinner...
  when the DOCX HTML fetch rejects"); replace `attachedDocx` in list-rendering assertions
  with a second PDF fixture where the test needs two distinct attached CVs.
  Add a test that a non-PDF `mime_type` (simulating legacy data) renders the file-load-error
  fallback rather than attempting an HTML fetch.
- `.doc/product-definition.md`: Product Scope's "Candidate uploads a CV (PDF or DOCX)"
  becomes "Candidate uploads a CV (PDF)".
- `.doc/architecture.md`: update every DOCX/mammoth/sanitize-html reference (extraction
  section, module list, API route list, CV-preview UI description, changelog entries) to
  match the PDF-only design; do not delete the historical changelog entries, append a note
  that DOCX support was removed per this plan instead.
- Mark `.plan/012-2026-08-09-docx-preview-rendering.md` and
  `.plan/016-2026-08-10-docx-preview-container-styling.md` `Status: superseded`, linking to
  this plan — both describe DOCX preview behavior this plan deletes.

Out of scope:
- Any change to `backend/schema.sql` — `resume.mime_type` is already a free-text `text`
  column with no DOCX-specific constraint to narrow.
- Migrating or deleting resume rows already stored with the DOCX mime type. Existing DOCX
  files stay downloadable via `GET /:id/file` (which is not mime-type gated); only preview
  rendering and new uploads change. See Open Questions.
- Re-analyzing or re-scoring any existing resume.

## Assumptions
- No other route or module depends on `mammoth`, `sanitize-html`, `DOCX_MIME_TYPE`, or
  `convertToPreviewHtml` beyond what the greps above found (`extraction/index.ts`,
  `routes/resume.ts`, and the listed tests) — verified by repo-wide search, not just the
  files touched.
- `frontend/package.json` has no DOCX-related dependency to remove (verified — none found).

## Open Questions
1. What should the CVs list / preview experience be for a CV that was uploaded as DOCX
   before this change ships? Recommended: leave it downloadable (`GET /:id/file` is
   unchanged and not mime-gated) but show the same "file couldn't be loaded — replace it"
   fallback in the preview pane that a broken PDF already shows, so a candidate/recruiter is
   nudged toward replacing it with a PDF rather than seeing a broken preview silently.
   (Reflected in Scope above — confirm or override before implementation.)
2. Should the backend keep accepting a `.doc` (legacy binary Word) upload attempt with a
   clearer rejection message, or is "not `application/pdf`" → generic "file must be a PDF
   document" enough? Recommended: generic message is enough — `.doc` was never in
   `SUPPORTED_MIME_TYPES` and needs no special case.

## Steps
1. Backend: narrow `SUPPORTED_MIME_TYPES`, delete `convertToPreviewHtml` and the DOCX branch
   of `extractText` in `backend/src/extraction/index.ts`; remove now-unused
   `sanitize-html` import/consts.
2. Backend: remove `GET /:id/html` and the `DOCX_MIME_TYPE` import from
   `backend/src/routes/resume.ts`; update the two validation messages.
3. Backend: remove `mammoth`, `sanitize-html`, `@types/sanitize-html` from
   `backend/package.json`; run the package manager's install to update the lockfile.
4. Backend tests: delete `resume-html.test.ts`; update the five files listed in Scope that
   mock `SUPPORTED_MIME_TYPES`; convert DOCX fixtures in `resume.test.ts` /
   `authorization.test.ts` to PDF, add the new DOCX-rejected case.
5. Frontend: simplify `JobCvsModal.vue`'s preview branch and `loadPreviewExtras`; remove
   `getResumeHtmlPreview` from `stores/resume.ts` and `lib/api.ts`.
6. Frontend: narrow the `accept` attributes and label copy in `CvsListPage.vue`; update the
   three copy strings in `HomePage.vue`.
7. Frontend tests: update `JobCvsModal.test.ts` per Scope (remove DOCX fixture/tests, add
   the legacy-mime-type fallback test).
8. Docs: update `.doc/product-definition.md` and `.doc/architecture.md`; mark plans 012 and
   016 `Status: superseded` with a link to this plan.
9. Run full validation (below); fix anything it surfaces.

## Validation
- `cd backend && npm run typecheck` passes.
- `cd backend && npx vitest run` passes, including the new DOCX-rejected-upload case and the
  updated `SUPPORTED_MIME_TYPES` mocks.
- `cd frontend && npm run typecheck` (`vue-tsc --noEmit`) passes.
- `cd frontend && npx vitest run` passes, including the updated `JobCvsModal.test.ts`.
- `grep -riE "docx|mammoth" backend/src frontend/src` returns nothing (comments included) —
  confirms no dead references remain outside historical `.plan/` files.
- Manual smoke test: as a Candidate, attempt to upload a `.docx` file from `CvsListPage.vue`
  → the file picker itself no longer offers `.docx` (accept=".pdf"), and if forced via a
  direct API call it 400s with "file must be a PDF document". Uploading a `.pdf` still
  succeeds end to end (upload → analysis → attach → preview → match).

## Risks
- Removing `sanitize-html` is only safe because it has exactly one consumer today; if that
  grep is stale by the time this executes, re-run it before deleting the dependency.
- Deleting `GET /:id/html` is a breaking API change for any external caller of that route —
  none are known (frontend was the only consumer), but this is worth a final grep across
  `frontend/` and `.orchestrate/api-contract.yaml` before removal.
- A legacy DOCX resume's preview silently degrading to the generic file-load-error message
  (Open Question 1) could read as "the file is broken" rather than "this format is no longer
  previewable" — acceptable for this stage per the recommendation, but worth flagging in the
  PR description so it's a conscious tradeoff, not a surprise.

## Rollout Order
1. Backend changes (extraction, route, package.json, tests) land first — the API stops
   accepting/serving DOCX preview HTML.
2. Frontend changes land next, removing the now-dead HTML-preview call path and narrowing
   the upload picker.
3. Docs and plan-status updates land last, once the code changes are validated.

## Rollback
Revert the branch's commits. No data migration occurred, so rollback is a pure code
revert — no backfill or schema change to undo.
