import type { PageParams } from '../store/types'

/** Page size used when `limit` is missing or unusable. */
export const DEFAULT_PAGE_LIMIT = 10

/**
 * Ceiling on `limit`. 500 rather than something smaller because two callers
 * deliberately request an effectively-unpaginated list and rely on it:
 * JobsListPage while a client-side filter is active, and JobCvsModal's attach
 * dropdown (.plan/028 Open Questions 1 and 3). Raising or lowering it is an
 * API contract change — see .orchestrate/api-contract.yaml.
 */
export const MAX_PAGE_LIMIT = 500

function clampInteger(value: unknown, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' && typeof raw !== 'number') return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback

  const whole = Math.floor(parsed)
  if (whole < 1) return fallback
  return Math.min(whole, max)
}

/**
 * Turns a request's raw `page`/`limit` query params into the effective values
 * to query with. These clamp, they never throw: a stale client link trivially
 * produces a page number a list has outgrown, which isn't malformed input
 * worth a 400 (.plan/028 Open Question 3). Missing/non-numeric/zero/negative
 * `page` means 1; the same for `limit` means DEFAULT_PAGE_LIMIT, and anything
 * over MAX_PAGE_LIMIT is capped there. A `page` past the last page is left
 * alone — the store returns an empty `items` with the true `total`.
 */
export function parsePageParams(query: Record<string, unknown>): PageParams {
  return {
    page: clampInteger(query.page, 1, Number.MAX_SAFE_INTEGER),
    limit: clampInteger(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
  }
}

/**
 * Second line of defence, applied inside every Store.listX implementation
 * rather than only at the route layer, so the interface's contract holds for
 * any caller — a direct store call, or a future route that forgets to clamp.
 * Without it the two stores diverge on the same bad input: memory-store's
 * `slice(-10, 0)` silently returns an empty page while pg-store sends a
 * negative SQL OFFSET, which Postgres rejects outright. Same clamping as
 * parsePageParams for page/limit floors, but deliberately no MAX_PAGE_LIMIT
 * cap: that ceiling is an API-surface decision, not a storage-layer one.
 */
export function normalizePageParams({ page, limit }: PageParams): PageParams {
  return {
    page: clampInteger(page, 1, Number.MAX_SAFE_INTEGER),
    limit: clampInteger(limit, DEFAULT_PAGE_LIMIT, Number.MAX_SAFE_INTEGER)
  }
}
