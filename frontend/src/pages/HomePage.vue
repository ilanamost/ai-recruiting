<script setup lang="ts">
import { computed, ref } from 'vue'
import { Briefcase, ChevronDown, FileText, ShieldCheck, Sparkles } from '@lucide/vue'
import { useAuth } from '../lib/auth'

const { user } = useAuth()

// One ref per section, all starting open (backlog: accordions open by default). Independent
// toggles, not a single-open accordion — a visitor comparing two sections shouldn't have to
// reopen one after checking the other (.plan/022 Open Question 1).
const whatItDoesOpen = ref(true)
const howItWorksOpen = ref(true)
const keyFeaturesOpen = ref(true)

// Icon choices reuse this app's existing vocabulary (.claude/rules/ui-and-styling.md):
// Briefcase = job postings (NavBar "New job", JobsListPage's CV-count badge), FileText = CV
// upload/analysis, Sparkles = the AI/brand mark (NavBar). ShieldCheck is the one new icon —
// nothing in this app stood for role-based access yet (.plan/017).
const features = [
  {
    icon: Briefcase,
    title: 'Job postings',
    text: 'Post a job with a title, location, and description, then attach the CVs you want scored against it.'
  },
  {
    icon: FileText,
    title: 'CV upload and extraction',
    text: 'Upload a CV as PDF. The text is extracted server-side, so formatting never hides relevant experience.'
  },
  {
    icon: Sparkles,
    title: 'AI-powered match scoring',
    text: 'An LLM reads the CV and the job description together and returns a score out of 100 with a plain-language explanation.'
  },
  {
    icon: ShieldCheck,
    title: 'Role-based access',
    text: 'Admins, Recruiters, and Candidates each see only what their role allows — a Candidate only ever sees match results for CVs they uploaded.'
  }
]

const steps = [
  'Upload a CV (PDF) and attach it to a job.',
  'The file is parsed and its text extracted, so the whole CV is readable, not just its keywords.',
  'The CV is matched against that job description by an LLM reading both together.',
  'You get a score out of 100 plus an explanation grounded in specific CV content.'
]

// Per-role next steps (.plan/017 Open Question 2). Every destination is a route the role can
// already reach — Candidate never sees "Post a job", which the router guard blocks anyway.
const canPostJob = computed(() => user.value?.role === 'admin' || user.value?.role === 'recruiter')
</script>

<template>
  <div class="flex flex-col gap-4">
    <section class="card flex flex-col gap-4">
      <!-- The heading wraps the button (not the reverse) — a <button> is phrasing content and
           can't validly contain a heading, which is flow content. -->
      <h1 class="text-lg font-semibold">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
          :aria-expanded="whatItDoesOpen"
          @click="whatItDoesOpen = !whatItDoesOpen"
        >
          What it does
          <ChevronDown class="size-4 shrink-0 transition-transform" :class="{ 'rotate-180': whatItDoesOpen }" />
        </button>
      </h1>
      <div v-if="whatItDoesOpen" class="flex flex-col gap-4">
        <p class="text-sm text-fg-muted">
          AI Recruiting matches a candidate's CV against a job description. A CV goes in as a PDF,
          an LLM reads it alongside the job description, and it comes back with a match score out of 100
          and a plain-language explanation of that score.
        </p>
        <p class="text-sm text-fg-muted">
          It is built first for recruiters and hiring managers, who post a job and want a fast, consistent
          first pass over incoming CVs. Candidates are the second audience: they upload a CV and can see
          the match score and explanation for CVs they uploaded themselves.
        </p>
        <p class="text-sm text-fg-muted">
          It exists because manual CV screening is slow and inconsistent — two reviewers can reach
          different conclusions from the same CV and job description, and neither can fully explain why.
          Keyword-matching ATS tools are faster but shallow: they miss relevant experience phrased
          differently than the job description, and they give no explanation anyone can check.
        </p>
      </div>
    </section>

    <section class="card flex flex-col gap-4">
      <h2 class="text-lg font-semibold">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
          :aria-expanded="howItWorksOpen"
          @click="howItWorksOpen = !howItWorksOpen"
        >
          How it works
          <ChevronDown class="size-4 shrink-0 transition-transform" :class="{ 'rotate-180': howItWorksOpen }" />
        </button>
      </h2>
      <ol v-if="howItWorksOpen" class="flex flex-col gap-3">
        <li v-for="(step, index) in steps" :key="step" class="flex items-start gap-3">
          <span class="dropzone-icon text-sm font-semibold">{{ index + 1 }}</span>
          <span class="pt-2 text-sm text-fg-muted">{{ step }}</span>
        </li>
      </ol>
    </section>

    <section class="card flex flex-col gap-4">
      <h2 class="text-lg font-semibold">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
          :aria-expanded="keyFeaturesOpen"
          @click="keyFeaturesOpen = !keyFeaturesOpen"
        >
          Key features
          <ChevronDown class="size-4 shrink-0 transition-transform" :class="{ 'rotate-180': keyFeaturesOpen }" />
        </button>
      </h2>
      <ul v-if="keyFeaturesOpen" class="flex flex-col gap-4">
        <li v-for="feature in features" :key="feature.title" class="flex items-start gap-3">
          <span class="dropzone-icon">
            <component :is="feature.icon" class="size-4" />
          </span>
          <span class="flex flex-col gap-1">
            <span class="text-sm font-semibold">{{ feature.title }}</span>
            <span class="text-sm text-fg-muted">{{ feature.text }}</span>
          </span>
        </li>
      </ul>
    </section>

    <!-- Deliberately not a `.card` section: this is the page's action row answering "what do I
         do next?", not a fourth block of explanation (.plan/017). -->
    <div class="flex flex-wrap gap-2">
      <template v-if="canPostJob">
        <RouterLink to="/jobs/new" class="btn btn-primary">Post a job</RouterLink>
        <RouterLink to="/jobs" class="btn btn-ghost">View jobs</RouterLink>
      </template>
      <template v-else>
        <RouterLink to="/jobs" class="btn btn-primary">Browse jobs</RouterLink>
        <RouterLink to="/cvs" class="btn btn-ghost">Upload a CV</RouterLink>
      </template>
    </div>
  </div>
</template>
