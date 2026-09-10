<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import NavBar from './components/NavBar.vue'
</script>

<template>
  <Toaster position="top-right" richColors closeButton />
  <Toaster id="center" class="toaster-center" position="top-center" richColors />

  <div class="flex min-h-screen flex-col">
    <NavBar />
    <main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 sm:p-8">
      <RouterView />
    </main>
  </div>
</template>
