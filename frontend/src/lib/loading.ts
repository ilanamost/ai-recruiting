// Global loading state (.plan/035) — mirrors lib/auth.ts / lib/theme.ts's module-level reactive
// style so AppLoader, startup, and the pages share one source of truth.
//
// Two independent counters:
// - `pendingCount`: every in-flight API request. `apiFetch` wraps itself in `trackRequest`, so no
//   caller needs its own code. Drives the slim, non-blocking top bar.
// - `pagePendingCount`: page-level loads — the initial route navigation and a page's own
//   blocking content fetch (list pages, the Manage CVs modal, match scoring). Drives the centered
//   spinner that replaces the old per-page "Loading …" rows and the old pre-mount startup loader.
//
// Each counter feeds an anti-flicker visibility flag: a load shorter than LOADER_SHOW_DELAY_MS
// never shows the loader, and once shown it stays up for at least LOADER_MIN_VISIBLE_MS.

import { computed, ref, watch, type Ref } from 'vue'

export const LOADER_SHOW_DELAY_MS = 150
export const LOADER_MIN_VISIBLE_MS = 300

const pendingCount = ref(0)
const pagePendingCount = ref(0)
// False until startup's initial navigation has settled; App.vue keeps the shell hidden until
// then so a signed-out NavBar never flashes before the session check resolves.
const isAppReady = ref(false)

const isLoading = computed(() => pendingCount.value > 0)
const isPageLoading = computed(() => pagePendingCount.value > 0)

function createVisibility(active: Ref<boolean>): Ref<boolean> {
  const visible = ref(false)
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let shownAt = 0

  watch(
    active,
    (isActive) => {
      if (isActive) {
        // Work restarted while the minimum-visible window was still running: keep showing.
        if (hideTimer) {
          clearTimeout(hideTimer)
          hideTimer = null
          return
        }
        if (visible.value || showTimer) {
          return
        }
        showTimer = setTimeout(() => {
          showTimer = null
          visible.value = true
          shownAt = Date.now()
        }, LOADER_SHOW_DELAY_MS)
        return
      }

      // Settled before the delay elapsed: never show at all.
      if (showTimer) {
        clearTimeout(showTimer)
        showTimer = null
        return
      }
      if (!visible.value) {
        return
      }
      const remaining = LOADER_MIN_VISIBLE_MS - (Date.now() - shownAt)
      if (remaining <= 0) {
        visible.value = false
        return
      }
      hideTimer = setTimeout(() => {
        hideTimer = null
        visible.value = false
      }, remaining)
    },
    { flush: 'sync' }
  )

  return visible
}

const isLoaderVisible = createVisibility(isLoading)
const isPageLoaderVisible = createVisibility(isPageLoading)

async function track<T>(counter: Ref<number>, work: () => Promise<T>): Promise<T> {
  counter.value += 1
  try {
    return await work()
  } finally {
    // Always decrement, success or failure — a counter that drifts would pin the loader on.
    counter.value -= 1
  }
}

export function trackRequest<T>(work: () => Promise<T>): Promise<T> {
  return track(pendingCount, work)
}

export function trackPageLoad<T>(work: () => Promise<T>): Promise<T> {
  return track(pagePendingCount, work)
}

export function markAppReady(): void {
  isAppReady.value = true
}

export function useLoading() {
  return {
    pendingCount,
    pagePendingCount,
    isLoading,
    isPageLoading,
    isLoaderVisible,
    isPageLoaderVisible,
    isAppReady
  }
}
