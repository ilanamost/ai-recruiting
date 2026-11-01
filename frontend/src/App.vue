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

  <div v-if="isAppReady" class="flex min-h-screen flex-col">
    <NavBar />
    <main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <RouterView />
    </main>
  </div>
</template>
