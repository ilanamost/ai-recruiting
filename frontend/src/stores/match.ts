import { defineStore } from 'pinia'
import * as api from '../lib/api'

// Thin by design (.plan/018 Step 4): MatchResult only ever needs one match at a time, so there
// is no persistent collection here — just the API wrappers.
//
// Nothing in this store notifies on failure (.plan/023): every rejection propagates to the
// caller, which owns the reporting. JobCvsModal toasts the two lookups it drives
// (`getMatchForPair`, `listLatestMatchesForJob`), because they have no inline surface of their
// own; `createMatch`/`getMatch` back MatchResult, which renders its failure inline inside the
// match card ("Failed to score the match") and deliberately never toasts.
export const useMatchStore = defineStore('match', () => {
  async function createMatch(input: api.CreateMatchInput) {
    return api.createMatch(input)
  }

  async function getMatch(id: string) {
    return api.getMatch(id)
  }

  async function getMatchForPair(jobId: string, resumeId: string) {
    return api.getMatchForPair(jobId, resumeId)
  }

  async function listLatestMatchesForJob(jobId: string) {
    return api.listLatestMatchesForJob(jobId)
  }

  return { createMatch, getMatch, getMatchForPair, listLatestMatchesForJob }
})
