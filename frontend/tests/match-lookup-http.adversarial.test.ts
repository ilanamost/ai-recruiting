// QA adversarial (.plan/041): drive JobCvsModal through the REAL lib/api + lib/http with only
// global fetch stubbed, so a real 500 / 204 / 404 Response travels the whole lookup path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    user: ref({ id: 'u1', name: 'Amy', email: 'a@x.io', role: 'admin', org_id: 'o', has_profile_image: false })
  })
}))

import JobCvsModal from '../src/components/JobCvsModal.vue'
import { getMatchForPair, ApiError } from '../src/lib/api'
import { toast } from 'vue-sonner'

const job = { id: 'job-1', org_id: 'o', title: 'BE', description: 'Node', location: null, created_at: '2026-07-01T00:00:00.000Z' }
const resume = {
  id: 'resume-1', candidate_id: 'c1', candidate_name: 'Jane Doe', candidate_email: 'j@x.io',
  file_name: 'jane.pdf', mime_type: 'application/pdf', content: 'text', created_at: '2026-07-03T00:00:00.000Z',
  jobs: [{ id: 'job-1', title: 'BE' }], attached_at: '2026-07-04T00:00:00.000Z', owner_user_id: 'u1',
  years_experience: 4, skills: ['node']
}
const match = { id: 'match-1', resume_id: 'resume-1', job_id: 'job-1', score: 82, explanation: 'ok', created_at: '2026-07-06T00:00:00.000Z' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('match lookup over real Response objects (.plan/041)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let lookup: () => Response

  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/resumes/resume-1/match')) return lookup()
      if (url.endsWith('/api/job/job-1/resumes')) return json([resume])
      if (url.includes('/api/job/job-1/matches')) return json([])
      if (url.includes('/file')) return new Response(new Blob(['%PDF']), { status: 200 })
      if (url.endsWith('/api/match') && method === 'POST') return json(match, 201)
      if (url.includes('/api/match/')) return json(match)
      if (url.includes('/api/resume')) return json({ items: [resume], total: 1, page: 1, limit: 100 })
      return json({ error: { code: 'not_found', message: 'x' } }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  function mountModal() {
    return mount(JobCvsModal, {
      props: { job },
      global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
    })
  }
  async function open() {
    const wrapper = mountModal()
    await flushPromises()
    await wrapper.findAll('li').find((li) => li.text().includes('Jane Doe'))?.trigger('click')
    await flushPromises()
    return wrapper
  }
  const posted = () => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/api/match') && i?.method === 'POST')

  it('real 500 with JSON error body rejects getMatchForPair with ApiError(internal_error)', async () => {
    lookup = () => json({ error: { code: 'internal_error', message: 'Boom' } }, 500)
    await expect(getMatchForPair('job-1', 'resume-1')).rejects.toMatchObject({ name: 'ApiError', code: 'internal_error', message: 'Boom' })
    await expect(getMatchForPair('job-1', 'resume-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('real 500 with a non-JSON body still rejects (no SyntaxError leak)', async () => {
    lookup = () => new Response('<html>bad gateway</html>', { status: 500 })
    await expect(getMatchForPair('job-1', 'resume-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('real Response 204 (genuinely empty body) resolves null', async () => {
    lookup = () => new Response(null, { status: 204 })
    await expect(getMatchForPair('job-1', 'resume-1')).resolves.toBeNull()
  })

  it('modal: real 500 toasts the server message and does not crash the preview', async () => {
    lookup = () => json({ error: { code: 'internal_error', message: 'Boom' } }, 500)
    const wrapper = await open()
    expect(toast.error).toHaveBeenCalledWith('Boom')
    expect(wrapper.text()).toContain('Match result')
  })

  it('modal: real 204 -> no toast, no console error/warn, scoring POST follows', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    lookup = () => new Response(null, { status: 204 })
    await open()
    expect(toast.error).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(posted()).toHaveLength(1)
    err.mockRestore()
    warn.mockRestore()
  })

  it('modal: old backend 404 (rollout) -> same clean behaviour', async () => {
    lookup = () => json({ error: { code: 'not_found', message: 'No match found' } }, 404)
    await open()
    expect(toast.error).not.toHaveBeenCalled()
    expect(posted()).toHaveLength(1)
  })

  it('modal: real 200 existing match -> no scoring POST', async () => {
    lookup = () => json(match)
    await open()
    expect(toast.error).not.toHaveBeenCalled()
    expect(posted()).toHaveLength(0)
  })

  it('OLD frontend semantics on 204 (documented risk): response.json() on empty 204 throws', async () => {
    const r = new Response(null, { status: 204 })
    await expect(r.json()).rejects.toBeInstanceOf(SyntaxError)
  })
})
