import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '../App.vue'
import router from '../router'
import { withStartupLoader } from './initialLoader'

export async function startApplication(): Promise<void> {
  try {
    await withStartupLoader(async () => {
      const app = createApp(App)
      app.use(createPinia())
      app.use(router)

      await router.isReady().catch((error: unknown) => {
        console.error('Initial route navigation failed', error)
      })

      app.mount('#app')
    })
  } catch (error) {
    console.error('Application startup failed', error)
  }
}
