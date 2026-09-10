import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import FilterTabs from '../src/components/FilterTabs.vue'

// .plan/029 Step 10/12. FilterTabs owns no filter state and fetches nothing — it renders the
// selection its parent hands it and emits where the parent should move to next, so every test
// here is about exactly those two things plus the ARIA tabs semantics it establishes for the
// app (nothing else in frontend/src used role="tab" before this component).
const options = [
  { value: 'all', label: 'All' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' }
]

function mountTabs(modelValue = 'all') {
  return mount(FilterTabs, {
    props: { modelValue, options, label: 'Filter by experience level' }
  })
}

// jsdom only tracks document.activeElement for elements actually in the document, so the
// roving-focus test has to attach — the default detached mount would report <body> no matter
// what the component focuses.
function mountAttachedTabs(modelValue = 'all') {
  return mount(FilterTabs, {
    props: { modelValue, options, label: 'Filter by experience level' },
    attachTo: document.body
  })
}

function tabs(wrapper: ReturnType<typeof mountTabs>) {
  return wrapper.findAll('[role="tab"]')
}

function tabByLabel(wrapper: ReturnType<typeof mountTabs>, label: string) {
  return tabs(wrapper).find((tab) => tab.text() === label)!
}

describe('FilterTabs', () => {
  describe('rendering', () => {
    it('renders one tab per option inside a labelled tablist', () => {
      const wrapper = mountTabs()

      const tablist = wrapper.get('[role="tablist"]')
      expect(tablist.attributes('aria-label')).toBe('Filter by experience level')
      expect(tabs(wrapper).map((tab) => tab.text())).toEqual(['All', 'Junior', 'Mid', 'Senior'])
    })

    it('marks only the selected option with aria-selected', () => {
      const wrapper = mountTabs('mid')

      const selected = tabs(wrapper).map((tab) => tab.attributes('aria-selected'))
      expect(selected).toEqual(['false', 'false', 'true', 'false'])
    })

    it('moves aria-selected when the parent changes the model value', async () => {
      const wrapper = mountTabs('all')
      expect(tabByLabel(wrapper, 'All').attributes('aria-selected')).toBe('true')

      await wrapper.setProps({ modelValue: 'senior' })

      expect(tabByLabel(wrapper, 'All').attributes('aria-selected')).toBe('false')
      expect(tabByLabel(wrapper, 'Senior').attributes('aria-selected')).toBe('true')
    })

    it('renders the tabs as type=button so a strip inside a form never submits it', () => {
      const wrapper = mountTabs()

      for (const tab of tabs(wrapper)) {
        expect(tab.attributes('type')).toBe('button')
      }
    })
  })

  describe('selection', () => {
    it('emits the clicked option value without mutating its own prop', async () => {
      const wrapper = mountTabs('all')

      await tabByLabel(wrapper, 'Senior').trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([['senior']])
      // Presentational: the selection only actually moves when the parent sends it back down.
      expect(tabByLabel(wrapper, 'Senior').attributes('aria-selected')).toBe('false')
    })

    it('does not re-emit when the already-selected tab is clicked again', async () => {
      const wrapper = mountTabs('junior')

      await tabByLabel(wrapper, 'Junior').trigger('click')

      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })
  })

  describe('keyboard navigation', () => {
    // Roving tabindex: the strip is one stop in the page's tab order, and the arrow keys move
    // within it. Every unselected tab must be -1, or a recruiter tabbing through the dialog
    // walks through all four.
    it('keeps only the selected tab in the page tab order', () => {
      const wrapper = mountTabs('mid')

      expect(tabs(wrapper).map((tab) => tab.attributes('tabindex'))).toEqual(['-1', '-1', '0', '-1'])
    })

    it('selects and focuses the next option on ArrowRight', async () => {
      const wrapper = mountAttachedTabs('all')

      await tabByLabel(wrapper, 'All').trigger('keydown', { key: 'ArrowRight' })
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('update:modelValue')).toEqual([['junior']])
      // Focus has to follow the selection, or arrowing again would move relative to the tab the
      // recruiter already left.
      expect(document.activeElement).toBe(tabByLabel(wrapper, 'Junior').element)

      wrapper.unmount()
    })

    it('selects the previous option on ArrowLeft', async () => {
      const wrapper = mountTabs('mid')

      await tabByLabel(wrapper, 'Mid').trigger('keydown', { key: 'ArrowLeft' })

      expect(wrapper.emitted('update:modelValue')).toEqual([['junior']])
    })

    it('wraps from the last option to the first on ArrowRight', async () => {
      const wrapper = mountTabs('senior')

      await tabByLabel(wrapper, 'Senior').trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('update:modelValue')).toEqual([['all']])
    })

    it('wraps from the first option to the last on ArrowLeft', async () => {
      const wrapper = mountTabs('all')

      await tabByLabel(wrapper, 'All').trigger('keydown', { key: 'ArrowLeft' })

      expect(wrapper.emitted('update:modelValue')).toEqual([['senior']])
    })

    it('jumps to the first and last options on Home and End', async () => {
      const wrapper = mountTabs('mid')

      await tabByLabel(wrapper, 'Mid').trigger('keydown', { key: 'End' })
      await tabByLabel(wrapper, 'Mid').trigger('keydown', { key: 'Home' })

      expect(wrapper.emitted('update:modelValue')).toEqual([['senior'], ['all']])
    })

    // Only the keys the pattern claims are handled — anything else has to reach the dialog
    // (Escape especially, which callers may use to close it).
    it('ignores unrelated keys instead of swallowing them', async () => {
      const wrapper = mountTabs('all')

      await tabByLabel(wrapper, 'All').trigger('keydown', { key: 'Escape' })
      await tabByLabel(wrapper, 'All').trigger('keydown', { key: 'a' })

      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })
  })

  // Failure/edge path: a caller can legitimately hand this an empty options list (a job whose
  // attached CVs carry no skills at all, for instance). It must render an empty strip rather
  // than throw, and arrow keys on it must not divide by zero or emit anything.
  describe('empty options', () => {
    it('renders an empty tablist without throwing', () => {
      const wrapper = mount(FilterTabs, {
        props: { modelValue: 'all', options: [] as { value: string; label: string }[], label: 'Empty' }
      })

      expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
      expect(tabs(wrapper)).toHaveLength(0)
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })
  })
})
