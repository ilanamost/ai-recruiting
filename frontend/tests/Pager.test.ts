import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import Pager from '../src/components/Pager.vue'

// .plan/028 Step 12/15. Pager owns no data and fetches nothing — it renders the page position
// its parent hands it and emits where the parent should go next, so every test here is about
// exactly those two things.
function mountPager(props: { page: number; total: number; limit: number }) {
  return mount(Pager, { props })
}

function prevButton(wrapper: ReturnType<typeof mountPager>) {
  return wrapper.get('button[aria-label="Previous page"]')
}

function nextButton(wrapper: ReturnType<typeof mountPager>) {
  return wrapper.get('button[aria-label="Next page"]')
}

describe('Pager', () => {
  describe('page count label', () => {
    it('renders the current page out of the total derived from total/limit', () => {
      const wrapper = mountPager({ page: 2, total: 25, limit: 10 })

      // 25 items at 10 per page is 3 pages, the last one partial.
      expect(wrapper.text()).toContain('Page 2 of 3')
    })

    it('reads "Page 1 of 1" for an empty list rather than "of 0"', () => {
      const wrapper = mountPager({ page: 1, total: 0, limit: 10 })

      expect(wrapper.text()).toContain('Page 1 of 1')
    })

    it('counts an exactly-full last page as one page, not two', () => {
      const wrapper = mountPager({ page: 1, total: 20, limit: 10 })

      expect(wrapper.text()).toContain('Page 1 of 2')
    })
  })

  describe('disabled states', () => {
    it('disables Prev and enables Next on the first page', () => {
      const wrapper = mountPager({ page: 1, total: 25, limit: 10 })

      expect(prevButton(wrapper).attributes('disabled')).toBeDefined()
      expect(nextButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('enables Prev and disables Next on the last page', () => {
      const wrapper = mountPager({ page: 3, total: 25, limit: 10 })

      expect(prevButton(wrapper).attributes('disabled')).toBeUndefined()
      expect(nextButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('enables both on a middle page', () => {
      const wrapper = mountPager({ page: 2, total: 25, limit: 10 })

      expect(prevButton(wrapper).attributes('disabled')).toBeUndefined()
      expect(nextButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('disables both when everything fits on one page', () => {
      const wrapper = mountPager({ page: 1, total: 4, limit: 10 })

      expect(prevButton(wrapper).attributes('disabled')).toBeDefined()
      expect(nextButton(wrapper).attributes('disabled')).toBeDefined()
    })
  })

  describe('update:page', () => {
    it('emits the next page number when Next is clicked', async () => {
      const wrapper = mountPager({ page: 2, total: 25, limit: 10 })

      await nextButton(wrapper).trigger('click')

      expect(wrapper.emitted('update:page')).toEqual([[3]])
    })

    it('emits the previous page number when Prev is clicked', async () => {
      const wrapper = mountPager({ page: 2, total: 25, limit: 10 })

      await prevButton(wrapper).trigger('click')

      expect(wrapper.emitted('update:page')).toEqual([[1]])
    })

    // Failure path: the parent re-fetches on every emit, so a boundary click that slipped past
    // the disabled attribute (a programmatic click, or a stale render) must not emit page 0 or
    // a page past the end.
    it('emits nothing when Prev is clicked on the first page', async () => {
      const wrapper = mountPager({ page: 1, total: 25, limit: 10 })

      await prevButton(wrapper).trigger('click')

      expect(wrapper.emitted('update:page')).toBeUndefined()
    })

    it('emits nothing when Next is clicked on the last page', async () => {
      const wrapper = mountPager({ page: 3, total: 25, limit: 10 })

      await nextButton(wrapper).trigger('click')

      expect(wrapper.emitted('update:page')).toBeUndefined()
    })

    it('does not change the page itself — the parent owns it', async () => {
      const wrapper = mountPager({ page: 2, total: 25, limit: 10 })

      await nextButton(wrapper).trigger('click')

      // Still "of 3" on page 2: nothing moves until the parent passes a new `page` prop back.
      expect(wrapper.text()).toContain('Page 2 of 3')
    })
  })
})
