<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Briefcase, List, LogOut, Menu, Moon, Settings, Sparkles, Sun, User, UserCog, Users, X } from '@lucide/vue'
import { useTheme } from '../lib/theme'
import { useAuth } from '../lib/auth'

const route = useRoute()
const router = useRouter()
const { theme, toggleTheme } = useTheme()
const { user, profileImageUrl, logout } = useAuth()

const menuOpen = ref(false)
const mobileMenuOpen = ref(false)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

function goToSettings() {
  closeMenu()
  router.push('/settings')
}

async function onLogout() {
  closeMenu()
  await logout()
  router.push('/login')
}
</script>

<template>
  <nav class="navbar">
    <!-- A RouterLink again (.plan/017), reversing .plan/014: "/" is now the home page — a real
         destination for every role — so the pointer cursor is honest here. -->
    <RouterLink
      to="/"
      class="navbar-brand"
      :class="{ 'is-active': route.name === 'home' }"
      @click="closeMobileMenu"
    >
      <Sparkles class="size-4" />
      <!-- .plan/019: the wordmark is its own element so the mobile breakpoint can hide it
           without touching the icon beside it. -->
      <span class="navbar-brand-text">AI Recruiting</span>
    </RouterLink>

    <button
      type="button"
      class="navbar-hamburger"
      :aria-expanded="mobileMenuOpen"
      :aria-label="mobileMenuOpen ? 'Close menu' : 'Open menu'"
      @click="toggleMobileMenu"
    >
      <X v-if="mobileMenuOpen" class="size-4" />
      <Menu v-else class="size-4" />
    </button>

    <!-- Teleported to <body> (QA finding, .plan/019): <nav> has backdrop-filter, which makes it
         the containing block for any position:fixed descendant, clipping a nested overlay to
         the navbar's own strip instead of the full viewport — clicking actual page content
         would never have closed this menu. z-10 keeps it below .navbar's z-20 stacking context
         (and everything inside it, including the open panel) once it's a body-level sibling. -->
    <Teleport to="body">
      <div v-if="mobileMenuOpen" class="navbar-mobile-overlay fixed inset-0 z-10" @click="closeMobileMenu" />
    </Teleport>

    <div class="navbar-links" :class="{ 'is-open': mobileMenuOpen }">
      <RouterLink
        v-if="user?.role !== 'candidate'"
        to="/jobs/new"
        class="navbar-link"
        :class="{ 'is-active': route.name === 'job-new' }"
        @click="closeMobileMenu"
      >
        <Briefcase class="size-4" />
        New job
      </RouterLink>
      <RouterLink
        to="/jobs"
        class="navbar-link"
        :class="{ 'is-active': route.name === 'jobs-list' }"
        @click="closeMobileMenu"
      >
        <List class="size-4" />
        Jobs
      </RouterLink>
      <RouterLink
        v-if="user?.role !== 'recruiter'"
        to="/cvs"
        class="navbar-link"
        :class="{ 'is-active': route.name === 'cvs-list' }"
        @click="closeMobileMenu"
      >
        <Users class="size-4" />
        CVs
      </RouterLink>
    </div>

    <div class="navbar-actions">
      <button
        type="button"
        class="theme-toggle"
        :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        @click="toggleTheme"
      >
        <Sun v-if="theme === 'dark'" class="size-4" />
        <Moon v-else class="size-4" />
      </button>

      <span class="avatar avatar-sm">
        <img v-if="profileImageUrl" :src="profileImageUrl" alt="Profile" />
        <User v-else class="size-4" />
      </span>

      <div class="relative">
        <button type="button" class="theme-toggle" aria-label="Settings" @click="toggleMenu">
          <Settings class="size-4" />
        </button>

        <!-- Same containing-block fix as the mobile-menu overlay above: teleported so
             backdrop-filter on <nav> doesn't clip this to the navbar strip either. -->
        <Teleport to="body">
          <div v-if="menuOpen" class="navbar-settings-overlay fixed inset-0 z-10" @click="closeMenu" />
        </Teleport>

        <div v-if="menuOpen" class="navbar-menu">
          <button type="button" class="navbar-menu-item" @click="goToSettings">
            <UserCog class="size-4" />
            User settings
          </button>
          <button type="button" class="navbar-menu-item" @click="onLogout">
            <LogOut class="size-4" />
            Logout
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>
