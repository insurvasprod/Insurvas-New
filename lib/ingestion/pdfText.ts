/**
 * A PDF's text, as lines of positioned pieces (pdf.js, text only: no fonts, no rendering, no
 * scripts). Carrier statements are tables drawn as text: a piece is one string at an x on a line,
 * and a line is every piece sharing a baseline. PDF layouts (pdfLayout.ts) cut those lines into
 * columns. A scanned PDF has no text; it comes back with no lines, and is said to be scanned.
 *
 * Server side only (pdf.js is loaded on demand).
 */

export type PdfPiece = { x: number; text: string };
export type PdfLine = { page: number; y: number; pieces: PdfPiece[]; text: string };

/** Pieces within this many points of each other vertically share a line. */
const LINE_TOLERANCE = 2.5;

export async function readPdfLines(bytes: Uint8Array): Promise<PdfLine[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, enableXfa: false, useSystemFonts: false, stopAtErrors: false, verbosity: 0 });
  const document = await task.promise;
  const lines: PdfLine[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pieces: Array<{ x: number; y: number; text: string }> = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        pieces.push({ x: Math.round(item.transform[4] * 100) / 100, y: Math.round(item.transform[5] * 100) / 100, text: item.str });
      }
      // Top of the page first (PDF y grows upwards), then left to right.
      pieces.sort((a, b) => b.y - a.y || a.x - b.x);
      const pageLines: PdfLine[] = [];
      for (const piece of pieces) {
        const line = pageLines.find((candidate) => Math.abs(candidate.y - piece.y) <= LINE_TOLERANCE);
        if (line) line.pieces.push({ x: piece.x, text: piece.text });
        else pageLines.push({ page: pageNumber, y: piece.y, pieces: [{ x: piece.x, text: piece.text }], text: "" });
      }
      for (const line of pageLines) {
        line.pieces.sort((a, b) => a.x - b.x);
        line.text = line.pieces.map((piece) => piece.text).join("  ");
      }
      lines.push(...pageLines);
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return lines;
}
