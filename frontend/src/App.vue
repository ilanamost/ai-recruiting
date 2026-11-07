<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import NavBar from './components/NavBar.vue'
import AppLoader from './components/AppLoader.vue'
import { useLoading } from './lib/loading'

// The shell waits for startup's initial navigation (session check) so a signed-out NavBar never
// flashes first; AppLoader covers that wait with its centered spinner (.plan/035).
const { isAppReady } = useLoading()
</script>

<template>
  <Toaster position="top-right" richColors closeButton />
  <Toaster id="center" class="toaster-center" position="top-center" richColors />
  <AppLoader />

  <!-- .plan/036: overflow-x-clip stops any stray wide child from giving the iPhone a sideways
       scroll; <main>'s padding is the --page-pad token (1.5rem, 2rem from sm) widened to the
       safe-area insets so content never sits under the rounded corners or home indicator. -->
  <div v-if="isAppReady" class="flex min-h-screen flex-col overflow-x-clip">
    <NavBar />
    <main
      class="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-6 pt-(--page-pad) pr-[max(var(--page-pad),env(safe-area-inset-right))] pb-[max(var(--page-pad),env(safe-area-inset-bottom))] pl-[max(var(--page-pad),env(safe-area-inset-left))]"
    >
      <RouterView />
    </main>
  </div>
</template>
