import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { formatCentsAsCurrency } from "@/lib/money";

import { invoiceLines, type InvoiceItem } from "./partnerPayoutCore";

/**
 * Partner payouts rework (owner, 2026-11-06) · a partner's invoice as a PDF, with pdf-lib like every other
 * document in the app (lib/agency/statementPdf.ts). Built from the same run items the screens read, so it
 * shows exactly how each amount was worked out: a flat rate per submitted application (Model A), or a share
 * of the commission received on each issued policy (Model B), then clawbacks, credits and a carried
 * balance. Stored on publish and offered to the partner in its Commissions section.
 */

function safe(text: string) {
  return text.replace(/[−‒]/g, "-").replace(/[^\u0009\u000a -ÿ—–‘’“”•…€·]/g, "?");
}

export type InvoiceHeader = {
  invoiceNumber: string;
  from: { name: string; addressLines: string[] };
  partner: string;
  payee: { name: string | null; email: string | null; method: string | null } | null;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "paid" | "void";
  publishedOn: string | null;
  paidOn: string | null;
  expectedOn: string | null;
  rejectedCount: number;
  disputedCents: number;
  totals: { grossCents: number; deductionsCents: number; netCents: number };
  footer: string | null;
};

const money = (c: number) => formatCentsAsCurrency(c);

export async function buildPartnerInvoicePdf(header: InvoiceHeader, items: InvoiceItem[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${header.invoiceNumber}`);
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.25, 0.22);
  const muted = rgb(0.35, 0.38, 0.42);
  let page: PDFPage = pdf.addPage([612, 792]);
  let y = 750;
  const text = (t: string, x: number, f: PDFFont = font, size = 9, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, f: PDFFont = font, size = 9, color = ink) => {
    const s = safe(t);
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  };
  const rule = () => page.drawLine({ start: { x: 48, y }, end: { x: 564, y }, thickness: 0.5, color: muted });
  const newPageIfNeeded = () => {
    if (y < 80) { page = pdf.addPage([612, 792]); y = 750; }
  };

  // Header: who it is from, who it is for, which period, and where it stands.
  text(`Invoice ${header.invoiceNumber}`, 48, bold, 18);
  right(header.from.name || "Agency", 564, bold, 11);
  y -= 16;
  text(`${header.partner} · ${header.periodStart} to ${header.periodEnd}`, 48, font, 10, muted);
  for (const lineText of header.from.addressLines.slice(0, 3)) { right(lineText, 564, font, 9, muted); y -= 12; }
  y -= 8;
  const standing = header.status === "paid" ? `Paid ${header.paidOn ?? ""}` : header.status === "published" ? `Issued ${header.publishedOn ?? ""}${header.expectedOn ? ` · expected by ${header.expectedOn}` : ""}` : header.status === "void" ? "Void" : "Draft — not yet sent";
  text(standing, 48, bold, 10);
  y -= 14;
  if (header.payee && (header.payee.name || header.payee.email || header.payee.method)) {
    text(`Pay to: ${[header.payee.name, header.payee.email, header.payee.method].filter(Boolean).join(" · ")}`, 48, font, 9, muted);
    y -= 14;
  }
  y -= 10;

  // The lines, each with its math.
  const cols: Array<[string, number, "l" | "r"]> = [["Date", 48, "l"], ["Item", 110, "l"], ["Client · policy", 230, "l"], ["How", 470, "r"], ["Amount", 564, "r"]];
  for (const [label, x, align] of cols) {
    if (align === "l") text(label, x, bold, 8, muted);
    else right(label, x, bold, 8, muted);
  }
  y -= 6;
  rule();
  y -= 12;
  const lines = invoiceLines(items, money);
  if (!lines.length) { text("Nothing was earned in this period.", 48, font, 9, muted); y -= 13; }
  for (const l of lines) {
    newPageIfNeeded();
    text(l.date, 48);
    text(l.what.slice(0, 22), 110);
    text(l.detail.slice(0, 44), 230);
    right(l.math, 470, font, 9, muted);
    right(money(l.amountCents), 564);
    y -= 13;
  }
  y -= 4;
  rule();
  y -= 16;
  newPageIfNeeded();
  const total = (label: string, cents: number, f: PDFFont = font) => { text(label, 330, f, 10); right(money(cents), 564, f, 10); y -= 14; };
  total("Earned", header.totals.grossCents);
  if (header.totals.deductionsCents) total("Taken off (chargebacks, credits, balance)", header.totals.deductionsCents);
  if (header.disputedCents) total("Held back while disputed", -header.disputedCents);
  total(header.totals.netCents < 0 ? "Owed by you — taken off your next invoice" : "Total due", header.totals.netCents, bold);
  if (header.rejectedCount) {
    y -= 6;
    text(`${header.rejectedCount} transfer${header.rejectedCount === 1 ? "" : "s"} rejected at the compliance check ${header.rejectedCount === 1 ? "is" : "are"} not billable.`, 48, font, 8, muted);
    y -= 12;
  }
  if (header.footer) {
    y -= 6;
    newPageIfNeeded();
    text(header.footer.slice(0, 120), 48, font, 8, muted);
  }
  return pdf.save();
}
