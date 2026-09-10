import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../../src/lib/api')>()).UNPAGED_LIMIT,
  createMatch: vi.fn(),
  getMatch: vi.fn(),
  getMatchForPair: vi.fn(),
  listLatestMatchesForJob: vi.fn()
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

import { useMatchStore } from '../../src/stores/match'
import * as api from '../../src/lib/api'
import { toast } from 'vue-sonner'

const match = {
  id: 'match-1',
  resume_id: 'resume-1',
  job_id: 'job-1',
  score: 82,
  explanation: 'Strong overlap in required skills.',
  created_at: '2026-07-06T00:00:00.000Z'
}

describe('match store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(api.createMatch).mockReset().mockResolvedValue(match)
    vi.mocked(api.getMatch).mockReset().mockResolvedValue(match)
    vi.mocked(api.getMatchForPair).mockReset().mockResolvedValue(match)
    vi.mocked(api.listLatestMatchesForJob).mockReset().mockResolvedValue([match])
    vi.mocked(toast.error).mockClear()
  })

  describe('createMatch / getMatch', () => {
    it('returns the scored match', async () => {
      const store = useMatchStore()

      await expect(store.createMatch({ resume_id: 'resume-1', job_id: 'job-1' })).resolves.toEqual(match)
      await expect(store.getMatch('match-1')).resolves.toEqual(match)

      expect(api.createMatch).toHaveBeenCalledWith({ resume_id: 'resume-1', job_id: 'job-1' })
      expect(api.getMatch).toHaveBeenCalledWith('match-1')
    })

    // These two back MatchResult, which renders its failure inline inside the match card and
    // has never toasted — adding a toast here would double-report the same failure.
    it('re-throws a createMatch failure without toasting', async () => {
      vi.mocked(api.createMatch).mockRejectedValue(new Error('The scoring model declined'))
      const store = useMatchStore()

      await expect(store.createMatch({ resume_id: 'resume-1', job_id: 'job-1' })).rejects.toThrow(
        'The scoring model declined'
      )

      expect(toast.error).not.toHaveBeenCalled()
    })

    it('re-throws a getMatch failure without toasting', async () => {
      vi.mocked(api.getMatch).mockRejectedValue(new Error('Match not found'))
      const store = useMatchStore()

      await expect(store.getMatch('match-1')).rejects.toThrow('Match not found')

      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('getMatchForPair', () => {
    it('returns the existing match for the pair', async () => {
      const store = useMatchStore()

      await expect(store.getMatchForPair('job-1', 'resume-1')).resolves.toEqual(match)
      expect(api.getMatchForPair).toHaveBeenCalledWith('job-1', 'resume-1')
    })

    it('passes through a null result for a pair with no match yet', async () => {
      vi.mocked(api.getMatchForPair).mockResolvedValue(null)
      const store = useMatchStore()

      await expect(store.getMatchForPair('job-1', 'resume-1')).resolves.toBeNull()
      expect(toast.error).not.toHaveBeenCalled()
    })

    // .plan/023 moved the toast to JobCvsModal's preview lookup — see JobCvsModal.test.ts for
    // the message and its 'Failed to look up an existing match' fallback. Nothing in this store
    // notifies any more.
    it('propagates the failure untouched, without toasting', async () => {
      vi.mocked(api.getMatchForPair).mockRejectedValue(new Error('Job not found'))
      const store = useMatchStore()

      await expect(store.getMatchForPair('job-1', 'resume-1')).rejects.toThrow('Job not found')

      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('listLatestMatchesForJob', () => {
    it('returns the latest match per scored resume for the job', async () => {
      const store = useMatchStore()

      await expect(store.listLatestMatchesForJob('job-1')).resolves.toEqual([match])
      expect(api.listLatestMatchesForJob).toHaveBeenCalledWith('job-1')
    })

    // .plan/023: JobCvsModal's loadLatestMatches owns this toast now (JobCvsModal.test.ts).
    it('propagates the failure untouched, without toasting', async () => {
      vi.mocked(api.listLatestMatchesForJob).mockRejectedValue(new Error('Job not found'))
      const store = useMatchStore()

      await expect(store.listLatestMatchesForJob('job-1')).rejects.toThrow('Job not found')

      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
