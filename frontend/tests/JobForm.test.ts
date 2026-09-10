import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

vi.mock('../src/lib/api', async (importOriginal) => ({
  // UNPAGED_LIMIT is a plain constant, not something to stub: taking it from the real
  // module keeps this mock from re-stating the server's limit cap and drifting from it.
  UNPAGED_LIMIT: (await importOriginal<typeof import('../src/lib/api')>()).UNPAGED_LIMIT,
  createJob: vi.fn().mockResolvedValue({
    id: 'job-1',
    org_id: 'demo-org',
    title: 'Backend Engineer',
    description: 'Node and TypeScript',
    location: 'Berlin, Germany',
    created_at: new Date().toISOString()
  })
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

// The form renders Title, then Location, then Description — index the text inputs by that order.
const TITLE_INPUT = 0
const LOCATION_INPUT = 1

import JobForm from '../src/components/JobForm.vue'
import { createJob } from '../src/lib/api'
import { toast } from 'vue-sonner'

// .plan/018: the form calls the job store, which is the only thing that calls lib/api. The
// mount installs a real (testing) Pinia with `stubActions: false`, so the store's actual logic
// runs, with lib/api mocked as the network boundary — and per .plan/023 a rejection travels
// straight back out of the store to the form, which is what raises the toast.
function mountForm() {
  return mount(JobForm, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })] }
  })
}

describe('JobForm', () => {
  beforeEach(() => {
    vi.mocked(createJob).mockClear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('emits created with the new job on submit', async () => {
    const wrapper = mountForm()

    await wrapper.find('input[type=text]').setValue('Backend Engineer')
    await wrapper.find('textarea').setValue('Node and TypeScript')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createJob).toHaveBeenCalledWith({
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node and TypeScript',
      location: ''
    })
    expect(wrapper.emitted('created')?.[0]).toEqual([
      expect.objectContaining({ id: 'job-1', title: 'Backend Engineer' })
    ])
  })

  it('sends the location when one is filled in', async () => {
    const wrapper = mountForm()

    const textInputs = wrapper.findAll('input[type=text]')
    await textInputs[TITLE_INPUT].setValue('Backend Engineer')
    await textInputs[LOCATION_INPUT].setValue('Berlin, Germany')
    await wrapper.find('textarea').setValue('Node and TypeScript')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createJob).toHaveBeenCalledWith({
      org_id: 'demo-org',
      title: 'Backend Engineer',
      description: 'Node and TypeScript',
      location: 'Berlin, Germany'
    })
  })

  it('still creates the job when location is left blank', async () => {
    const wrapper = mountForm()

    const textInputs = wrapper.findAll('input[type=text]')
    await textInputs[TITLE_INPUT].setValue('Backend Engineer')
    await wrapper.find('textarea').setValue('Node and TypeScript')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ location: '' }))
    expect(toast.error).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')?.[0]).toEqual([expect.objectContaining({ id: 'job-1' })])
  })

  it('routes the success confirmation to the centered toaster', async () => {
    const wrapper = mountForm()

    await wrapper.find('input[type=text]').setValue('Backend Engineer')
    await wrapper.find('textarea').setValue('Node and TypeScript')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.success).toHaveBeenCalledWith('Job created successfully', { toasterId: 'center' })
  })

  it('does not submit when required fields are blank', async () => {
    const wrapper = mountForm()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(createJob).not.toHaveBeenCalled()
  })

  // .plan/023 moved this toast back out of the job store and into onSubmit's catch; mounting
  // with a real testing Pinia keeps the failure path exercised end to end from the form.
  it('surfaces a create failure as a toast and emits nothing', async () => {
    vi.mocked(createJob).mockRejectedValueOnce(new Error('Title is required'))
    const wrapper = mountForm()

    await wrapper.find('input[type=text]').setValue('Backend Engineer')
    await wrapper.find('textarea').setValue('Node and TypeScript')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Title is required')
    expect(toast.success).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeFalsy()
    // The button leaves its submitting state, so the form can be retried.
    expect(wrapper.find('button[type=submit]').text()).toBe('Create job')
  })
})
