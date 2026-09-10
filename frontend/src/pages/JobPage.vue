<script setup lang="ts">
import { useRouter } from 'vue-router'
import JobForm from '../components/JobForm.vue'

const router = useRouter()

function onCreated() {
  router.push('/jobs')
}
</script>

<template>
  <JobForm @created="onCreated" />
</template>
