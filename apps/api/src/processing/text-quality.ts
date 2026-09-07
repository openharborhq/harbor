/**
 * Decide whether a PDF's existing text layer is good enough to skip OCR (spec §2 stage 1).
 * Born-digital statements have hundreds of letters per page; a scanned PDF has none, and a
 * scan with a junk layer (e.g. only a header from a fax cover) has very few.
 */
export const MIN_LETTERS_PER_PAGE = 80;

export function countLetters(text: string): number {
  const m = text.match(/[\p{L}\p{N}]/gu);
  return m ? m.length : 0;
}

export function hasUsableTextLayer(text: string, pageCount: number): boolean {
  if (pageCount <= 0) return false;
  return countLetters(text) / pageCount >= MIN_LETTERS_PER_PAGE;
}

/** ocrmypdf -v1 logs per-page lines like "   3: [tesseract] ...". Extract the page number. */
export function pageFromOcrLine(line: string): number | null {
  const m = /^\s*(\d+):\s/.exec(line);
  return m ? Number(m[1]) : null;
}

/** Parse "Pages: 12" out of `pdfinfo` output. */
export function pagesFromPdfInfo(stdout: string): number | null {
  const m = /^Pages:\s+(\d+)/m.exec(stdout);
  return m ? Number(m[1]) : null;
}

/** tsvector has a hard 1 MB limit; keep a margin. */
export const MAX_INDEXED_CHARS = 900_000;
