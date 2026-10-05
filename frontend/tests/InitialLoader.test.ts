import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import InitialLoader from '../src/components/InitialLoader.vue'

describe('InitialLoader', () => {
  it('renders an accessible loading status with a visible spinner', () => {
    const wrapper = mount(InitialLoader)

    expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite')
    expect(wrapper.get('[role="status"]').text()).toContain('Loading your workspace')
    expect(wrapper.get('.initial-loader').classes()).toContain('initial-loader')
    expect(wrapper.get('.initial-loader__spinner').attributes('aria-hidden')).toBe('true')
  })
})
