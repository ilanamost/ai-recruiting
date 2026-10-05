import { createApp } from 'vue'
import InitialLoader from '../components/InitialLoader.vue'

export async function withStartupLoader(initialize: () => Promise<void>): Promise<void> {
  const target = document.getElementById('app-loader')
  if (!target) {
    throw new Error('Initial loader mount point was not found')
  }

  const loader = createApp(InitialLoader)
  loader.mount(target)

  try {
    await initialize()
  } finally {
    loader.unmount()
  }
}
