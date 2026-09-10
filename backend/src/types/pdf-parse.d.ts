declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
  }

  function pdfParse(buffer: Buffer): Promise<PdfParseResult>

  export = pdfParse
}
