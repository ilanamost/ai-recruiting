import type { Page } from '../../src/types'

// .plan/028: `GET /api/job` and `GET /api/resume` return a pagination envelope instead of a
// bare array (`.orchestrate/api-contract.yaml`). Every test that mocks `api.listJobs` /
// `api.listResumes` wraps its fixture with this, so a mock can never drift into promising a
// response shape the real endpoint no longer returns.
//
// `total` defaults to the fixture's own length — the common "everything fits on one page"
// case. Pass it explicitly to describe a multi-page list without building every row.
export function pageOf<T>(items: T[], overrides: Partial<Omit<Page<T>, 'items'>> = {}): Page<T> {
  return {
    items,
    total: overrides.total ?? items.length,
    page: overrides.page ?? 1,
    limit: overrides.limit ?? 10
  }
}
