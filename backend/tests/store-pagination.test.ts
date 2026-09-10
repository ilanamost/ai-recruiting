import { beforeEach, describe, expect, it, vi } from 'vitest'

// Records every SQL statement pg-store issues so the LIMIT/OFFSET params it
// builds can be asserted without a live Postgres instance (the rest of the
// suite runs against memory-store only — see tests/schema.test.ts's note).
const queries: { text: string; values: unknown[] }[] = []

vi.mock('pg', () => ({
  Pool: class {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values })
      // count(*) queries read rows[0].count; list queries read rows.
      return { rows: [{ count: '0' }], rowCount: 1 }
    }
  }
}))

import { createMemoryStore } from '../src/store/memory-store'
import { createPgStore } from '../src/store/pg-store'
import type { Store } from '../src/store/types'

async function seedJobs(store: Store, count: number, org_id = 'demo-org') {
  for (let i = 0; i < count; i++) {
    await store.createJob({ org_id, title: `Job ${i}`, description: 'Node and TypeScript' })
  }
}

async function seedResumes(store: Store, count: number) {
  for (let i = 0; i < count; i++) {
    const candidate = await store.createCandidate({ name: `Candidate ${i}`, email: `candidate${i}@example.com` })
    await store.createResume({
      candidate_id: candidate.id,
      file_name: `resume-${i}.pdf`,
      mime_type: 'application/pdf',
      content: 'resume text',
      file_data: Buffer.from('%PDF-1.4 fake bytes')
    })
  }
}

/** Every param shape that must not reach a SQL OFFSET as a negative number. */
const OUT_OF_BOUNDS: { label: string; params: { page: number; limit: number } }[] = [
  { label: 'page 0', params: { page: 0, limit: 10 } },
  { label: 'a negative page', params: { page: -3, limit: 10 } },
  { label: 'limit 0', params: { page: 1, limit: 0 } },
  { label: 'a negative limit', params: { page: 1, limit: -5 } },
  { label: 'a negative page and limit together', params: { page: -2, limit: -5 } }
]

// The route layer clamps via parsePageParams before it ever calls the store, so
// none of this is reachable through the HTTP API today. It is pinned anyway
// because the Store interface is shared by two implementations that used to
// diverge on exactly this input — memory-store's slice(-10, 0) silently
// returned an empty page while pg-store handed Postgres a negative OFFSET and
// 500'd. backend.md requires the two stay behaviorally identical.
describe('Store pagination — sub-1 page/limit passed directly to the store', () => {
  beforeEach(() => {
    queries.length = 0
  })

  describe('memory-store', () => {
    it.each(OUT_OF_BOUNDS)('listJobs clamps $label to the first page instead of returning nothing', async ({ params }) => {
      const store = createMemoryStore()
      await seedJobs(store, 12)

      const result = await store.listJobs('demo-org', params)
      const firstPage = await store.listJobs('demo-org', { page: 1, limit: 10 })

      expect(result.total).toBe(12)
      expect(result.items).toHaveLength(10)
      expect(result.items.map((job) => job.id)).toEqual(firstPage.items.map((job) => job.id))
    })

    it.each(OUT_OF_BOUNDS)('listResumes clamps $label to the first page instead of returning nothing', async ({ params }) => {
      const store = createMemoryStore()
      await seedResumes(store, 12)

      const result = await store.listResumes(params)
      const firstPage = await store.listResumes({ page: 1, limit: 10 })

      expect(result.total).toBe(12)
      expect(result.items).toHaveLength(10)
      expect(result.items.map((resume) => resume.id)).toEqual(firstPage.items.map((resume) => resume.id))
    })
  })

  describe('pg-store', () => {
    it.each(OUT_OF_BOUNDS)('listJobs never sends a negative OFFSET for $label', async ({ params }) => {
      const store = createPgStore(undefined)

      await store.listJobs('demo-org', params)

      const listQuery = queries.find((query) => query.text.includes('offset'))
      expect(listQuery).toBeDefined()
      const [, limit, offset] = listQuery!.values as [string, number, number]
      expect(offset).toBe(0)
      expect(limit).toBeGreaterThanOrEqual(1)
    })

    it.each(OUT_OF_BOUNDS)('listResumes never sends a negative OFFSET for $label', async ({ params }) => {
      const store = createPgStore(undefined)

      await store.listResumes(params)

      const listQuery = queries.find((query) => query.text.includes('offset'))
      expect(listQuery).toBeDefined()
      const [limit, offset] = listQuery!.values as [number, number]
      expect(offset).toBe(0)
      expect(limit).toBeGreaterThanOrEqual(1)
    })
  })

  it('both stores agree on the page a sub-1 page resolves to', async () => {
    const memory = createMemoryStore()
    await seedJobs(memory, 12)

    const memoryResult = await memory.listJobs('demo-org', { page: 0, limit: 10 })

    const pg = createPgStore(undefined)
    await pg.listJobs('demo-org', { page: 0, limit: 10 })
    const pgOffset = (queries.find((query) => query.text.includes('offset'))!.values as [string, number, number])[2]

    // memory-store slices from offset 0; pg-store must ask Postgres for the same row.
    expect(memoryResult.items).toHaveLength(10)
    expect(pgOffset).toBe(0)
  })
})
