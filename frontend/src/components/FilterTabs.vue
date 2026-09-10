<script setup lang="ts" generic="T extends string">
import { nextTick, ref } from 'vue'

// Presentational only (.plan/029 Step 10), the same contract as Pager.vue: it owns no filter
// state and fetches nothing. The parent holds the selection and reacts to `update:modelValue`,
// so this works with `v-model` at any call site.
//
// This is the app's first tab pattern — nothing else in `frontend/src` uses role="tab" — so it
// follows the WAI-ARIA tabs pattern from scratch rather than matching a local precedent:
// a `tablist` container, one `tab` button per option carrying `aria-selected`, and a roving
// tabindex so the strip is a single stop in the page's tab order, with arrow keys moving
// between the options inside it.
//
// Generic over the option value so a caller keeps its own union type (e.g.
// `ExperienceLevel | 'all'`) end to end instead of widening to `string` and casting it back.
const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  // Names the group for a screen reader — the tabs are unlabelled buttons without it. Named
  // `label` rather than `ariaLabel` because a declared prop is matched by its exact name: a
  // caller writing the natural `aria-label="…"` would fall through to a plain attribute and
  // leave this prop missing.
  label: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const tabEls = ref<(HTMLButtonElement | null)[]>([])

function setTabRef(el: Element | null, index: number) {
  tabEls.value[index] = el as HTMLButtonElement | null
}

function select(value: T) {
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
  }
}

// Arrow keys wrap around the strip, and selection follows focus — the automatic-activation
// half of the ARIA tabs pattern, which is the right one here because selecting a tab only
// re-filters an already-loaded client-side list and costs nothing.
function moveTo(index: number) {
  const count = props.options.length
  if (count === 0) {
    return
  }
  const wrapped = (index + count) % count
  select(props.options[wrapped].value)
  void nextTick(() => tabEls.value[wrapped]?.focus())
}

function onKeydown(event: KeyboardEvent, index: number) {
  const keys: Record<string, number> = {
    ArrowRight: index + 1,
    ArrowLeft: index - 1,
    Home: 0,
    End: props.options.length - 1
  }
  const target = keys[event.key]
  if (target === undefined) {
    return
  }
  // Home/End would otherwise scroll the modal's list out from under the strip.
  event.preventDefault()
  moveTo(target)
}
</script>

<template>
  <div
    class="inline-flex items-center gap-1 rounded-md border border-border bg-surface p-1"
    role="tablist"
    :aria-label="label"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="(el) => setTabRef(el as Element | null, index)"
      type="button"
      role="tab"
      :aria-selected="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      class="rounded-md px-3 py-1 text-sm font-medium transition-colors"
      :class="
        option.value === modelValue
          ? 'bg-primary text-primary-fg'
          : 'text-fg-muted hover:bg-bg hover:text-fg'
      "
      @click="select(option.value)"
      @keydown="onKeydown($event, index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
