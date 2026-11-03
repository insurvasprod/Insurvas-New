import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { BASIS_LABELS, premiumLabel, type Statement } from "./statementCore";
import { bpsToPercent, dollars } from "./constants";

/**
 * AG-1.8 · the producer statement as a PDF, with pdf-lib like every other document in the app (no hand-rolled
 * writer). Built from the same `Statement` the screen renders, which is built from the ledger at request time —
 * so the PDF reconciles to the ledger exactly as the screen does. Client name and policy number only.
 */

function safe(text: string) {
  return text.replace(/[−‒]/g, "-").replace(/[^\u0009\u000a -ÿ—–‘’“”•…€·]/g, "?");
}

export type StatementHeader = {
  producer: string;
  agency: string;
  periodStart: string;
  periodEnd: string;
  paidOn: string | null;
  method: string | null;
  reference: string | null;
  withheldCents: number;
  decision: string | null;
  decisionReason: string | null;
};

export async function buildStatementPdf(header: StatementHeader, s: Statement): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Producer statement ${header.periodStart} to ${header.periodEnd}`);
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.25, 0.22);
  const muted = rgb(0.35, 0.38, 0.42);
  let page: PDFPage = pdf.addPage([612, 792]);
  let y = 750;
  const line = (text: string, x: number, f: PDFFont = font, size = 9, color = ink) => page.drawText(safe(text), { x, y, size, font: f, color });
  const newPageIfNeeded = () => {
    if (y < 72) { page = pdf.addPage([612, 792]); y = 750; }
  };

  line("Producer statement", 48, bold, 16);
  y -= 20;
  line(`${header.producer} · ${header.agency}`, 48, font, 10, muted);
  y -= 14;
  line(`Period ${header.periodStart} to ${header.periodEnd} · Basis: ${BASIS_LABELS.reported}`, 48, font, 10, muted);
  y -= 14;
  line(`Paid ${header.paidOn ?? "not paid"}${header.method ? ` · ${header.method}` : ""}${header.reference ? ` · ${header.reference}` : ""}`, 48, font, 10, muted);
  y -= 22;
  line(`Opening balance ${dollars(s.openingCents)}`, 48, bold, 10);
  line(`Closing balance ${dollars(s.closingCents)}`, 330, bold, 10);
  y -= 24;

  const cols: Array<[string, number]> = [["Client", 48], ["Carrier", 150], ["Policy", 230], ["Premium", 300], ["Your level", 360], ["Gross", 420], ["Chargeback", 475], ["Net", 545]];
  for (const [label, x] of cols) line(label, x, bold, 8, muted);
  y -= 6;
  page.drawLine({ start: { x: 48, y }, end: { x: 572, y }, thickness: 0.5, color: muted });
  y -= 12;
  for (const l of s.lines) {
    newPageIfNeeded();
    line(l.client.slice(0, 18), 48);
    line(l.carrier.slice(0, 14), 150);
    line(l.policy.slice(0, 12), 230);
    line(premiumLabel(l.premiumCents, l.premiumMode), 300);
    line(bpsToPercent(l.levelBps), 360);
    line(l.grossCents === null ? "-" : dollars(l.grossCents), 420);
    line(l.chargebackCents === null ? "-" : dollars(l.chargebackCents), 475);
    line(dollars(l.netCents), 545);
    y -= 13;
  }
  y -= 8;
  for (const a of s.adjustments) {
    newPageIfNeeded();
    line(`Adjustment ${dollars(a.amountCents)} — ${a.reason}`, 48);
    y -= 13;
  }
  for (const p of s.payouts) {
    newPageIfNeeded();
    line(`Paid to you ${dollars(p.amountCents)}`, 48);
    y -= 13;
  }
  if (header.withheldCents > 0) {
    newPageIfNeeded();
    line(`Withheld ${dollars(header.withheldCents)}${header.decisionReason ? ` — ${header.decisionReason}` : " against a negative balance"}`, 48);
    y -= 13;
  }
  y -= 6;
  newPageIfNeeded();
  line(`Carried forward ${dollars(s.closingCents)}`, 48, bold, 10);
  return pdf.save();
}
