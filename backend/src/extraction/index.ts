import { ValidationError } from '../lib/errors'

// PDF is the only accepted CV format (see .plan/030).
export const SUPPORTED_MIME_TYPES = ['application/pdf'] as const

export const UNREADABLE_PDF_MESSAGE = 'Could not read this PDF. Please re-export it and try again.'

/**
 * Converts an uploaded resume file to plain text. The only module that
 * touches raw file bytes — routes never parse file content directly.
 *
 * Parser failures (damaged xref table, empty or non-PDF bytes, encryption)
 * become a 422 ValidationError so they never surface as a 500
 * (.plan/042). The original error is logged by name/message only — never
 * the file contents.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    try {
      // unpdf is ESM-only; a dynamic import works from this commonjs package
      // under both tsx and the tsc build (module Node16 keeps import() intact).
      const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buffer))
      const { text } = await extractPdfText(pdf, { mergePages: true })
      return text.trim()
    } catch (error) {
      console.error('pdf text extraction failed', {
        error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
      })
      throw new ValidationError(UNREADABLE_PDF_MESSAGE, undefined, 422)
    }
  }

  throw new ValidationError('Unsupported resume file type', { mime_type: mimeType })
}
