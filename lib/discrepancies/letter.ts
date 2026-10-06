import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { DISCREPANCY_KIND_LABELS } from "@/lib/discrepancies/compute";
import { getCarrierCommissionContact } from "@/lib/discrepancies/carrierContacts";
import { letterItems, listDiscrepancies, type DiscrepancyView } from "@/lib/discrepancies/service";
import { isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-4.5 · one dispute letter: what it says, gathered once, for the printed page
 * (app/app/discrepancies/letter) and the downloadable PDF (POST /api/app/discrepancies/letter/pdf),
 * so the two can never list different rows or a different total.
 */

export type DisputeLetter = {
  carrierId: string;
  carrierName: string;
  items: DiscrepancyView[];
  totalCents: number;
  agencyName: string;
  agencyAddress: string | null;
  npn: string | null;
  writingNumber: string | null;
  /** The agency's saved commissions address for this carrier, when there is one. */
  savedRecipient: string | null;
  /** Whether a commissions address can be saved yet (migration 20261007110000). */
  contactsAvailable: boolean;
  signer: { name: string | null; email: string | null; phone: string | null };
  today: string;
};

type Row<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): { maybeSingle(): Row<Record<string, string | null>> } } } };

/** The letter for one carrier and the chosen findings, or null when nothing can go on it. */
export async function getDisputeLetter(tenantId: string, userId: string, carrier: string, ids: string[]): Promise<DisputeLetter | null> {
  const wanted = [...new Set(ids.filter(isRecordId))].slice(0, 200);
  if (!isRecordId(carrier) || !wanted.length) return null;
  const list = await listDiscrepancies(tenantId, { ids: wanted });
  const items = letterItems(list.items, carrier, wanted);
  if (!items.length) return null;

  // agency_profiles is newer than the generated types; read through a plain query shape.
  const db = getSupabaseServiceClient();
  const loose = db as unknown as Loose;
  const [profile, tenant, user, contract, contact] = await Promise.all([
    loose.from("agency_profiles").select("legal_name, dba, npn, principal_address").eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    db.from("users").select("name, email, phone").eq("id", userId).maybeSingle(),
    db.from("tenant_carriers").select("writing_number").eq("tenant_id", tenantId).eq("carrier_id", carrier).eq("is_active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    // Where this agency's letters to the carrier go; a failed read only means typing it on this letter.
    getCarrierCommissionContact(tenantId, carrier).catch((error) => { console.error("[letter] carrier contact", error); return { available: false, contact: null }; }),
  ]);
  return {
    carrierId: carrier,
    carrierName: items[0].carrierName,
    items,
    totalCents: items.reduce((sum, item) => sum + item.owedCents, 0),
    agencyName: profile.data?.dba?.trim() || profile.data?.legal_name?.trim() || tenant.data?.name?.trim() || "Our agency",
    agencyAddress: profile.data?.principal_address ?? null,
    npn: profile.data?.npn ?? null,
    writingNumber: contract.data?.writing_number ?? null,
    savedRecipient: contact.contact?.address ?? null,
    contactsAvailable: contact.available,
    signer: { name: user.data?.name ?? null, email: user.data?.email ?? null, phone: user.data?.phone ?? null },
    today: new Date().toISOString().slice(0, 10),
  };
}

/** The opening paragraph, the same words on the page and in the PDF. */
export function letterBody(letter: DisputeLetter): string {
  const n = letter.items.length;
  return `Comparing your commission statements with my contract level and your commission schedule, the ${n === 1 ? "payment below differs" : `${n} payments below differ`} from what is owed. The total is ${statementMoney(letter.totalCents)}. Please review ${n === 1 ? "it" : "them"} and pay the difference, or tell me where my figures are wrong.`;
}

// ── the PDF (pdf-lib, standard fonts, as the welcome pack) ─────────────────────

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

/** The letter as a US Letter PDF: the same rows and total the printed page shows. `to` is the recipient as typed. */
export async function buildDisputeLetterPdf(letter: DisputeLetter, to: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(`Commission dispute · ${letter.carrierName}`));
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 56, gap = 4;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0, 0, 0), muted = rgb(0.3, 0.3, 0.3), rule = rgb(0.75, 0.75, 0.75);
  const ensure = (need: number) => { if (y - need < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const text = (t: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}) => {
    const size = opts.size ?? 10.5;
    for (const l of wrap(t, opts.f ?? font, size, opts.width ?? W - 2 * M - (opts.x ?? 0))) {
      ensure(size + gap);
      page.drawText(l, { x: M + (opts.x ?? 0), y: y - size, size, font: opts.f ?? font, color: opts.color ?? ink });
      y -= size + gap;
    }
  };

  text(letter.agencyName, { f: bold });
  if (letter.agencyAddress) text(letter.agencyAddress, { color: muted });
  if (letter.npn) text(`NPN ${letter.npn}`, { color: muted });
  y -= 12;
  text(statementDay(letter.today), { color: muted });
  y -= 12;
  text(to.trim() || `${letter.carrierName}\nCommissions Department`);
  y -= 14;
  text(`Re: Commission discrepancies${letter.writingNumber ? ` · writing number ${letter.writingNumber}` : ""}`, { f: bold });
  y -= 4;
  text("To the Commissions Department,");
  y -= 4;
  text(letterBody(letter));
  y -= 12;

  // The table: policy, insured, problem, period, expected, paid, owed — money right-aligned.
  const cols = [
    { label: "Policy", x: 0, w: 62 }, { label: "Insured", x: 64, w: 84 }, { label: "Problem", x: 150, w: 92 },
    { label: "Period", x: 244, w: 86 }, { label: "Expected", x: 332, w: 56, right: true }, { label: "Paid", x: 390, w: 56, right: true }, { label: "Owed", x: 448, w: 52, right: true },
  ];
  const cell = (t: string, col: (typeof cols)[number], top: number, f: PDFFont, size = 9) => {
    const lines = wrap(t, f, size, col.w);
    lines.forEach((l, i) => {
      const x = col.right ? M + col.x + col.w - f.widthOfTextAtSize(l, size) : M + col.x;
      page.drawText(l, { x, y: top - size - i * (size + 2), size, font: f, color: ink });
    });
    return lines.length * (size + 2);
  };
  ensure(30);
  let top = y;
  cols.forEach((col) => cell(col.label, col, top, bold));
  y -= 14;
  page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.6, color: rule });
  for (const item of letter.items) {
    const values = [
      item.policyNumber, item.insuredName, DISCREPANCY_KIND_LABELS[item.kind].label,
      item.periodStart && item.periodEnd ? statementPeriod(item.periodStart, item.periodEnd) : "-",
      statementMoney(item.detail?.expectedCents ?? 0), statementMoney(item.detail?.receivedCents ?? 0), statementMoney(item.owedCents),
    ];
    const height = Math.max(...values.map((v, i) => wrap(v, i === 6 ? bold : font, 9, cols[i].w).length)) * 11 + 6;
    ensure(height + 12);
    top = y - 4;
    values.forEach((v, i) => cell(v, cols[i], top, i === 6 ? bold : font));
    y -= height;
    if (item.detail?.explanation) {
      text(item.detail.explanation, { size: 8, color: muted, x: 150, width: W - 2 * M - 150 });
      y -= 2;
    }
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.4, color: rule });
  }
  ensure(20);
  y -= 6;
  const totalLabel = "Total owed";
  const totalValue = statementMoney(letter.totalCents);
  page.drawText(safe(totalLabel), { x: M + 390 - bold.widthOfTextAtSize(totalLabel, 10) + 56, y: y - 10, size: 10, font: bold, color: ink });
  page.drawText(safe(totalValue), { x: W - M - bold.widthOfTextAtSize(safe(totalValue), 10), y: y - 10, size: 10, font: bold, color: ink });
  y -= 30;

  text("Thank you,");
  y -= 18;
  text(letter.signer.name ?? letter.agencyName, { f: bold });
  text([letter.agencyName, letter.signer.phone, letter.signer.email].filter(Boolean).join(" · "), { color: muted });
  return pdf.save();
}
