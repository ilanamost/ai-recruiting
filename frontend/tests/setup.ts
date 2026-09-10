import { afterEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// Component tests across this suite mount but rarely unmount explicitly; without this,
// stale wrapper trees from earlier tests keep reacting to shared mocked state (e.g. the
// `useAuth` mock's `user` ref) mutated by later tests, causing cross-test pollution.
enableAutoUnmount(afterEach)

// jsdom does not implement window.matchMedia; the app uses it to detect the
// system color-scheme preference for the light/dark theme default.
// The `typeof window` guard is for the few specs that opt into the node environment
// (e.g. vite-config-base.test.ts, which imports vite.config.ts directly).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList
}
