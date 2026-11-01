import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '../App.vue'
import router from '../router'
import { markAppReady, trackPageLoad } from './loading'

// Plain mount (.plan/035): the app mounts straight away and AppLoader shows the centered spinner
// while the initial navigation (the router guard's fetchMe session check) runs — the separate
// pre-mount startup loader is gone.
export async function startApplication(): Promise<void> {
  try {
    const app = createApp(App)
    app.use(createPinia())
    app.use(router)
    app.mount('#app')

    await trackPageLoad(() => router.isReady()).catch((error: unknown) => {
      console.error('Initial route navigation failed', error)
    })
  } catch (error) {
    console.error('Application startup failed', error)
  } finally {
    markAppReady()
  }
}
