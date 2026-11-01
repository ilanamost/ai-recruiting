<script setup lang="ts">
import { Loader } from '@lucide/vue'
import { useLoading } from '../lib/loading'

// The one loader pattern for the whole app (.plan/035): mounted once in App.vue, driven entirely
// by lib/loading.ts. The top bar never blocks interaction; the centered spinner is
// pointer-events-none too, so a slow page load never traps the user.
const { isLoaderVisible, isPageLoaderVisible } = useLoading()
</script>

<template>
  <div v-if="isLoaderVisible || isPageLoaderVisible" class="global-loader" role="status" aria-live="polite">
    <div v-if="isLoaderVisible" class="global-loader-bar" aria-hidden="true" />
    <div
      v-if="isPageLoaderVisible"
      class="global-loader-page pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
    >
      <span class="global-loader-spinner" aria-hidden="true">
        <Loader class="size-6" />
      </span>
    </div>
    <span class="sr-only">Loading…</span>
  </div>
</template>
