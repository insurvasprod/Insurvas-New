import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { GUIDE_REPLIES, guideRows, guideSubtitle, guideTitle, sampleCurl, type GuideInput } from "./guide";

/**
 * The vendor's instructions as a PDF ("Download PDF", round 8 board A5): the same content as the
 * page and the copied text (lib/leadPost/guide.ts), on US Letter with the standard fonts.
 */

// The standard fonts are WinAnsi: anything outside it is replaced rather than failing the download.
const safe = (value: string) => value.replace(/[^\x20-\x7E -ÿ–—‘’“”…·]/g, "?");

export async function buildGuidePdf(input: GuideInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(guideTitle(input));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const ink = rgb(0.05, 0.25, 0.22);
  const muted = rgb(0.3, 0.37, 0.35);
  const margin = 54;
  const width = 612 - margin * 2;

  let page: PDFPage = pdf.addPage([612, 792]);
  let y = 792 - margin;
  const ensure = (height: number) => {
    if (y - height < margin) {
      page = pdf.addPage([612, 792]);
      y = 792 - margin;
    }
  };
  const wrap = (text: string, using: PDFFont, size: number, max: number) => {
    const lines: string[] = [];
    for (const paragraph of safe(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/(\s+)/)) {
        const next = line + word;
        if (using.widthOfTextAtSize(next, size) > max && line.trim()) {
          lines.push(line.trimEnd());
          line = word.trimStart();
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  };
  const write = (text: string, options: { using?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; max?: number; gap?: number } = {}) => {
    const using = options.using ?? font;
    const size = options.size ?? 10;
    for (const line of wrap(text, using, size, options.max ?? width)) {
      ensure(size + 4);
      page.drawText(line, { x: options.x ?? margin, y: y - size, size, font: using, color: options.color ?? ink });
      y -= size + 4;
    }
    y -= options.gap ?? 0;
  };
  const heading = (text: string) => {
    y -= 10;
    write(text, { using: bold, size: 12 });
    y -= 2;
  };

  write(guideTitle(input), { using: bold, size: 18 });
  write(guideSubtitle(input), { color: muted, gap: 6 });

  heading("Address");
  write(`POST ${input.postingUrl}`, { using: mono, size: 9 });

  heading("Headers");
  write("Authorization: Bearer <your key>   (the key we sent you separately)", { using: mono, size: 9 });
  write("Content-Type: application/json", { using: mono, size: 9 });
  write("Idempotency-Key: your lead id      (optional)", { using: mono, size: 9 });

  heading("Fields");
  for (const row of guideRows(input)) {
    const top = y;
    write(row.field, { using: mono, size: 9, max: 170 });
    const afterField = y;
    y = top;
    write(row.needed, { x: margin + 180, max: 50 });
    y = top;
    write(row.rule, { x: margin + 240, max: width - 240 });
    y = Math.min(y, afterField) - 2;
  }

  heading("Replies");
  write("Every reply is JSON: accepted (true / false), reason_code, message, lead_id.", { gap: 4 });
  for (const reply of GUIDE_REPLIES) {
    const top = y;
    write(reply.code, { using: mono, size: 9, max: 170 });
    const afterCode = y;
    y = top;
    write(reply.meaning, { x: margin + 180, max: width - 180 });
    y = Math.min(y, afterCode);
  }

  heading("Sample");
  write(sampleCurl(input.postingUrl, input.fieldMap), { using: mono, size: 8 });

  return pdf.save();
}
