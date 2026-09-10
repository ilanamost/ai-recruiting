import { ValidationError } from '../lib/errors'

// PDF is the only accepted CV format (see .plan/030).
export const SUPPORTED_MIME_TYPES = ['application/pdf'] as const

/**
 * Converts an uploaded resume file to plain text. The only module that
 * touches raw file bytes — routes never parse file content directly.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default
    const result = await pdfParse(buffer)
    return result.text.trim()
  }

  throw new ValidationError('Unsupported resume file type', { mime_type: mimeType })
}
