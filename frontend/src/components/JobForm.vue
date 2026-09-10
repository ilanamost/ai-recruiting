<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { TOAST } from '../lib/toastMessages'
import { useJobStore } from '../stores/job'
import type { Job } from '../types'

const emit = defineEmits<{ created: [job: Job] }>()

const jobStore = useJobStore()

const orgId = ref('demo-org')
const title = ref('')
const location = ref('')
const description = ref('')
const submitting = ref(false)

async function onSubmit() {
  if (!title.value.trim() || !description.value.trim()) {
    toast.error(TOAST.error.jobValidationRequired)
    return
  }

  submitting.value = true
  try {
    const job = await jobStore.createJob({
      org_id: orgId.value,
      title: title.value,
      description: description.value,
      location: location.value
    })
    toast.success(TOAST.success.jobCreated, { toasterId: 'center' })
    emit('created', job)
  } catch (err) {
    // .plan/023: the store lets the rejection through, so the form reports it and stays open.
    toast.error(err instanceof Error ? err.message : TOAST.error.jobCreateFailed)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="card flex flex-col gap-4" @submit.prevent="onSubmit">
    <h2 class="text-lg font-semibold">Job description</h2>

    <label>
      <span>Title</span>
      <input v-model="title" type="text" placeholder="Backend Engineer" />
    </label>

    <label>
      <span>Location (optional)</span>
      <input v-model="location" type="text" placeholder="Berlin, Remote" />
    </label>

    <label>
      <span>Description</span>
      <textarea v-model="description" rows="6" placeholder="Paste the job description here" />
    </label>

    <button type="submit" :disabled="submitting" class="btn btn-primary self-start">
      {{ submitting ? 'Creating…' : 'Create job' }}
    </button>
  </form>
</template>
