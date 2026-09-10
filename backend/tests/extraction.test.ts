import { describe, expect, it } from 'vitest'
import { extractText } from '../src/extraction'

describe('extractText', () => {
  it('rejects an unsupported mime type', async () => {
    await expect(extractText(Buffer.from('hello'), 'text/plain')).rejects.toThrow(
      'Unsupported resume file type'
    )
  })
})
