<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Camera, ChevronDown, Eye, EyeOff, X } from '@lucide/vue'
import { ApiError } from '../lib/http'
import { useAuth } from '../lib/auth'
import { TOAST } from '../lib/toastMessages'

const { user, profileImageUrl, updateProfile, fetchMe } = useAuth()

const name = ref('')
const email = ref('')
const role = ref<'recruiter' | 'candidate' | 'admin'>('candidate')
const currentPassword = ref('')
const newPassword = ref('')
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const profileImageFile = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const submitting = ref(false)
const removingImage = ref(false)
const submitted = ref(false)
const errorMessage = ref('')

const isAdmin = computed(() => user.value?.role === 'admin')
const hasImage = computed(() => Boolean(previewUrl.value || profileImageUrl.value))

function syncFromUser() {
  name.value = user.value?.name ?? ''
  email.value = user.value?.email ?? ''
  role.value = user.value?.role ?? 'candidate'
}

onMounted(async () => {
  if (!user.value) {
    await fetchMe()
  }
  syncFromUser()
})

onBeforeUnmount(() => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
})

function triggerFilePicker() {
  fileInput.value?.click()
}

function onImageChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  profileImageFile.value = file

  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
  if (file) {
    previewUrl.value = URL.createObjectURL(file)
  }
}

async function removeImage() {
  // A not-yet-saved local selection just gets discarded locally.
  if (profileImageFile.value) {
    profileImageFile.value = null
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value)
      previewUrl.value = null
    }
    if (fileInput.value) {
      fileInput.value.value = ''
    }
    return
  }

  if (!profileImageUrl.value) {
    return
  }

  removingImage.value = true
  try {
    await updateProfile({ remove_profile_image: true })
    toast.success(TOAST.success.settingsImageRemoved)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : TOAST.error.settingsImageRemoveFailed)
  } finally {
    removingImage.value = false
  }
}

const nameError = computed(() => (!name.value.trim() ? 'Name is required' : ''))
const newPasswordError = computed(() => {
  if (!newPassword.value) return ''
  if (newPassword.value.length < 8) return 'New password must be at least 8 characters'
  return ''
})
const currentPasswordError = computed(() =>
  newPassword.value && !currentPassword.value ? 'Current password is required to set a new password' : ''
)

const hasErrors = computed(
  () => Boolean(nameError.value) || Boolean(newPasswordError.value) || Boolean(currentPasswordError.value)
)

async function onSubmit() {
  submitted.value = true
  if (hasErrors.value) {
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    await updateProfile({
      name: name.value,
      email: email.value,
      ...(!isAdmin.value && role.value !== user.value?.role ? { role: role.value as 'recruiter' | 'candidate' } : {}),
      ...(newPassword.value
        ? { new_password: newPassword.value, current_password: currentPassword.value }
        : {}),
      ...(profileImageFile.value ? { profile_image: profileImageFile.value } : {})
    })
    currentPassword.value = ''
    newPassword.value = ''
    submitted.value = false
    // Drop the now-saved local selection so the avatar falls back to the (cache-busted)
    // profileImageUrl, and so a follow-up removeImage() hits the server instead of mistaking a
    // stale local file for an unsaved selection to discard.
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value)
      previewUrl.value = null
    }
    profileImageFile.value = null
    toast.success(TOAST.success.settingsUpdated)
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : 'Failed to update settings'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-md flex-col gap-6">
    <h1 class="text-lg font-semibold">User settings</h1>

    <form class="card flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
      <div class="flex items-center gap-4">
        <div class="avatar-picker">
          <button
            type="button"
            class="avatar avatar-lg avatar-picker-trigger"
            :aria-label="hasImage ? 'Replace profile image' : 'Add profile image'"
            @click="triggerFilePicker"
          >
            <img v-if="previewUrl || profileImageUrl" :src="(previewUrl ?? profileImageUrl) as string" alt="Profile" />
            <span v-else class="avatar-picker-placeholder">
              <Camera class="size-5" />
              <span>Add photo</span>
            </span>
          </button>
          <button
            v-if="hasImage"
            type="button"
            class="avatar-picker-remove"
            aria-label="Remove profile image"
            :disabled="removingImage"
            @click.stop="removeImage"
          >
            <X class="size-3" />
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            class="hidden"
            @change="onImageChange"
          />
        </div>
        <p class="text-sm text-fg-muted">Click the circle to {{ hasImage ? 'replace' : 'add' }} a photo.</p>
      </div>

      <label>
        <span>Name *</span>
        <input v-model="name" type="text" :class="{ 'input-invalid': submitted && nameError }" />
        <p v-if="submitted && nameError" class="field-error">{{ nameError }}</p>
      </label>

      <label>
        <span>Email</span>
        <input v-model="email" type="email" />
      </label>

      <label>
        <span>Role</span>
        <div v-if="!isAdmin" class="select-wrap">
          <select v-model="role">
            <option value="recruiter">Recruiter</option>
            <option value="candidate">Candidate</option>
          </select>
          <ChevronDown class="select-arrow size-4" />
        </div>
        <p v-else class="text-sm text-fg">Admin <span class="text-fg-muted">(set via database)</span></p>
      </label>

      <fieldset class="flex flex-col gap-3 border-t border-border pt-4">
        <legend class="text-sm font-medium text-fg-muted">Change password</legend>
        <label>
          <span>Current password</span>
          <div class="password-input-wrap">
            <input
              v-model="currentPassword"
              :type="showCurrentPassword ? 'text' : 'password'"
              :class="{ 'input-invalid': submitted && currentPasswordError }"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showCurrentPassword ? 'Hide password' : 'Show password'"
              @click="showCurrentPassword = !showCurrentPassword"
            >
              <EyeOff v-if="showCurrentPassword" class="size-4" />
              <Eye v-else class="size-4" />
            </button>
          </div>
          <p v-if="submitted && currentPasswordError" class="field-error">{{ currentPasswordError }}</p>
        </label>
        <label>
          <span>New password</span>
          <div class="password-input-wrap">
            <input
              v-model="newPassword"
              :type="showNewPassword ? 'text' : 'password'"
              :class="{ 'input-invalid': submitted && newPasswordError }"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showNewPassword ? 'Hide password' : 'Show password'"
              @click="showNewPassword = !showNewPassword"
            >
              <EyeOff v-if="showNewPassword" class="size-4" />
              <Eye v-else class="size-4" />
            </button>
          </div>
          <p v-if="submitted && newPasswordError" class="field-error">{{ newPasswordError }}</p>
        </label>
      </fieldset>

      <p v-if="errorMessage" class="text-sm text-danger">{{ errorMessage }}</p>

      <button type="submit" class="btn btn-primary self-start" :disabled="submitting">
        {{ submitting ? 'Saving…' : 'Save changes' }}
      </button>
    </form>
  </section>
</template>
