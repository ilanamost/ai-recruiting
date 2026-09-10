<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

// Presentational only (.plan/028 Step 12): it owns no page state and fetches nothing. The
// parent holds the current page and re-requests on `update:page`, so this works with
// `v-model:page` on both list pages. The rows-per-page control lives in each page's own
// filter strip instead of here (.plan/028 addendum, 2026-09-06) — it reads better grouped with
// the other filters/selects at the top of the page than bolted onto the bottom pager.
const props = defineProps<{
  page: number
  total: number
  limit: number
}>()

const emit = defineEmits<{ 'update:page': [page: number] }>()

// Never below 1: an empty list still reads "Page 1 of 1" rather than "of 0". A `limit` of 0
// would divide to Infinity, so it is floored to 1 as well — the server clamps `limit` to at
// least 1 (api-contract.yaml), this just refuses to render nonsense if it ever doesn't.
const totalPages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.limit))))

const isFirstPage = computed(() => props.page <= 1)
const isLastPage = computed(() => props.page >= totalPages.value)

function goPrev() {
  if (!isFirstPage.value) {
    emit('update:page', props.page - 1)
  }
}

function goNext() {
  if (!isLastPage.value) {
    emit('update:page', props.page + 1)
  }
}
</script>

<template>
  <!-- Same filter-strip treatment JobsListPage's row 2 uses (bg-bg + rounded-md + p-3), so the
       pager reads as page furniture rather than another content card. -->
  <nav class="flex items-center justify-between gap-3 rounded-md bg-bg p-3" aria-label="Pagination">
    <button type="button" class="btn btn-ghost" :disabled="isFirstPage" aria-label="Previous page" @click="goPrev">
      <ChevronLeft class="size-4" />
      Prev
    </button>

    <!-- aria-live so a screen reader hears the page change, which is otherwise only visible in
         the list content that swapped out underneath. -->
    <p class="text-sm text-fg-muted" aria-live="polite">Page {{ page }} of {{ totalPages }}</p>

    <button type="button" class="btn btn-ghost" :disabled="isLastPage" aria-label="Next page" @click="goNext">
      Next
      <ChevronRight class="size-4" />
    </button>
  </nav>
</template>
