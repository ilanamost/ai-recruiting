<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CircleCheck, CircleX, Loader } from '@lucide/vue'
import { useMatchStore } from '../stores/match'
import type { Match } from '../types'

const props = defineProps<{ resumeId?: string; jobId?: string; matchId?: string }>()
const emit = defineEmits<{ resolved: [match: Match] }>()

const matchStore = useMatchStore()

// Kept local, per .plan/018 Step 9: no caller outside this component observes match state, and
// the failure is rendered inside this card rather than toasted.
const match = ref<Match | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const scoreBand = computed(() => {
  const score = match.value?.score ?? 0
  if (score >= 75) return 'score-high'
  if (score >= 50) return 'score-mid'
  return 'score-low'
})

// Reveal animation (.plan/014), deliberately on a different threshold than the colour bands
// above: the backlog's celebratory case is "over 80", which is stricter than score-high (75).
const isHighScore = computed(() => (match.value?.score ?? 0) > 80)

// Reuses the already-shipped score-low band (< 50) rather than inventing a third threshold.
const isLowScore = computed(() => scoreBand.value === 'score-low')

async function run() {
  loading.value = true
  error.value = null
  match.value = null
  try {
    const resolved = props.matchId
      ? await matchStore.getMatch(props.matchId)
      : await matchStore.createMatch({ resume_id: props.resumeId!, job_id: props.jobId! })
    match.value = resolved
    emit('resolved', resolved)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to score the match'
  } finally {
    loading.value = false
  }
}

watch(() => [props.matchId, props.resumeId, props.jobId], run, { immediate: true })
</script>

<template>
  <section class="card flex flex-col gap-4">
    <h2 class="text-lg font-semibold">Match result</h2>

    <div v-if="loading" class="flex items-center gap-2 text-fg-muted">
      <Loader class="size-4 animate-spin" />
      <span>Scoring the match…</span>
    </div>

    <div v-else-if="error" class="flex items-center gap-2 text-danger">
      <CircleX class="size-4" />
      <span>{{ error }}</span>
    </div>

    <div v-else-if="match" class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <CircleCheck class="size-4 text-success" />
        <span
          class="text-3xl font-bold"
          :class="{ 'score-reveal-pop': isHighScore, 'fade-in': isLowScore }"
        >
          {{ match.score }}<span class="text-base font-normal text-fg-muted">/100</span>
        </span>
      </div>
      <div class="score-bar">
        <div
          class="score-bar-fill"
          :class="[scoreBand, { 'score-reveal-glow': isHighScore, 'fade-in': isLowScore }]"
          :style="{ width: `${match.score}%` }"
        />
      </div>
      <p class="text-sm text-fg-muted">{{ match.explanation }}</p>
    </div>
  </section>
</template>
