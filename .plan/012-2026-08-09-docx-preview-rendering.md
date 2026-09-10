Status: superseded — see .plan/030-2026-09-08-remove-docx-cv-support.md (DOCX support removed)
Owner: Ilana
Last updated: 2026-09-08

## Goal
Previewing a `.docx` CV in `JobCvsModal.vue`'s preview pane shows the document's actual
formatted content (headings, paragraphs, lists, bold/italic) — the same "see the real file"
experience the PDF branch already gives via its inline iframe — instead of today's flat,
unstyled plain-text dump of the extracted scoring text.

## Scope
In scope:
- `backend/src/extraction/index.ts`: add `convertToPreviewHtml(buffer: Buffer): Promise<string>`
  — runs `mammoth.convertToHtml({ buffer })` (mammoth already extracts DOCX text here via
  `extractRawText`; `convertToHtml` is the same library's structure-preserving sibling) and
  sanitizes the result through an HTML allow-list sanitizer before returning it. This is a
  second, additive function — `extractText`'s existing plain-text output (used for LLM scoring
  in `backend/src/scoring/`) is untouched.
- `backend/src/routes/resume.ts`: new `GET /:id/html` — loads the resume file via
  `store.getResumeFile`, 404s if missing/no `file_data` (mirrors `GET /:id/file`'s existing
  checks), 400s if the resume's `mime_type` isn't the DOCX type (PDF has its own iframe path
  and never needs this), otherwise returns `{ html: string }` from `convertToPreviewHtml`. No
  new role restriction — matches `GET /:id/file`'s existing open-to-any-authenticated-role
  policy (a Candidate can already view/download any CV's raw file; this is the same read
  access in a different rendering).
- `frontend/src/lib/api.ts`: `getResumeHtmlPreview(id: string): Promise<{ html: string }>`
  thin wrapper, alongside the existing `getResumeFileUrl` helper.
- `frontend/src/components/JobCvsModal.vue`: in `loadPreviewExtras`, when the previewed
  resume's `mime_type` is DOCX, fetch and store the sanitized HTML (with its own
  loading/error state, mirroring the existing PDF `previewFileStatus` pattern) instead of
  relying on `previewResume.content`. Template: render the fetched HTML via `v-html` inside a
  scrollable container, replacing the current `<pre>{{ previewResume.content }}</pre>` block.
  On a conversion error, fall back to a short message (not the raw plain text — see Open
  Question 2).
- A new backend dependency for HTML sanitization (see Open Question 1).
- Tests: `backend/tests/resume.test.ts` (or a new `resume-html.test.ts`) — `GET /:id/html`
  returns sanitized HTML for a DOCX resume, 400s for a PDF resume, 404s for a missing resume.
  A dedicated sanitization test: a DOCX crafted (or a mocked mammoth output) containing a
  `<script>` tag or an `onerror` attribute is stripped from the response.
  `frontend/tests/JobCvsModal.test.ts` — the DOCX preview branch renders fetched HTML instead
  of plain text, and shows a fallback message when the fetch/convert fails.

Out of scope:
- Changing `extractText`/the plain-text `resume.content` field used for LLM scoring — scoring
  must keep receiving plain text, not HTML, so nothing in `backend/src/scoring/` changes.
- PDF preview — already renders the real file via an iframe; untouched.
- Upload-time file-type validation ("a file type that is neither `.docx` nor `.pdf` should
  error and not upload" — this was in an earlier draft of this backlog item but was removed
  from `.plan/000-backlog.md` before this plan was written; `resume.ts`'s existing
  `isSupportedMimeType` check at upload already 400s unsupported types today, so there is
  nothing new to build here regardless).
- `CvsListPage.vue` — it has no file-content preview today (only `JobCvsModal.vue` does); out
  of scope to add one.
- Persisting the converted HTML (e.g. a new `resume.preview_html` column) — computed on demand
  from the already-stored `file_data` on every preview open, matching how the existing PDF
  file-check and match lookup already work in `loadPreviewExtras`. See Open Question 3.

## Assumptions
- **This task requires backend work despite the backlog not carrying a `stack:full` tag**,
  same reason as `.plan/009` through `.plan/011`: this repo already has a real backend, and
  DOCX bytes can only be parsed server-side — `.doc/architecture.md` already establishes
  `backend/src/extraction/` as "the only module that touches raw file bytes," and nothing in
  this repo parses raw file bytes client-side (the PDF branch relies on the browser's native
  viewer, not custom JS parsing). Converting DOCX-to-HTML in the frontend would break that
  invariant and duplicate a parsing dependency (mammoth) into the browser bundle for no reason
  when the backend already has it.
- Mammoth's `convertToHtml` output is **not** safe to render as-is: it's HTML generated from
  user-uploaded file content, which is exactly the kind of untrusted-input-to-HTML-output path
  `.rule/security-rules.md` calls out ("Escape or encode output based on context... to prevent
  XSS"). It must be sanitized before the frontend ever receives or `v-html`-renders it — see
  Open Question 1 for the specific mechanism.

## Open Questions
1. **Which sanitizer, and where does sanitization happen?** No sanitization library exists in
   either `package.json` today. Client-side sanitization (e.g. `dompurify` in the frontend)
   would work, but leaves a gap if any future consumer of the new `/:id/html` route forgets to
   sanitize before rendering — the response itself would still be raw, unsafe HTML.
   **Recommended:** sanitize server-side, inside `convertToPreviewHtml`, using `sanitize-html`
   (mature, widely used, small footprint) with an allow-list covering exactly what mammoth's
   default output produces — `p`, `h1`-`h6`, `strong`, `em`, `ul`/`ol`/`li`, `a` (`href` only,
   `rel="noopener noreferrer"` forced), `br`, `table`/`tr`/`td`/`th`. This way `/:id/html`'s
   response is safe by construction, and the frontend can `v-html` it directly.
2. **What does the DOCX preview show when conversion fails (corrupt file, mammoth throws)?**
   The current plain-text branch never fails visibly since `resume.content` is always a
   string (possibly empty). Once this is a live conversion, it can genuinely fail.
   **Recommended:** show the same shape of inline error message the PDF branch already uses
   for a failed file check ("This CV's file couldn't be loaded — replace it from the CVs
   page."), reusing that copy pattern rather than inventing a new one, and log the mammoth
   error server-side (never expose the raw parser error to the client, per
   `.rule/error-handling-rules.md`).
3. **Compute the HTML on every preview open, or cache it?** Recomputing per open re-parses the
   DOCX (cheap — these are small resume files, and mammoth is fast) every time a CV is
   previewed. **Recommended:** no caching/persistence for now, matching the existing pattern
   for the PDF file-check and match lookup in `loadPreviewExtras` — keep it simple until a real
   performance problem shows up; revisit only if resumes turn out to be large enough that
   repeated conversion is noticeably slow.

Proceeding with the recommended answers on all three unless told otherwise.

## Steps
1. **Backend dependency**: add `sanitize-html` (plus `@types/sanitize-html`) to
   `backend/package.json`.
2. **`backend/src/extraction/index.ts`**: add
   `convertToPreviewHtml(buffer: Buffer): Promise<string>` — calls
   `mammoth.convertToHtml({ buffer })`, then runs the result through `sanitize-html` with the
   allow-list from Open Question 1's answer, and returns the sanitized string. Only wired for
   the DOCX mime type; callers are responsible for checking the mime type first (mirrors how
   `extractText` already branches on `mimeType`).
3. **`backend/src/routes/resume.ts`**: add `GET /:id/html` (after the existing `GET /:id/file`)
   — loads the resume via `store.getResumeFile`, 404s per the existing pattern, 400s
   (`ValidationError`) if `mime_type` isn't the DOCX constant, otherwise calls
   `convertToPreviewHtml(file.file_data)` and responds `{ html }`. No `requireRole` — matches
   the existing open-read policy on `GET /:id/file`.
4. **`frontend/src/lib/api.ts`**: add `getResumeHtmlPreview(id: string)` calling the new route
   via `apiFetch`, returning `{ html: string }`, throwing `ApiError` on a non-OK response (same
   shape as the file's other `get*` helpers in this file).
5. **`frontend/src/components/JobCvsModal.vue`**:
   - Add `previewHtml = ref<string | null>(null)` and reuse a status ref
     (`previewFileStatus` already exists for the PDF branch — either extend it to cover both
     branches or add a parallel `previewHtmlStatus`; pick whichever keeps the existing PDF
     logic simplest to read).
   - In `loadPreviewExtras`, when `resume.mime_type` is the DOCX constant, fetch
     `getResumeHtmlPreview(resume.id)`, store the result, and set an error status on failure
     (per Open Question 2) instead of leaving the old `previewResume.content` fallback in
     place.
   - Template: replace the `<pre>{{ previewResume.content }}</pre>` branch with a loading
     state, an error-message state, and (on success) a `<div v-html="previewHtml" />` inside a
     scrollable container styled with existing Tailwind utility classes (no new `.css` file, no
     inline styles, per `.claude/rules/ui-and-styling.md`).
6. **Tests**: per Steps described in Scope above — backend route tests (DOCX success, PDF
   400, missing-resume 404, and a sanitization-strips-a-script-tag case), frontend component
   test updates for the new fetch-and-render flow and its error fallback.
7. **Docs**: note the new `sanitize-html` dependency and the `GET /api/resume/:id/html` route
   in `.doc/architecture.md`'s Backend component list and Change Log.

## Validation
- `cd backend && npx vitest run` and `npx tsc --noEmit` — 100% pass, clean.
- `cd frontend && npx vitest run` and `npx vue-tsc --noEmit` — 100% pass, clean.
- Manual check via the `run` skill: upload a `.docx` CV with at least one heading, a bold or
  italic run, and a bulleted list; open its preview in `JobCvsModal.vue` — headings/bold/
  italic/lists render visually distinct from plain paragraph text (not one flat text block).
  Upload a corrupted/empty `.docx` (or temporarily point the route at a bad buffer) and confirm
  the preview shows the fallback error message instead of a blank screen or an unhandled
  exception. Confirm the PDF preview path is completely unaffected.

## Risks
- `sanitize-html`'s allow-list must be kept in sync with whatever tags mammoth's default
  conversion actually emits — too narrow and legitimate formatting silently disappears; too
  broad and it reopens the XSS gap this plan exists to close. The dedicated sanitization test
  in Step 6 is the guardrail against the broad-allow-list failure mode; a visual manual check
  covers the too-narrow one.
- `mammoth.convertToHtml` can emit warnings (unsupported elements) alongside its HTML — this
  plan ignores `result.messages`; if that turns out to hide real conversion problems, a
  follow-up could surface them, but that's speculative scope not requested here.

## Rollout Order
1. Backend ticket (dependency, `convertToPreviewHtml`, `GET /:id/html` route, tests) lands
   first — the frontend fetch depends on the route existing and returning safe HTML.
2. Frontend ticket (fetch-and-render in `JobCvsModal.vue`) applies once the backend route is in
   place.
3. QA runs last, focusing specifically on the sanitization boundary and the error fallback,
   not just the happy-path rendering.

## Rollback
Revert the commits touching `backend/package.json` (drop `sanitize-html`),
`backend/src/extraction/index.ts`, `backend/src/routes/resume.ts`,
`frontend/src/lib/api.ts`, and `frontend/src/components/JobCvsModal.vue`. No schema/data
change in this plan, so no data-migration rollback is needed.
