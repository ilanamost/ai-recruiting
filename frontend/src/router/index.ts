import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import JobPage from '../pages/JobPage.vue'
import JobsListPage from '../pages/JobsListPage.vue'
import CvsListPage from '../pages/CvsListPage.vue'
import LoginPage from '../pages/LoginPage.vue'
import SettingsPage from '../pages/SettingsPage.vue'
import { useAuth } from '../lib/auth'

const router = createRouter({
  // BASE_URL is derived by Vite from vite.config.ts's `base`, so the router follows the
  // deploy path automatically ('/' locally, '/ai-dev-agents/' on GitHub Pages). History mode
  // is deliberate — GitHub Pages SPA routing is handled by a 404.html copy in CI, not hash mode.
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/jobs', name: 'jobs-list', component: JobsListPage },
    { path: '/jobs/new', name: 'job-new', component: JobPage },
    { path: '/cvs', name: 'cvs-list', component: CvsListPage },
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/settings', name: 'settings', component: SettingsPage },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

const { user, fetchMe } = useAuth()

// fetchMe() is only ever called once per app load (memoized here) — after that, every guard
// check reads the already-reactive `user` ref, which login/signup/logout keep up to date.
let initialAuthCheck: Promise<unknown> | null = null

router.beforeEach(async (to) => {
  if (!initialAuthCheck) {
    initialAuthCheck = fetchMe()
  }
  await initialAuthCheck

  const isAuthenticated = !!user.value

  if (!isAuthenticated) {
    return to.path === '/login' ? true : '/login'
  }

  // '/' is the home page as of .plan/017 — an explainer every role is meant to land on, so it
  // is no longer role-gated. Only the job-creation form, now at /jobs/new, stays Admin/Recruiter.
  if (user.value?.role === 'candidate' && to.name === 'job-new') {
    return '/jobs'
  }

  // Named-route comparison, not a path string compare: vue-router's default strict:false/
  // sensitive:false matching means '/cvs/' and '/CVS' both resolve to this same route, and a
  // to.path === '/cvs' check would have missed both (QA finding, .plan/015).
  if (user.value?.role === 'recruiter' && to.name === 'cvs-list') {
    return '/jobs'
  }

  return true
})

export default router
