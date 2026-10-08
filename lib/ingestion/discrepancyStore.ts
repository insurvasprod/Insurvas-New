import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { getCarrierCommissionContact } from "@/lib/discrepancies/carrierContacts";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { flaggedFiles } from "./carrierAccountsStore";
import { DEFAULT_TOLERANCE_CENTS, detect, type DiscrepancyType, type EngineEntry } from "./discrepancyEngine";
import { DISPUTABLE, letterText, type LetterItem } from "./disputeLetter";
import type { StatementCheck } from "./carrierAccounts";
import { entrySources, untraceableDiscrepancies } from "./traceStore";

/**
 * LA-4.15 (Notion sprint) · the discrepancy engine and dispute letters, server side. Detection reads
 * the carrier-file data, runs the pure engine, and hands every finding to record_discrepancy_run,
 * which keeps one stable row per problem. A letter is drafted from the records and frozen; the
 * agent sends it and records the outcome. Nothing is ever sent from here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const DISCREPANCIES_PENDING_MESSAGE = "Discrepancies from carrier files need a database update (20261008250000).";

export class DiscrepancyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DiscrepancyError";
  }
}

async function everyRow(build: () => Loose, max = 100_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** Run detection for one agency and record it. Safe to run any time: the same problems update the same rows. */
export async function runDetection(tenantId: string, today = new Date().toISOString().slice(0, 10)) {
  const probe = await db().from("commission_discrepancy").select("id").limit(1);
  if (probe.error) {
    if (isSchemaGap(probe.error)) return { available: false as const };
    throw new Error(probe.error.message);
  }
  const [policies, expected, entries, statements, carriers, settings, flagged] = await Promise.all([
    everyRow(() => db().from("policy_current").select("carrier_id, policy_number, status_normalized, in_clawback_window, lapsed_on, months_paid").eq("tenant_id", tenantId).order("carrier_id").order("policy_number")),
    everyRow(() => db().from("expected_commission").select("*").eq("tenant_id", tenantId).order("carrier_id").order("policy_number")),
    everyRow(() => db().from("commission_entry").select("id, carrier_id, policy_number, entry_type, corrects_type, reverses_entry_id, amount_cents, transaction_date, statement_date, rate_bp, commissionable_premium_cents, months_advanced, file_id").eq("tenant_id", tenantId).order("created_at")),
    db().from("carrier_account_checks").select("*").eq("tenant_id", tenantId).order("statement_date"),
    db().from("carriers").select("id, name"),
    db().from("carrier_operating_settings").select("tenant_id, carrier_id, tolerance_cents").or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
    flaggedFiles(tenantId),
  ]);
  const names = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  const tolerance = new Map<string, number>();
  for (const row of [...(settings.data ?? [])].sort((a: Loose, b: Loose) => (a.tenant_id ? 1 : 0) - (b.tenant_id ? 1 : 0))) if (row.tolerance_cents !== null) tolerance.set(row.carrier_id, Number(row.tolerance_cents));
  const findings = detect({
    today,
    policies: policies.map((p) => ({ carrierId: p.carrier_id, carrierName: names.get(p.carrier_id) ?? "", policyNumber: p.policy_number, status: p.status_normalized, inClawbackWindow: p.in_clawback_window, lapsedOn: p.lapsed_on, monthsPaid: p.months_paid })),
    expected: expected.map((x) => ({
      carrierId: x.carrier_id, policyNumber: x.policy_number, policyYear: x.policy_year, confidence: x.confidence, trigger: x.commission_trigger, triggerOn: x.trigger_occurred_on, overdueFrom: x.overdue_from, reason: x.reason,
      expectedAmountCents: x.expected_amount_cents === null ? null : Number(x.expected_amount_cents), expectedAdvanceCents: x.expected_advance_cents === null ? null : Number(x.expected_advance_cents),
      scheduleId: x.schedule_id, scheduleVersion: x.schedule_version, rateBp: x.rate_bp_applied, premiumCents: x.commissionable_premium_cents === null ? null : Number(x.commissionable_premium_cents),
    })),
    // Lines of a statement that doesn't add up are held out here too (LA-4.14).
    entries: entries.filter((e) => !flagged.has(e.file_id)).map((e): EngineEntry => ({
      id: e.id, carrierId: e.carrier_id, policyNumber: e.policy_number, type: e.entry_type, correctsType: e.corrects_type, reversesEntryId: e.reverses_entry_id, amountCents: Number(e.amount_cents),
      transactionDate: e.transaction_date, statementDate: e.statement_date, rateBp: e.rate_bp, commissionablePremiumCents: e.commissionable_premium_cents === null ? null : Number(e.commissionable_premium_cents), monthsAdvanced: e.months_advanced,
    })),
    statements: (statements.data ?? []).map((s: Loose): StatementCheck => ({
      id: s.id, carrierId: s.carrier_id, statementDate: s.statement_date, fileId: s.file_id, openingCents: Number(s.opening_balance_cents), activityCents: Number(s.activity_cents), closingCents: Number(s.closing_balance_cents),
      debitCents: Number(s.debit_balance_cents), amountPaidCents: s.amount_paid_cents === null ? null : Number(s.amount_paid_cents), heldCents: s.held_cents === null ? null : Number(s.held_cents),
      minimumPayoutCents: s.minimum_payout_cents === null ? null : Number(s.minimum_payout_cents), entriesCents: s.entries_cents === null ? null : Number(s.entries_cents), entries: s.entries === null ? null : Number(s.entries),
      arithmeticOk: Boolean(s.arithmetic_ok), entriesOk: Boolean(s.entries_ok), continuityOk: Boolean(s.continuity_ok), previousStatementDate: s.previous_statement_date,
    })),
    carrierNames: names,
    tolerance: (carrierId) => tolerance.get(carrierId) ?? DEFAULT_TOLERANCE_CENTS,
  });
  const { data, error } = await db().rpc("record_discrepancy_run", { p_tenant_id: tenantId, p_run_id: crypto.randomUUID(), p_findings: findings });
  if (error) throw new Error(`Could not record the discrepancies: ${error.message}`);
  return { available: true as const, findings: findings.length, opened: Number(data?.opened ?? 0), updated: Number(data?.updated ?? 0), reopened: Number(data?.reopened ?? 0), cleared: Number(data?.cleared ?? 0) };
}

export type DiscrepancyRow = {
  id: string; carrierId: string; carrierName: string; type: DiscrepancyType; policyNumber: string | null; severity: "info" | "warning" | "action"; status: string;
  expectedCents: number | null; expectedSource: Record<string, unknown> | null; reportedCents: number | null; reportedEntryIds: string[]; differenceCents: number | null; toleranceCents: number | null;
  explanation: string; evidence: Record<string, unknown>; detectedAt: string; lastSeenAt: string; resolution: string | null; resolutionNote: string | null; resolvedAt: string | null; disputeId: string | null;
  /** LA-4.20: the ledger lines behind the reported figure, each with the file row it came from. */
  reportedLines: Array<{ id: string; fileId: string; fileName: string | null; rowNumber: number | null; type: string; amountCents: number }>;
};
export type DisputeRow = { id: string; carrierId: string; carrierName: string; discrepancyIds: string[]; recipient: string | null; letterBody: string; totalCents: number; status: string; sentAt: string | null; sentVia: string | null; outcomeCents: number | null; resolvedAt: string | null; notes: string | null; createdAt: string };

export async function loadDiscrepancies(tenantId: string) {
  const [rows, disputes, carriers, withheld] = await Promise.all([
    db().from("commission_discrepancy").select("*").eq("tenant_id", tenantId).order("severity").order("last_seen_at", { ascending: false }).limit(5000),
    db().from("commission_dispute").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
    db().from("carriers").select("id, name"),
    // LA-4.20: an item whose trace is broken on either side is not shown — an unverifiable claim is
    // worse than silence. It stays in the trace health check, as a defect for us to fix.
    untraceableDiscrepancies(tenantId).catch((error) => { console.error("[discrepancies] trace check failed:", error); return null; }),
  ]);
  if (rows.error) {
    if (isSchemaGap(rows.error)) return { available: false as const };
    throw new Error(`Could not load the discrepancies: ${rows.error.message}`);
  }
  const shown = ((rows.data ?? []) as Loose[]).filter((d) => !withheld?.has(d.id));
  if (withheld?.size) console.error(`[discrepancies] ${withheld.size} item(s) withheld for ${tenantId}: the trace is incomplete`, [...withheld.entries()].slice(0, 5));
  const sources = await entrySources(tenantId, shown.flatMap((d) => (d.reported_entry_ids ?? []) as string[]));
  const name = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    available: true as const,
    items: shown.map((d): DiscrepancyRow => ({
      id: d.id, carrierId: d.carrier_id, carrierName: name.get(d.carrier_id) ?? "Carrier not known", type: d.discrepancy_type, policyNumber: d.policy_number, severity: d.severity, status: d.status,
      expectedCents: n(d.expected_amount_cents), expectedSource: d.expected_source, reportedCents: n(d.reported_amount_cents), reportedEntryIds: d.reported_entry_ids ?? [], differenceCents: n(d.difference_cents), toleranceCents: n(d.tolerance_applied_cents),
      explanation: d.explanation, evidence: d.evidence ?? {}, detectedAt: d.detected_at, lastSeenAt: d.last_seen_at, resolution: d.resolution, resolutionNote: d.resolution_note, resolvedAt: d.resolved_at, disputeId: d.dispute_id,
      reportedLines: ((d.reported_entry_ids ?? []) as string[]).flatMap((id) => { const s = sources.get(id); return s ? [{ id, ...s }] : []; }),
    })),
    disputes: ((disputes.data ?? []) as Loose[]).map((x): DisputeRow => ({
      id: x.id, carrierId: x.carrier_id, carrierName: name.get(x.carrier_id) ?? "Carrier not known", discrepancyIds: x.discrepancy_ids, recipient: x.recipient, letterBody: x.letter_body, totalCents: Number(x.total_cents),
      status: x.status, sentAt: x.sent_at, sentVia: x.sent_via, outcomeCents: n(x.outcome_amount_cents), resolvedAt: x.resolved_at, notes: x.notes, createdAt: x.created_at,
    })),
  };
}

export async function setStatus(tenantId: string, userId: string, id: string, status: "open" | "dismissed" | "resolved", note: string | null) {
  const { data, error } = await db().rpc("set_discrepancy_status", { p_tenant_id: tenantId, p_id: id, p_user_id: userId, p_status: status, p_note: note });
  if (error) throw new Error(`Could not save: ${error.message}`);
  if (!data) throw new DiscrepancyError("That item can't be changed: it isn't this agency's, or it is in a dispute.", 409);
}

/** The letter's parties: the agency, the carrier's commissions address, the writing number, who signs. */
async function parties(tenantId: string, userId: string, carrierId: string) {
  const [profile, tenant, user, contract, contact, carrier] = await Promise.all([
    db().from("agency_profiles").select("legal_name, dba, npn, principal_address").eq("tenant_id", tenantId).maybeSingle(),
    db().from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    db().from("users").select("name, email, phone").eq("id", userId).maybeSingle(),
    db().from("tenant_carriers").select("writing_number").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("is_active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    getCarrierCommissionContact(tenantId, carrierId).catch(() => ({ available: false, contact: null })),
    db().from("carriers").select("name").eq("id", carrierId).maybeSingle(),
  ]);
  return {
    agencyName: profile.data?.dba?.trim() || profile.data?.legal_name?.trim() || tenant.data?.name?.trim() || "Our agency",
    agencyAddress: profile.data?.principal_address ?? null,
    npn: profile.data?.npn ?? null,
    writingNumber: contract.data?.writing_number ?? null,
    carrierName: carrier.data?.name ?? "The carrier",
    savedRecipient: (contact as Loose).contact?.address ?? null,
    signer: { name: user.data?.name ?? null, email: user.data?.email ?? null, phone: user.data?.phone ?? null },
  };
}

async function letterItems(tenantId: string, ids: string[]) {
  const { data, error } = await db().from("commission_discrepancy").select("*").eq("tenant_id", tenantId).in("id", ids);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Loose[];
  if (!rows.length) throw new DiscrepancyError("Choose items from this agency's list.", 400);
  if (new Set(rows.map((r) => r.carrier_id)).size > 1) throw new DiscrepancyError("A letter goes to one carrier; choose items of one carrier.", 400);
  if (rows.some((r) => r.status !== "open")) throw new DiscrepancyError("Only open items can go on a new letter.", 409);
  const withheld = await untraceableDiscrepancies(tenantId);
  if (rows.some((r) => withheld?.has(r.id))) throw new DiscrepancyError("One of these items can't be traced to its source rows right now, so it can't go on a letter.", 409);
  const items: LetterItem[] = rows.filter((r) => DISPUTABLE.has(r.discrepancy_type)).map((r) => ({
    id: r.id, type: r.discrepancy_type, policyNumber: r.policy_number, expectedCents: r.expected_amount_cents === null ? null : Number(r.expected_amount_cents),
    reportedCents: r.reported_amount_cents === null ? null : Number(r.reported_amount_cents), differenceCents: r.difference_cents === null ? null : Number(r.difference_cents),
    toleranceCents: r.tolerance_applied_cents === null ? null : Number(r.tolerance_applied_cents), expectedSource: r.expected_source, evidence: r.evidence ?? {}, lines: (r.reported_entry_ids ?? []).length,
  }));
  if (!items.length) throw new DiscrepancyError("None of these is something to dispute: held money, a debit balance, an overpayment or a chargeback that is coming are for you, not the carrier.", 400);
  return { carrierId: rows[0].carrier_id as string, items };
}

/** A preview of the letter, without saving anything. */
export async function previewLetter(tenantId: string, userId: string, ids: string[], recipient: string | null) {
  const { carrierId, items } = await letterItems(tenantId, ids);
  const p = await parties(tenantId, userId, carrierId);
  const { body, totalCents } = letterText({ ...p, recipient: recipient ?? p.savedRecipient, today: new Date().toISOString().slice(0, 10) }, items);
  return { carrierId, body, totalCents, recipient: recipient ?? p.savedRecipient, items: items.length };
}

/** Save the letter as a draft (its text frozen) and mark its items disputed. Nothing is sent. */
export async function draftDispute(tenantId: string, userId: string, ids: string[], recipient: string | null) {
  const preview = await previewLetter(tenantId, userId, ids, recipient);
  const { data, error } = await db().from("commission_dispute").insert({
    tenant_id: tenantId, carrier_id: preview.carrierId, discrepancy_ids: ids, recipient: preview.recipient, letter_body: preview.body, total_cents: preview.totalCents, created_by: userId,
  }).select("id").single();
  if (error) {
    if (isSchemaGap(error)) throw new DiscrepancyError(DISCREPANCIES_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the letter: ${error.message}`);
  }
  await db().rpc("attach_dispute", { p_tenant_id: tenantId, p_dispute_id: data.id, p_ids: ids, p_status: "disputed" });
  return { id: data.id as string, totalCents: preview.totalCents };
}

export type DisputeUpdate =
  | { action: "sent"; via: "email" | "portal" | "post" }
  | { action: "acknowledged" }
  | { action: "outcome"; outcome: "accepted" | "rejected" | "partial"; amountCents: number | null; notes: string | null };

/** What happened to a letter: sent (how), acknowledged, and how it ended — with what was credited. */
export async function updateDispute(tenantId: string, id: string, change: DisputeUpdate) {
  const { data: dispute } = await db().from("commission_dispute").select("id, status, total_cents").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!dispute) throw new DiscrepancyError("That letter is not this agency's.", 404);
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (change.action === "sent") {
    if (dispute.status !== "draft") throw new DiscrepancyError("This letter is already marked sent.", 409);
    patch = { status: "sent", sent_at: now, sent_via: change.via };
  } else if (change.action === "acknowledged") {
    if (dispute.status !== "sent") throw new DiscrepancyError("Only a sent letter can be acknowledged.", 409);
    patch = { status: "acknowledged" };
  } else {
    if (!["sent", "acknowledged"].includes(dispute.status)) throw new DiscrepancyError(dispute.status === "draft" ? "Mark the letter sent first." : "This letter's outcome is already recorded.", 409);
    if (change.outcome === "partial" && (!change.amountCents || change.amountCents <= 0)) throw new DiscrepancyError("Enter the amount the carrier credited.", 400);
    const amount = change.outcome === "accepted" ? change.amountCents ?? Number(dispute.total_cents) : change.outcome === "partial" ? change.amountCents : 0;
    patch = { status: change.outcome, outcome_amount_cents: amount, resolved_at: now, notes: change.notes };
  }
  const { error } = await db().from("commission_dispute").update({ ...patch, updated_at: now }).eq("tenant_id", tenantId).eq("id", id);
  if (error) throw new Error(`Could not save: ${error.message}`);
  if (change.action === "outcome") {
    // Credited (fully or in part): the items are settled; rejected: they are open again to decide.
    await db().rpc("attach_dispute", { p_tenant_id: tenantId, p_dispute_id: id, p_ids: null, p_status: change.outcome === "rejected" ? "open" : "resolved" });
  }
}

/** The letter as a PDF: the frozen text, in a fixed-width face so the figures line up. */
export async function disputePdf(tenantId: string, id: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const { data } = await db().from("commission_dispute").select("letter_body, carrier_id, created_at").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: carrier } = await db().from("carriers").select("name").eq("id", data.carrier_id).maybeSingle();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Commission dispute - ${carrier?.name ?? "carrier"}`);
  pdf.setProducer("Insurvas");
  const font = await pdf.embedFont(StandardFonts.Courier);
  const W = 612, H = 792, M = 54, size = 9, lead = 12.5;
  const maxChars = Math.floor((W - 2 * M) / font.widthOfTextAtSize("M", size));
  const safe = (t: string) => t.replace(/[−‒–—]/g, "-").replace(/·/g, "-").replace(/[^\u0009\u000a -ÿ]/g, "?");
  const lines: string[] = [];
  for (const raw of safe(data.letter_body).split("\n")) {
    if (raw.length <= maxChars) { lines.push(raw); continue; }
    const indent = raw.match(/^\s*/)?.[0] ?? "";
    let line = "";
    for (const word of raw.trim().split(/\s+/)) {
      const next = line ? `${line} ${word}` : `${indent}${word}`;
      if (next.length > maxChars && line) { lines.push(line); line = `${indent}${word}`; } else line = next;
    }
    lines.push(line);
  }
  let page = pdf.addPage([W, H]);
  let y = H - M;
  for (const line of lines) {
    if (y - lead < M) { page = pdf.addPage([W, H]); y = H - M; }
    page.drawText(line, { x: M, y: y - size, size, font, color: rgb(0, 0, 0) });
    y -= lead;
  }
  return { bytes: await pdf.save(), filename: `dispute-${(carrier?.name ?? "carrier").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(data.created_at).slice(0, 10)}.pdf` };
}
