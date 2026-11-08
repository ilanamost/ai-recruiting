# Backend Report: LLM_MODE=mock (plan 038)

Branch: `feat/llm-mode-mock` (nothing committed). Status: DONE. Last updated: 2026-11-08.

This report describes the final state. The first version was revised after manual testing; see the
"Revised" note in `.plan/038-2026-11-08-llm-mode-mock.md`. Test counts are in `.orchestrate/qa-report.md`.

## Behavior
- `isMockMode()` is true only for `LLM_MODE=mock`; unset or `live` keeps the real Anthropic path.
- Invalid value (e.g. `mok`): `reportInvalidLlmMode()` logs an error at startup and the server keeps
  running. `assertLlmAvailable()` makes `scoreMatch` and `analyzeResume` throw `ServiceUnavailableError`
  (503, code `service_unavailable`, "Matching is temporarily unavailable..."). CV uploads still succeed
  (stored unclassified); `/api/health` and the rest of the API are unaffected. It never falls back to live.
- `scoreMatch` (mock): 35% coverage of technologies the job names + 65% general job vocabulary,
  mapped through a piecewise-linear curve (0 -> 0, 0.25 -> 20, 0.5 -> 100) to an integer 0-100.
  Variants are normalized (`Vue.js`/`vue`, `HTML5`/`html`, plurals); known tech names are never stemmed.
  Explanation starts with `[Mock]` and lists matching and missing skills. A resume with no extractable
  text scores 0 with an explanation saying so. Calibrated against stored LLM scores; it ignores
  seniority and required years, so cross-domain pairs can score somewhat high.
- `analyzeResume` (mock): years from "N years" phrases and dated ranges (overlaps once, `null` when
  none; a range ending "present" uses the current year); skills from a built-in tech-term list matched
  on word boundaries; output goes through the existing normalizers.
- The mock check runs before the Anthropic client is created, so no SDK instance or API key is needed.

## Changed files
- backend/src/lib/llm-mode.ts (new), backend/src/lib/errors.ts (`ServiceUnavailableError`)
- backend/src/scoring/mock.ts (new), backend/src/analysis/mock.ts (new)
- backend/src/scoring/index.ts, backend/src/analysis/index.ts, backend/src/index.ts
- backend/tests/llm-mode.test.ts (new), backend/tests/qa-llm-mode.adversarial.test.ts (QA)
- backend/.env.example (`LLM_MODE=mock`), .env.staging.example and .env.production.example (`LLM_MODE=live`)
- .doc/backend-overview.md, .doc/deployment.md

## Related frontend change (resilience, same plan)
- frontend/src/lib/http.ts (`guardNetwork`), lib/auth.ts (`serverUnreachable`), lib/toastMessages.ts,
  pages/LoginPage.vue, and updated tests. An unreachable API now sends the user to `/login` with a notice.
