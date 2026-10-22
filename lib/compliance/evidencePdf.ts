import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { csvCell } from "@/lib/csv/cell";

import { formatPhone, gapDay } from "./evidenceGaps";
import type { EvidenceReport } from "./evidenceReport";

/**
 * LA-6.3 · the evidence report as a PDF for counsel (self-contained, paginated, the generation time
 * and the scope on every page, so two reports on the same number can be compared) and the timeline
 * as a CSV for a lawyer who wants to sort it. Not a sealed bundle: that was the option not taken.
 */

/** Standard fonts are WinAnsi: keep Latin-1 and the few typographic marks it has, swap the rest. */
function safe(text: string) {
  return text.replace(/[−‒]/g, "-").replace(/[^\u0009\u000a -ÿ—–‘’“”•…€·]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

const stamp = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const rangeText = (r: EvidenceReport["range"]) => (r.from || r.to ? `${r.from ? r.from.slice(0, 10) : "the start"} to ${r.to ? r.to.slice(0, 10) : "today"}` : "all records");

export function scopeLine(report: EvidenceReport): string {
  return `${report.scopeLabel} · ${report.phones.map(formatPhone).join(", ") || "no number"} · ${rangeText(report.range)}`;
}

export async function buildEvidencePdf(report: EvidenceReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(`Compliance evidence report · ${report.phones.map(formatPhone).join(", ")}`));
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 50, gap = 3;
  const ink = rgb(0, 0, 0), muted = rgb(0.35, 0.35, 0.35), rule = rgb(0.78, 0.78, 0.78), alarm = rgb(0.62, 0.07, 0.07);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const header = `Generated ${stamp(report.generatedAt)} by ${report.generatedBy}`;
  const scope = scopeLine(report);
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    // Scope and generation time on every page.
    page.drawText(safe(scope), { x: M, y: H - 30, size: 8, font, color: muted });
    page.drawText(safe(header), { x: M, y: H - 41, size: 8, font, color: muted });
    page.drawLine({ start: { x: M, y: H - 46 }, end: { x: W - M, y: H - 46 }, thickness: 0.5, color: rule });
    y = H - 62;
  };
  const ensure = (need: number) => { if (y - need < M + 14) newPage(); };
  const text = (t: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const size = o.size ?? 9.5;
    for (const l of wrap(t, o.f ?? font, size, W - 2 * M - (o.x ?? 0))) {
      ensure(size + gap);
      page.drawText(l, { x: M + (o.x ?? 0), y: y - size, size, font: o.f ?? font, color: o.color ?? ink });
      y -= size + gap;
    }
  };
  const heading = (t: string) => { y -= 8; ensure(30); text(t, { size: 12, f: bold }); page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.6, color: rule }); y -= 6; };

  newPage();
  text("Compliance evidence report", { size: 16, f: bold });
  y -= 4;
  text(`Numbers: ${report.phones.map(formatPhone).join(", ") || "none"}`);
  if (report.names.length) text(`Names on file: ${report.names.join(", ")}`);
  text(`Records: ${report.timeline.length} · Gap checks run: ${report.gapsChecked}`);
  text("This lists what we hold and what is missing. It is not legal advice and not an assembled defence.", { color: muted, size: 8.5 });

  heading(`Gaps found: ${report.gaps.length}`);
  if (!report.gaps.length) text("No gaps found by the checks that could be run.", { color: muted });
  for (const g of report.gaps) {
    text(`• ${g.label}${g.phoneDigits && report.phones.length > 1 ? ` (${formatPhone(g.phoneDigits)})` : ""}${g.severity === "critical" ? "  — fix today" : ""}`, { f: bold, color: g.severity === "critical" ? alarm : ink });
    for (const l of g.lines) text(l, { x: 12 });
    y -= 3;
  }
  if (report.undetermined.length) {
    y -= 4;
    text("Could not be checked (undetermined, not passed):", { f: bold });
    for (const g of report.undetermined) text(`• ${g.label}: ${g.lines.join(" ")}`, { x: 6 });
  }

  heading(`Consent: ${report.consent.length} artefact${report.consent.length === 1 ? "" : "s"}`);
  if (!report.consent.length) text("No consent artefact is held for this number.", { f: bold, color: alarm });
  for (const c of report.consent) {
    text(`${c.provider} certificate${c.certificateId ? ` ${c.certificateId}` : ""} · ${formatPhone(c.phoneDigits)}`, { f: bold });
    text(`Consent given: ${c.consentAt ? stamp(c.consentAt) : "not stated"} · captured ${stamp(c.capturedAt)}${c.claimedAt ? ` · retained ${stamp(c.claimedAt)}` : ""}`, { x: 12 });
    text(`${c.valid ? "Valid" : "Not valid"}: ${c.validity}`, { x: 12, color: c.valid ? ink : alarm });
    if (c.sourceUrl) text(`Captured on: ${c.sourceUrl}`, { x: 12, color: muted });
    if (c.certificateUrl) text(`Certificate: ${c.certificateUrl}`, { x: 12, color: muted });
    y -= 3;
  }

  if (report.leads.length) {
    heading("Where the lead came from");
    for (const l of report.leads) text(`${gapDay(l.createdAt)} ${l.createdAt.slice(0, 4)} · ${l.partner ? `supplied by ${l.partner}` : l.campaign ? `campaign ${l.campaign}` : "entered directly"}${l.name ? ` · ${l.name}` : ""} · lead ${l.leadId}`);
  }

  heading(`Timeline: ${report.timeline.length} record${report.timeline.length === 1 ? "" : "s"}`);
  for (const t of report.timeline) {
    text(`${stamp(t.at)}  ${t.summary}`, { f: bold, size: 9 });
    for (const f of t.facts) text(f, { x: 12, size: 8.5 });
    text(`${t.module} · ${t.sourceTable} · ${t.sourceId}${t.sourceSubId ? ` / ${t.sourceSubId}` : ""}`, { x: 12, size: 7.5, color: muted });
    y -= 2;
  }

  // Page numbers last, once the count is known.
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: W - M - font.widthOfTextAtSize(label, 8), y: M - 10, size: 8, font, color: muted });
  });
  return pdf.save();
}

/** The timeline as CSV: one row per record, with the pointer to its source row. */
export function evidenceCsv(report: EvidenceReport): string {
  const head = ["when_utc", "phone", "event", "summary", "facts", "module", "source_table", "source_id", "source_sub_id"];
  const rows = report.timeline.map((t) => [t.at, t.phoneDigits, t.eventType, t.summary, t.facts.join(" | "), t.module, t.sourceTable, t.sourceId, t.sourceSubId ?? ""]);
  const preamble = [`# ${scopeLine(report)}`, `# Generated ${stamp(report.generatedAt)} by ${report.generatedBy}`, `# Gaps found: ${report.gaps.length}`];
  return [...preamble.map((l) => csvCell(l)), head.join(","), ...rows.map((r) => r.map((v) => csvCell(v)).join(","))].join("\r\n");
}
