<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { ChevronDown, Eye, EyeOff } from '@lucide/vue'
import { ApiError } from '../lib/http'
import { useAuth } from '../lib/auth'
import { TOAST } from '../lib/toastMessages'

const router = useRouter()
const { login, signup } = useAuth()

const mode = ref<'login' | 'signup'>('login')

const name = ref('')
const email = ref('')
const password = ref('')
const role = ref<'' | 'recruiter' | 'candidate'>('')
const showPassword = ref(false)

const submitting = ref(false)
const submitted = ref(false)
const errorMessage = ref('')

function switchMode(next: 'login' | 'signup') {
  mode.value = next
  errorMessage.value = ''
  submitted.value = false
}

const nameError = computed(() => (mode.value === 'signup' && !name.value.trim() ? 'Name is required' : ''))
const emailError = computed(() => (!email.value.trim() ? 'Email is required' : ''))
const passwordError = computed(() => {
  if (!password.value) return 'Password is required'
  if (mode.value === 'signup' && password.value.length < 8) return 'Password must be at least 8 characters'
  return ''
})
const roleError = computed(() => (mode.value === 'signup' && !role.value ? 'Please select a role' : ''))

const hasErrors = computed(
  () => Boolean(nameError.value) || Boolean(emailError.value) || Boolean(passwordError.value) || Boolean(roleError.value)
)

async function onSubmit() {
  submitted.value = true
  if (hasErrors.value) {
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    if (mode.value === 'login') {
      await login(email.value, password.value)
      toast.success(TOAST.success.authLoggedIn)
    } else {
      await signup(name.value, email.value, password.value, role.value as 'recruiter' | 'candidate')
      toast.success(TOAST.success.authAccountCreated)
    }
    router.push('/')
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : 'Something went wrong'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-sm flex-col gap-6">
    <div class="flex flex-col gap-1 text-center">
      <h1 class="text-lg font-semibold">{{ mode === 'login' ? 'Log in' : 'Create an account' }}</h1>
      <p class="text-sm text-fg-muted">
        {{ mode === 'login' ? 'Welcome back to AI Recruiting.' : 'Get started with AI Recruiting.' }}
      </p>
    </div>

    <form class="card flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
      <label v-if="mode === 'signup'">
        <span>Name *</span>
        <input
          v-model="name"
          type="text"
          placeholder="Jane Doe"
          :class="{ 'input-invalid': submitted && nameError }"
        />
        <p v-if="submitted && nameError" class="field-error">{{ nameError }}</p>
      </label>

      <label>
        <span>Email *</span>
        <input
          v-model="email"
          type="email"
          placeholder="jane@example.com"
          :class="{ 'input-invalid': submitted && emailError }"
        />
        <p v-if="submitted && emailError" class="field-error">{{ emailError }}</p>
      </label>

      <label>
        <span>Password *</span>
        <div class="password-input-wrap">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="••••••••"
            :class="{ 'input-invalid': submitted && passwordError }"
          />
          <button
            type="button"
            class="password-toggle"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <EyeOff v-if="showPassword" class="size-4" />
            <Eye v-else class="size-4" />
          </button>
        </div>
        <p v-if="submitted && passwordError" class="field-error">{{ passwordError }}</p>
      </label>

      <label v-if="mode === 'signup'">
        <span>Role *</span>
        <div class="select-wrap">
          <select v-model="role" :class="{ 'input-invalid': submitted && roleError }">
            <option value="" disabled>Select a role</option>
            <option value="recruiter">Recruiter</option>
            <option value="candidate">Candidate</option>
          </select>
          <ChevronDown class="select-arrow size-4" />
        </div>
        <p v-if="submitted && roleError" class="field-error">{{ roleError }}</p>
      </label>

      <p v-if="errorMessage" class="text-sm text-danger">{{ errorMessage }}</p>

      <button type="submit" class="btn btn-primary" :disabled="submitting">
        {{ submitting ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up' }}
      </button>
    </form>

    <p class="text-center text-sm text-fg-muted">
      <template v-if="mode === 'login'">
        Don't have an account?
        <button type="button" class="font-semibold text-primary" @click="switchMode('signup')">Sign up</button>
      </template>
      <template v-else>
        Already have an account?
        <button type="button" class="font-semibold text-primary" @click="switchMode('login')">Log in</button>
      </template>
    </p>
  </section>
</template>
