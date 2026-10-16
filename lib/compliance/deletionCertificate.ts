import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { METHOD_LABELS, VIA_LABELS, type VerificationMethod } from "./dataSubject";
import { DATA_SUBJECT_MAP, LEGACY_ORG_PLANE } from "./dataSubjectMap";
import type { DeletionRequest } from "./dataSubjectStore";

/**
 * LA-6.5 · the deletion certificate: what was requested and when, how identity was verified, every
 * table touched with its counts, every category retained with the reason, who performed it and when.
 * Silence about retained records is not an answer, so the retained section is never empty.
 */

function safe(text: string) {
  return text.replace(/[−‒]/g, "-").replace(/[^\u0009\u000a -ÿ—–‘’“”•…€·]/g, "?");
}
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}
const stamp = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—");

/** The lines of the certificate, shared by the PDF and the screen. */
export function certificateSections(r: DeletionRequest, names: { verifiedBy: string | null; performedBy: string | null; agency: string }) {
  const touched: { table: string; purged: number; anonymised: number; kept: number; note?: string }[] = [];
  for (const group of Object.values(r.results)) {
    for (const [table, v] of Object.entries(group)) touched.push({ table, purged: v.purged ?? 0, anonymised: v.anonymised ?? 0, kept: v.kept ?? 0, note: v.note });
  }
  touched.sort((a, b) => a.table.localeCompare(b.table));
  const retained = Object.entries(DATA_SUBJECT_MAP)
    .filter(([, t]) => (t.action === "keep" || t.action === "anonymise") && t.reason)
    .map(([table, t]) => ({ table, kept: t.action === "keep" ? "Kept" : "Kept, anonymised", reason: t.reason as string }));
  return {
    request: [
      `Agency: ${names.agency}`,
      `Requested: ${stamp(r.receivedAt)} by ${VIA_LABELS[r.receivedVia as keyof typeof VIA_LABELS] ?? r.receivedVia}`,
      `About: ${r.phoneDigits ? `the number ending ${r.phoneDigits.slice(-4)}` : r.email ? "an email address" : "a client record"}`,
      `Identity verified: ${stamp(r.verifiedAt)}${names.verifiedBy ? ` by ${names.verifiedBy}` : ""} — ${METHOD_LABELS[r.verificationMethod as VerificationMethod] ?? r.verificationMethod ?? "—"}`,
      `Performed: ${stamp(r.completedAt)}${names.performedBy ? ` by ${names.performedBy}` : ""}`,
    ],
    touched,
    retained,
    notSearched: `The previous system's tables (${LEGACY_ORG_PLANE.length}, organisation-keyed) are not part of this agency's records and were not searched.`,
  };
}

export async function buildDeletionCertificate(r: DeletionRequest, names: { verifiedBy: string | null; performedBy: string | null; agency: string }): Promise<Uint8Array> {
  const s = certificateSections(r, names);
  const pdf = await PDFDocument.create();
  pdf.setTitle("Deletion certificate");
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 54;
  const muted = rgb(0.35, 0.35, 0.35), ink = rgb(0, 0, 0);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (t: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const size = o.size ?? 9.5;
    for (const l of wrap(t, o.f ?? font, size, W - 2 * M - (o.x ?? 0))) {
      if (y - size < M) { page = pdf.addPage([W, H]); y = H - M; }
      page.drawText(l, { x: M + (o.x ?? 0), y: y - size, size, font: o.f ?? font, color: o.color ?? ink });
      y -= size + 3;
    }
  };
  text("Deletion certificate", { size: 16, f: bold });
  text(`Request ${r.id}`, { color: muted, size: 8.5 });
  y -= 6;
  for (const l of s.request) text(l);
  y -= 8;
  text("Removed or anonymised, per table", { f: bold, size: 11 });
  for (const t of s.touched) {
    const parts = [t.purged ? `${t.purged} deleted` : null, t.anonymised ? `${t.anonymised} anonymised` : null, t.kept ? `${t.kept} kept` : null].filter(Boolean).join(", ") || "nothing held";
    text(`${t.table}: ${parts}${t.note ? ` (${t.note})` : ""}`, { x: 8 });
  }
  y -= 8;
  text("Kept, and why", { f: bold, size: 11 });
  for (const t of s.retained) text(`${t.table} — ${t.kept}. ${t.reason}`, { x: 8 });
  y -= 8;
  text(s.notSearched, { color: muted });
  return pdf.save();
}
