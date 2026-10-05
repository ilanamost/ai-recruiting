import { afterEach, describe, expect, it } from 'vitest'
import { withStartupLoader } from '../src/lib/initialLoader'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('withStartupLoader', () => {
  it('keeps the loader visible while startup initializes and removes it after completion', async () => {
    document.body.innerHTML = '<div id="app-loader"></div>'
    let finishInitialization!: () => void

    const startup = withStartupLoader(() => new Promise<void>((resolve) => {
      finishInitialization = resolve
    }))

    expect(document.querySelector('#app-loader [role="status"]')).not.toBeNull()

    finishInitialization()
    await startup

    expect(document.querySelector('#app-loader [role="status"]')).toBeNull()
  })

  it('removes the loader and propagates the error when startup initialization fails', async () => {
    document.body.innerHTML = '<div id="app-loader"></div>'
    const startupError = new Error('startup failed')

    await expect(withStartupLoader(() => Promise.reject(startupError))).rejects.toBe(startupError)

    expect(document.querySelector('#app-loader [role="status"]')).toBeNull()
  })

  it('throws when the loader mount point is missing', async () => {
    await expect(withStartupLoader(async () => {}))
      .rejects.toThrow('Initial loader mount point was not found')
  })
})
