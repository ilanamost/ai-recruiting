import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

const isLoaderVisible = ref(false)
const isPageLoaderVisible = ref(false)

vi.mock('../src/lib/loading', () => ({
  useLoading: () => ({ isLoaderVisible, isPageLoaderVisible })
}))

import AppLoader from '../src/components/AppLoader.vue'

function setState(bar: boolean, page: boolean) {
  isLoaderVisible.value = bar
  isPageLoaderVisible.value = page
}

describe('AppLoader', () => {
  it('renders nothing while no loader is visible', () => {
    setState(false, false)
    const wrapper = mount(AppLoader)

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('.global-loader-bar').exists()).toBe(false)
    expect(wrapper.find('.global-loader-spinner').exists()).toBe(false)
  })

  it('renders an accessible status with only the top bar for a non-page request', () => {
    setState(true, false)
    const wrapper = mount(AppLoader)

    const status = wrapper.get('[role="status"]')
    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.text()).toContain('Loading…')
    expect(wrapper.get('.global-loader-bar').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.global-loader-spinner').exists()).toBe(false)
  })

  it('renders the centered, aria-hidden spinner for a page-level load', () => {
    setState(false, true)
    const wrapper = mount(AppLoader)

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.get('.global-loader-spinner').attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('.global-loader-page').classes()).toContain('pointer-events-none')
    expect(wrapper.find('.global-loader-bar').exists()).toBe(false)
  })

  it('removes the status once loading finishes', async () => {
    setState(true, true)
    const wrapper = mount(AppLoader)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    setState(false, false)
    await nextTick()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('uses no inline styles', () => {
    setState(true, true)
    const wrapper = mount(AppLoader)

    expect(wrapper.html()).not.toContain('style=')
  })
})
