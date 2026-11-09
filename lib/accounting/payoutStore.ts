import "server-only";

import { csvCell } from "@/lib/csv/cell";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { BusinessIdentityMissingError, loadBusinessIdentity, requireBusinessIdentity } from "@/lib/agencyProfile/identity";

import { ITEM_LABELS, partnerStatement, statementLines, type ItemType, type RunDispute, type RunHeader, type RunItem } from "./payoutsCore";
import type { PaidMethod } from "./invoicesCore";
import { ACCOUNTING_BUCKET } from "./invoiceStore";
import { loadAccountingSettings } from "./settingsStore";
import { buildPartnerInvoicePdf } from "./partnerInvoicePdf";
import {
  CHARGEBACK_POLICIES, PARTNER_PAYMENT_METHOD_LABELS, PAYOUT_CADENCES, entryState, expectedPayOn, invoiceRef, isRulebookModel,
  type ChargebackPolicy, type LedgerEntry, type PartnerPaymentMethod, type PartnerRulebook, type PayoutCadence, type RulebookModel, type TrackerRow,
} from "./partnerPayoutCore";

/**
 * LA-7.4 (Notion sprint, Module 7 — Accounting) · partner payouts, server side. Every move is one
 * of the database's writers (20261015240000); this file only reads tables and calls them. No
 * outbound payment API is called anywhere: the agent pays as they pay today and records it here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const PAYOUTS_PENDING_MESSAGE = "Payout runs need a database update (20261015200000–20261015240000).";
/** The rulebook, the ledger and the invoice machine (owner, 2026-11-06) wait for this paste. */
export const LEDGER_PENDING_MESSAGE = "The partner ledger needs a database update (supabase/deploy/2026-11-06-partner-payouts.sql).";

export class PayoutError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new PayoutError(PAYOUTS_PENDING_MESSAGE, 503);
  if (error.code === "P0002") throw new PayoutError(error.message.replace(/^\w+: /, ""), 404);
  // The database names which: a run over part of the period, an invoice that booked it, an item already disputed.
  if (error.code === "23505") throw new PayoutError(/already covers|invoice from this partner|already disputed/.test(error.message) ? error.message.replace(/^\w+: /, "") : "There is already a run for this partner and period: void it first, or open it.", 409);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new PayoutError(error.message.replace(/^\w+: /, ""), 400);
  throw new Error(error.message);
}

const toHeader = (r: Loose): RunHeader => ({
  id: r.id, partnerId: r.partner_id, periodStart: r.period_start, periodEnd: r.period_end, status: r.status, grossCents: Number(r.gross_cents), deductionsCents: Number(r.deductions_cents),
  disputedCents: Number(r.disputed_cents), netCents: Number(r.net_cents), paidOn: r.paid_on, publishedAt: r.published_at, footer: r.statement_footer,
  invoiceNumber: r.invoice_number ?? null, hasPdf: Boolean(r.invoice_pdf_path),
});
const toItem = (i: Loose): RunItem => ({ id: i.id, itemType: i.item_type, sourceId: i.source_id, occurredOn: i.occurred_on, rateAppliedCents: i.rate_applied_cents == null ? null : Number(i.rate_applied_cents), ratePctBp: i.rate_pct_bp, amountCents: Number(i.amount_cents), note: i.note });
const toDispute = (d: Loose): RunDispute => ({ id: d.id, itemId: d.item_id, side: d.raised_by_side, reason: d.reason, claimCents: Number(d.claim_cents), status: d.status, resolutionNote: d.resolution_note, raisedAt: d.raised_at, resolvedAt: d.resolved_at, carriedToRunId: d.carried_to_run_id });

const BASE_RUN_COLUMNS = "id, partner_id, period_start, period_end, status, gross_cents, deductions_cents, disputed_cents, net_cents, paid_on, paid_method, payment_reference, published_at, statement_footer, void_reason, terms_snapshot_json, created_at";

/**
 * Whether 2026-11-06's partner ledger is live (the paste in supabase/deploy). Until it is, every screen
 * keeps working as LA-7.4 built it and the new parts say they are waiting. Asked once a minute.
 */
let ledgerProbe: { at: number; live: boolean } | null = null;
export async function ledgerLive(): Promise<boolean> {
  if (ledgerProbe && Date.now() - ledgerProbe.at < 60_000) return ledgerProbe.live;
  const { error } = await db().from("partner_ledger_entry").select("id").limit(1);
  const live = !error;
  if (error && !isSchemaGap(error)) console.error("[payouts] ledger probe", error.message);
  ledgerProbe = { at: Date.now(), live };
  return live;
}
const runColumns = async () => (await ledgerLive()) ? `${BASE_RUN_COLUMNS}, invoice_number, invoice_pdf_path` : BASE_RUN_COLUMNS;

async function partnerNames(tenantId: string) {
  const { data, error } = await db().from("partners").select("id, name, status").eq("tenant_id", tenantId).order("name");
  if (error) fail(error);
  const rows = (data ?? []) as Loose[];
  if (rows.length === 0) return [];
  const { data: terms, error: termsError } = await db()
    .from("partner_terms")
    .select("partner_id, effective_from")
    .in("partner_id", rows.map((partner) => partner.id))
    .order("effective_from", { ascending: true });
  if (termsError) fail(termsError);
  const firstTermByPartner = new Map<string, string>();
  for (const term of (terms ?? []) as Loose[]) {
    if (!firstTermByPartner.has(term.partner_id)) firstTermByPartner.set(term.partner_id, term.effective_from);
  }
  return rows.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    status: p.status as string,
    firstTermDate: firstTermByPartner.get(p.id) ?? null,
  }));
}

export async function listRuns(tenantId: string) {
  const [{ data, error }, partners] = await Promise.all([
    db().from("payout_run").select(await runColumns()).eq("tenant_id", tenantId).order("period_start", { ascending: false }).order("id").limit(500),
    partnerNames(tenantId),
  ]);
  if (error) fail(error);
  const name = new Map(partners.map((p) => [p.id, p.name]));
  return { runs: ((data ?? []) as Loose[]).map((r) => ({ ...toHeader(r), partnerName: name.get(r.partner_id) ?? "Partner" })), partners };
}

async function items(tenantId: string, runId: string): Promise<RunItem[]> {
  const live = await ledgerLive();
  const out: Loose[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await db().from("payout_run_item").select(`id, item_type, source_id, occurred_on, rate_applied_cents, rate_pct_bp, amount_cents, note${live ? ", ledger_entry_id" : ""}`).eq("tenant_id", tenantId).eq("run_id", runId).order("occurred_on").order("id").range(from, from + 999);
    if (error) fail(error);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const base = out.map(toItem);
  if (!live) return base;
  // From the ledger: the commission a share was taken from, the policy, and the client's name.
  const ids = out.map((i) => i.ledger_entry_id).filter(Boolean) as string[];
  const entries = new Map<string, Loose>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from("partner_ledger_entry").select("id, deal_id, policy_number, carrier, basis_cents").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
    if (error) fail(error);
    for (const e of (data ?? []) as Loose[]) entries.set(e.id, e);
  }
  const names = await clientNames(tenantId, [...entries.values()].map((e) => e.deal_id).filter(Boolean));
  return base.map((item, index) => {
    const e = entries.get(out[index].ledger_entry_id);
    if (!e) return item;
    return { ...item, basisCents: e.basis_cents == null ? null : Number(e.basis_cents), policyNumber: e.policy_number ?? null, carrier: e.carrier ?? null, clientName: e.deal_id ? names.get(e.deal_id) ?? null : null };
  });
}

/** Client names for deals, as the tracker reads them (the lead's full name, else first and last). */
async function clientNames(tenantId: string, dealIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(dealIds)];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await db().from("partner_client_tracker").select("deal_id, client_name").eq("tenant_id", tenantId).in("deal_id", unique.slice(i, i + 200));
    if (error) fail(error);
    for (const r of (data ?? []) as Loose[]) out.set(r.deal_id, r.client_name);
  }
  return out;
}

async function disputes(tenantId: string, runId: string): Promise<RunDispute[]> {
  const { data, error } = await db().from("payout_dispute").select("*").eq("tenant_id", tenantId).eq("run_id", runId).order("raised_at");
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map(toDispute);
}

export async function getRun(tenantId: string, id: string) {
  // Items and disputes (this tenant's, this run's) start beside the run read; their failure surfaces after the run's checks.
  const lines = Promise.all([items(tenantId, id), disputes(tenantId, id)]);
  lines.catch(() => {});
  const { data: r, error } = await db().from("payout_run").select(await runColumns()).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!r) throw new PayoutError("That run isn't in this agency.", 404);
  const [[its, ds], partner] = await Promise.all([lines, db().from("partners").select("name").eq("id", r.partner_id).maybeSingle()]);
  return {
    ...toHeader(r), partnerName: partner.data?.name ?? "Partner", paidMethod: r.paid_method as PaidMethod | null, paymentReference: r.payment_reference as string | null,
    voidReason: r.void_reason as string | null, terms: r.terms_snapshot_json as { id: string; payout_model: string; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string }[],
    lines: statementLines(its), items: its, disputes: ds,
    // What the partner will see once it is published — shown to the agency before publishing.
    partnerView: partnerStatement({ ...toHeader(r), status: r.status === "draft" ? "published" : r.status }, its, ds),
  };
}

export async function buildRun(tenantId: string, by: string, partnerId: string, from: string, to: string): Promise<string> {
  const { data, error } = await db().rpc("build_payout_run", { p_tenant_id: tenantId, p_partner_id: partnerId, p_from: from, p_to: to, p_by: by });
  if (error) fail(error);
  return data as string;
}

/** LA-8.3: a statement shows who it is from — the business identity's trading name and address. */
async function statementSender(tenantId: string) {
  try {
    const identity = await requireBusinessIdentity(tenantId, "payout_statement");
    return { name: identity.tradingName ?? "", addressLines: identity.addressLines };
  } catch (error) {
    if (error instanceof BusinessIdentityMissingError) throw new PayoutError(error.message, error.status);
    throw error;
  }
}

export async function publishRun(tenantId: string, id: string, by: string) {
  // Checked here for the prompt; publish_payout_run refuses on its own too (the overnight auto-publish has no app in front of it).
  await statementSender(tenantId);
  const { error } = await db().rpc("publish_payout_run", { p_tenant_id: tenantId, p_run_id: id, p_by: by });
  if (error) fail(error);
  // The invoice PDF is stored as it is published, for the partner's Commissions section. A failure here
  // never undoes the publish: the PDF is drawn on request when no stored copy exists.
  await storeInvoicePdf(tenantId, id).catch((cause: unknown) => console.error("[payouts] invoice pdf", cause instanceof Error ? cause.message : cause));
}

export async function markRunPaid(tenantId: string, id: string, input: { paidOn: string; method: PaidMethod | null; reference: string | null }) {
  const { error } = await db().rpc("mark_payout_run_paid", { p_tenant_id: tenantId, p_run_id: id, p_paid_on: input.paidOn, p_method: input.method, p_reference: input.reference });
  if (error) fail(error);
}

export async function voidRun(tenantId: string, id: string, reason: string, by: string) {
  const { data, error } = await db().rpc("void_payout_run", { p_tenant_id: tenantId, p_run_id: id, p_reason: reason, p_by: by });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function raiseAgentDispute(tenantId: string, runId: string, itemId: string, reason: string, by: string) {
  const { data, error } = await db().rpc("raise_payout_dispute", { p_tenant_id: tenantId, p_run_id: runId, p_item_id: itemId, p_side: "agent", p_by: by, p_reason: reason, p_claim_cents: null });
  if (error) fail(error);
  return data as string;
}

export async function resolveDispute(tenantId: string, disputeId: string, status: "accepted" | "upheld", note: string, by: string) {
  const { error } = await db().rpc("resolve_payout_dispute", { p_tenant_id: tenantId, p_dispute_id: disputeId, p_status: status, p_note: note, p_by: by });
  if (error) fail(error);
}

/** The statement as a CSV the agent can send: the same lines the partner sees, item by item. */
export async function statementCsv(tenantId: string, id: string): Promise<{ filename: string; body: string }> {
  const [run, from] = await Promise.all([getRun(tenantId, id), statementSender(tenantId)]);
  const view = run.partnerView;
  const rows: unknown[][] = [[from.name], ...from.addressLines.map((line) => [line]), [], [`${run.partnerName} · ${run.periodStart} to ${run.periodEnd}`], [], ["Line", "Count", "Rate", "Amount"]];
  const dollars = (c: number | null) => (c == null ? "" : `${c < 0 ? "-" : ""}${String(Math.abs(c)).padStart(3, "0").slice(0, -2)}.${String(Math.abs(c)).padStart(3, "0").slice(-2)}`);
  for (const l of view?.lines ?? []) rows.push([l.label, l.count, dollars(l.rateCents), dollars(l.amountCents)]);
  if (view?.revenueShare) rows.push(["Revenue share", "", "", dollars(view.revenueShare.amountCents)]);
  if (view?.rejectedCount) rows.push([ITEM_LABELS.rejected, view.rejectedCount, "", ""]);
  if (view?.credits.count) rows.push([`${ITEM_LABELS.credit} (${view.credits.count})`, "", "", dollars(view.credits.amountCents)]);
  for (const d of run.disputes.filter((x) => x.side === "agent")) rows.push([`Disputed — ${d.reason}`, "", "", dollars(-d.claimCents)]);
  rows.push([], ["Net payable", "", "", dollars(run.netCents)]);
  if (run.footer) rows.push([], [run.footer]);
  rows.push([], ["Item", "Date", "Rate", "Amount", "Reference"]);
  for (const i of view?.items ?? []) rows.push([i.label, i.occurredOn, dollars(i.rateCents), dollars(i.amountCents), i.reference ?? ""]);
  return { filename: `payout-${run.partnerName.replace(/[^A-Za-z0-9]+/g, "-")}-${run.periodStart}.csv`, body: rows.map((r) => r.map(csvCell).join(",")).join("\r\n") };
}

// ─── the partner's side ───────────────────────────────────────────────────────────────────────
// Every read here is filtered by the session's tenant AND partner, and by status: a draft does not exist for the partner.

export async function partnerRuns(tenantId: string, partnerId: string, limit = 120) {
  const live = await ledgerLive();
  const { data, error } = await db().from("payout_run").select(`id, period_start, period_end, status, net_cents, paid_on, published_at${live ? ", invoice_number" : ""}`)
    .eq("tenant_id", tenantId).eq("partner_id", partnerId).in("status", ["published", "paid"]).order("period_start", { ascending: false }).limit(Math.max(1, Math.min(120, Math.floor(limit))));
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => ({ id: r.id as string, periodStart: r.period_start as string, periodEnd: r.period_end as string, status: r.status as "published" | "paid", netCents: Number(r.net_cents), paidOn: r.paid_on as string | null, invoiceNumber: (r.invoice_number ?? null) as string | null }));
}

async function partnerRun(tenantId: string, partnerId: string, id: string) {
  const { data: r, error } = await db().from("payout_run").select(await runColumns()).eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("id", id).in("status", ["published", "paid"]).maybeSingle();
  if (error) fail(error);
  if (!r) throw new PayoutError("Not found", 404);
  return r;
}

export async function partnerStatementFor(tenantId: string, partnerId: string, id: string) {
  const r = await partnerRun(tenantId, partnerId, id);
  const [its, ds, identity] = await Promise.all([items(tenantId, id), disputes(tenantId, id), loadBusinessIdentity(tenantId).catch(() => null)]);
  const statement = partnerStatement(toHeader(r), its, ds);
  // Who it is from (LA-8.3), as the business identity reads now. A published run was checked for it.
  return statement && { ...statement, from: { name: identity?.tradingName ?? null, addressLines: identity?.addressLines ?? [] } };
}

/** A partner raises a dispute on its own published run — about one of its billable items, or the run as a whole. */
export async function raisePartnerDispute(tenantId: string, partnerId: string, userId: string, runId: string, input: { itemId: string | null; reason: string; claimCents: number }) {
  const run = await partnerRun(tenantId, partnerId, runId);
  // A claim is at most what it disputes: the item, or the run's gross for the run as a whole (raise_payout_dispute refuses the same).
  let ceiling = Math.max(Number(run.gross_cents), 0);
  if (input.itemId) {
    const { data } = await db().from("payout_run_item").select("item_type, amount_cents").eq("tenant_id", tenantId).eq("run_id", runId).eq("id", input.itemId).maybeSingle();
    // Rejected items have no identity on the partner's side; only billable lines can be named.
    if (!data || !["submitted_application", "transfer", "lead", "sale", "issued_policy", "adjustment", "clawback", "carried_balance"].includes(data.item_type)) throw new PayoutError("Not found", 404);
    ceiling = Math.max(Number(data.amount_cents), 0);
  }
  if (input.claimCents > ceiling) throw new PayoutError("The claim is more than what it disputes.");
  const { data, error } = await db().rpc("raise_payout_dispute", { p_tenant_id: tenantId, p_run_id: runId, p_item_id: input.itemId, p_side: "partner", p_by: userId, p_reason: input.reason, p_claim_cents: input.claimCents });
  if (error) fail(error);
  return data as string;
}

// ─── the rulebook (owner, 2026-11-06) ─────────────────────────────────────────────────────────

type TermRow = { id: string; payout_model: string; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string };
const today = () => new Date().toISOString().slice(0, 10);

async function terms(partnerIds: string[]): Promise<Map<string, TermRow[]>> {
  const out = new Map<string, TermRow[]>();
  if (!partnerIds.length) return out;
  const { data, error } = await db().from("partner_terms").select("id, partner_id, payout_model, rate_cents, rate_pct_bp, effective_from").in("partner_id", partnerIds).order("effective_from", { ascending: true });
  if (error) fail(error);
  for (const t of (data ?? []) as Loose[]) out.set(t.partner_id, [...(out.get(t.partner_id) ?? []), { ...t, rate_cents: t.rate_cents == null ? null : Number(t.rate_cents) }]);
  return out;
}

/** The term in force today, else the next one to start. */
function currentTerm(rows: TermRow[] | undefined): TermRow | null {
  if (!rows?.length) return null;
  const now = today();
  return [...rows].reverse().find((t) => t.effective_from <= now) ?? rows[0];
}

async function ownPartner(tenantId: string, partnerId: string) {
  const { data, error } = await db().from("partners").select("id, name, status, contact_name, contact_email").eq("tenant_id", tenantId).eq("id", partnerId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new PayoutError("That partner isn't in this agency.", 404);
  return data as Loose;
}

export type RulebookView = PartnerRulebook & { partnerId: string; partnerName: string; partnerStatus: string; terms: TermRow[]; legacy: boolean; agencyCadence: PayoutCadence; draftDays: number };

export async function getRulebook(tenantId: string, partnerId: string): Promise<RulebookView> {
  if (!(await ledgerLive())) throw new PayoutError(LEDGER_PENDING_MESSAGE, 503);
  const [partner, termMap, settings, profileRead] = await Promise.all([
    ownPartner(tenantId, partnerId),
    terms([partnerId]),
    loadAccountingSettings(tenantId).catch(() => null),
    db().from("partner_payout_profile").select("*").eq("tenant_id", tenantId).eq("partner_id", partnerId).maybeSingle(),
  ]);
  if (profileRead.error) fail(profileRead.error);
  const profile = profileRead.data as Loose | null;
  const rows = termMap.get(partnerId) ?? [];
  const term = currentTerm(rows);
  const agencyCadence = (settings?.payoutCadence ?? "monthly") as PayoutCadence;
  return {
    partnerId, partnerName: partner.name, partnerStatus: partner.status, terms: rows,
    model: term?.payout_model ?? null, rateCents: term?.rate_cents ?? null, ratePctBp: term?.rate_pct_bp ?? null, termFrom: term?.effective_from ?? null,
    legacy: Boolean(term && !isRulebookModel(term.payout_model)),
    cadence: (profile?.cadence ?? agencyCadence) as PayoutCadence, cadenceOwn: Boolean(profile?.cadence), agencyCadence,
    chargebackPolicy: (profile?.chargeback_policy ?? "partner_shares") as ChargebackPolicy,
    payeeName: profile?.payee_name ?? partner.contact_name ?? null,
    payeeEmail: profile?.payee_email ?? partner.contact_email ?? null,
    paymentMethod: (profile?.payment_method ?? null) as PartnerPaymentMethod | null,
    paymentNote: profile?.payment_note ?? null,
    draftDays: settings?.payoutDraftDays ?? 3,
  };
}

export type RulebookInput = {
  model: RulebookModel; rateCents: number | null; ratePctBp: number | null; startsOn: string;
  cadence: PayoutCadence; chargebackPolicy: ChargebackPolicy; payeeName: string | null; payeeEmail: string | null; paymentMethod: PartnerPaymentMethod | null; paymentNote: string | null;
};

/**
 * Saves the rulebook: the price as a new term (insert-only, from its start date; the old one keeps
 * pricing what came before), and the timer, chargebacks and payee on the profile. A price that has not
 * changed adds no term.
 */
export async function saveRulebook(tenantId: string, by: string, partnerId: string, input: RulebookInput): Promise<{ termAdded: boolean }> {
  if (!(await ledgerLive())) throw new PayoutError(LEDGER_PENDING_MESSAGE, 503);
  if (!PAYOUT_CADENCES.includes(input.cadence) || !CHARGEBACK_POLICIES.includes(input.chargebackPolicy)) throw new PayoutError("Choose a pay schedule and who carries chargebacks.");
  if (input.model === "revenue_share" ? !(input.ratePctBp && input.ratePctBp >= 1 && input.ratePctBp <= 10000) : !(input.rateCents != null && input.rateCents >= 0)) throw new PayoutError("Enter how much they are paid.");
  const partner = await ownPartner(tenantId, partnerId);
  if (partner.status === "offboarded") throw new PayoutError("This partner is offboarded: its rulebook can no longer change.");
  const current = currentTerm((await terms([partnerId])).get(partnerId));
  const samePrice = current && current.payout_model === input.model && (input.model === "revenue_share" ? current.rate_pct_bp === input.ratePctBp : current.rate_cents === input.rateCents);
  let termAdded = false;
  if (!samePrice) {
    const { error } = await db().rpc("add_partner_term", {
      p_tenant_id: tenantId, p_partner_id: partnerId, p_payout_model: input.model,
      p_rate_cents: input.model === "revenue_share" ? null : input.rateCents, p_rate_pct_bp: input.model === "revenue_share" ? input.ratePctBp : null,
      p_effective_from: input.startsOn, p_created_by: by,
    });
    if (error) {
      if (error.code === "23505") throw new PayoutError("A price already starts on that day. Pick the next day for the new one.", 409);
      fail(error);
    }
    termAdded = true;
  }
  const { error } = await db().from("partner_payout_profile").upsert({
    partner_id: partnerId, tenant_id: tenantId, cadence: input.cadence, chargeback_policy: input.chargebackPolicy,
    payee_name: input.payeeName, payee_email: input.payeeEmail, payment_method: input.paymentMethod, payment_note: input.paymentNote,
    updated_by: by, updated_at: new Date().toISOString(),
  }, { onConflict: "partner_id" });
  if (error) fail(error);
  return { termAdded };
}

export type RulebookRow = { partnerId: string; partnerName: string; status: string; model: string | null; rateCents: number | null; ratePctBp: number | null; legacy: boolean; cadence: PayoutCadence; cadenceOwn: boolean; chargebackPolicy: ChargebackPolicy; payee: string | null; paymentMethod: string | null };

/** Every partner's rulebook in one list (the Rulebooks tab). */
export async function listRulebooks(tenantId: string): Promise<RulebookRow[]> {
  if (!(await ledgerLive())) throw new PayoutError(LEDGER_PENDING_MESSAGE, 503);
  const { data, error } = await db().from("partners").select("id, name, status, contact_name").eq("tenant_id", tenantId).neq("status", "offboarded").order("name");
  if (error) fail(error);
  const partners = (data ?? []) as Loose[];
  const [termMap, profiles, settings] = await Promise.all([
    terms(partners.map((p) => p.id)),
    db().from("partner_payout_profile").select("partner_id, cadence, chargeback_policy, payee_name, payment_method").eq("tenant_id", tenantId),
    loadAccountingSettings(tenantId).catch(() => null),
  ]);
  if (profiles.error) fail(profiles.error);
  const byPartner = new Map(((profiles.data ?? []) as Loose[]).map((p) => [p.partner_id, p]));
  return partners.map((p) => {
    const t = currentTerm(termMap.get(p.id));
    const pr = byPartner.get(p.id);
    return {
      partnerId: p.id, partnerName: p.name, status: p.status, model: t?.payout_model ?? null, rateCents: t?.rate_cents ?? null, ratePctBp: t?.rate_pct_bp ?? null,
      legacy: Boolean(t && !isRulebookModel(t.payout_model)),
      cadence: (pr?.cadence ?? settings?.payoutCadence ?? "monthly") as PayoutCadence, cadenceOwn: Boolean(pr?.cadence),
      chargebackPolicy: (pr?.chargeback_policy ?? "partner_shares") as ChargebackPolicy,
      payee: pr?.payee_name ?? p.contact_name ?? null, paymentMethod: pr?.payment_method ? PARTNER_PAYMENT_METHOD_LABELS[pr.payment_method as PartnerPaymentMethod] ?? pr.payment_method : null,
    };
  });
}

// ─── the ledger ───────────────────────────────────────────────────────────────────────────────

export type LedgerRow = LedgerEntry & { partnerName: string; clientName: string | null; invoiceNumber: string | null; expectedOn: string | null; state: ReturnType<typeof entryState> };

const toEntry = (e: Loose): LedgerEntry => ({
  id: e.id, partnerId: e.partner_id, sourceType: e.source_type, dealId: e.deal_id, policyNumber: e.policy_number, carrier: e.carrier, earnedOn: e.earned_on,
  rateCents: e.rate_cents == null ? null : Number(e.rate_cents), ratePctBp: e.rate_pct_bp, basisCents: e.basis_cents == null ? null : Number(e.basis_cents),
  amountCents: Number(e.amount_cents), note: e.note, runId: e.run_id, paidAt: e.paid_at,
});

async function cadences(tenantId: string): Promise<{ byPartner: Map<string, PayoutCadence>; agency: PayoutCadence; draftDays: number }> {
  const [settings, profiles] = await Promise.all([loadAccountingSettings(tenantId).catch(() => null), db().from("partner_payout_profile").select("partner_id, cadence").eq("tenant_id", tenantId)]);
  if (profiles.error) fail(profiles.error);
  return { byPartner: new Map(((profiles.data ?? []) as Loose[]).map((p) => [p.partner_id, p.cadence as PayoutCadence])), agency: (settings?.payoutCadence ?? "monthly") as PayoutCadence, draftDays: settings?.payoutDraftDays ?? 3 };
}

/**
 * The ledger, newest first: every entry with its partner, client, invoice and — while unpaid — when it is
 * expected to be invoiced. Fills it first for the partners asked about (idempotent), so it is current.
 */
export async function listLedger(tenantId: string, opts: { partnerId?: string | null; sync?: boolean } = {}): Promise<{ rows: LedgerRow[]; partners: { id: string; name: string }[] }> {
  if (!(await ledgerLive())) throw new PayoutError(LEDGER_PENDING_MESSAGE, 503);
  const { data: partnerRows, error: pe } = await db().from("partners").select("id, name, status").eq("tenant_id", tenantId).order("name");
  if (pe) fail(pe);
  const partners = (partnerRows ?? []) as Loose[];
  if (opts.sync !== false) {
    const targets = partners.filter((p) => p.status !== "offboarded" && (!opts.partnerId || p.id === opts.partnerId));
    for (const p of targets) {
      const { error } = await db().rpc("sync_partner_ledger", { p_tenant_id: tenantId, p_partner_id: p.id });
      if (error) fail(error);
    }
  }
  let q = db().from("partner_ledger_entry").select("id, partner_id, source_type, deal_id, policy_number, carrier, earned_on, rate_cents, rate_pct_bp, basis_cents, amount_cents, note, run_id, paid_at").eq("tenant_id", tenantId);
  if (opts.partnerId) q = q.eq("partner_id", opts.partnerId);
  const { data, error } = await q.order("earned_on", { ascending: false }).order("id").limit(3000);
  if (error) fail(error);
  const entries = ((data ?? []) as Loose[]).map(toEntry);
  const runIds = [...new Set(entries.map((e) => e.runId).filter(Boolean))] as string[];
  const invoices = new Map<string, string>();
  for (let i = 0; i < runIds.length; i += 200) {
    const { data: runs, error: re } = await db().from("payout_run").select("id, invoice_number").eq("tenant_id", tenantId).in("id", runIds.slice(i, i + 200));
    if (re) fail(re);
    for (const r of (runs ?? []) as Loose[]) invoices.set(r.id, invoiceRef({ id: r.id, invoiceNumber: r.invoice_number }));
  }
  const [names, timers] = await Promise.all([clientNames(tenantId, entries.map((e) => e.dealId).filter(Boolean) as string[]), cadences(tenantId)]);
  const partnerName = new Map(partners.map((p) => [p.id, p.name as string]));
  const now = today();
  return {
    partners: partners.map((p) => ({ id: p.id, name: p.name })),
    rows: entries.map((e) => ({
      ...e, partnerName: partnerName.get(e.partnerId) ?? "Partner", clientName: e.dealId ? names.get(e.dealId) ?? null : null,
      invoiceNumber: e.runId ? invoices.get(e.runId) ?? null : null, state: entryState(e),
      expectedOn: e.runId ? null : expectedPayOn(timers.byPartner.get(e.partnerId) ?? timers.agency, e.earnedOn, now, timers.draftDays),
    })),
  };
}

// ─── the invoice machine ──────────────────────────────────────────────────────────────────────

export type InvoicePreview = { partnerId: string; partnerName: string; cadence: PayoutCadence; periodStart: string; periodEnd: string; items: number; netCents: number; runId: string | null; problem: string | null };

/** Every partner whose timer is up, as of today: previewed (writes only the ledger) or built as draft invoices. */
export async function runInvoices(tenantId: string, by: string, opts: { dryRun: boolean; partnerIds?: string[] | null; asOf?: string }): Promise<InvoicePreview[]> {
  if (!(await ledgerLive())) throw new PayoutError(LEDGER_PENDING_MESSAGE, 503);
  const { data, error } = await db().rpc("run_partner_invoices", { p_tenant_id: tenantId, p_as_of: opts.asOf ?? today(), p_by: by, p_partner_ids: opts.partnerIds?.length ? opts.partnerIds : null, p_dry_run: opts.dryRun });
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => ({
    partnerId: r.partner_id, partnerName: r.partner_name, cadence: r.cadence, periodStart: r.period_start, periodEnd: r.period_end,
    items: Number(r.items), netCents: Number(r.net_cents), runId: r.run_id ?? null, problem: r.problem ?? null,
  }));
}

// ─── the invoice PDF ──────────────────────────────────────────────────────────────────────────

const pdfPath = (tenantId: string, runId: string) => `${tenantId}/partner-invoices/${runId}.pdf`;
const fileName = (ref: string, partner: string) => `${ref}-${partner.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;

async function drawInvoicePdf(tenantId: string, runId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const run = await getRun(tenantId, runId);
  const live = await ledgerLive();
  const [identity, profileRead, settings] = await Promise.all([
    loadBusinessIdentity(tenantId).catch(() => null),
    live ? db().from("partner_payout_profile").select("payee_name, payee_email, payment_method, cadence").eq("tenant_id", tenantId).eq("partner_id", run.partnerId).maybeSingle() : Promise.resolve({ data: null }),
    loadAccountingSettings(tenantId).catch(() => null),
  ]);
  const pr = (profileRead as { data: Loose | null }).data;
  const ref = invoiceRef({ id: run.id, invoiceNumber: run.invoiceNumber });
  const bytes = await buildPartnerInvoicePdf({
    invoiceNumber: ref,
    from: { name: identity?.tradingName ?? "", addressLines: identity?.addressLines ?? [] },
    partner: run.partnerName,
    payee: pr ? { name: pr.payee_name ?? null, email: pr.payee_email ?? null, method: pr.payment_method ? PARTNER_PAYMENT_METHOD_LABELS[pr.payment_method as PartnerPaymentMethod] ?? null : null } : null,
    periodStart: run.periodStart, periodEnd: run.periodEnd, status: run.status,
    publishedOn: run.publishedAt ? String(run.publishedAt).slice(0, 10) : null, paidOn: run.paidOn,
    expectedOn: run.status === "published" && run.netCents > 0 ? expectedPayOn(pr?.cadence ?? settings?.payoutCadence ?? "monthly", run.periodEnd, run.periodEnd, 0) : null,
    rejectedCount: run.items.filter((i) => i.itemType === "rejected").length,
    disputedCents: run.disputedCents,
    totals: { grossCents: run.grossCents, deductionsCents: run.deductionsCents, netCents: run.netCents },
    footer: run.footer,
  }, run.items.map((i) => ({ itemType: i.itemType, occurredOn: i.occurredOn, amountCents: i.amountCents, rateCents: i.rateAppliedCents, ratePctBp: i.ratePctBp, basisCents: i.basisCents ?? null, clientName: i.clientName ?? null, policyNumber: i.policyNumber ?? null, carrier: i.carrier ?? null, note: i.note })));
  return { bytes, filename: fileName(ref, run.partnerName) };
}

/** Draws the published invoice and stores it where the partner's Commissions section reads it. */
async function storeInvoicePdf(tenantId: string, runId: string) {
  if (!(await ledgerLive())) return;
  const { bytes } = await drawInvoicePdf(tenantId, runId);
  const path = pdfPath(tenantId, runId);
  const { error } = await db().storage.from(ACCOUNTING_BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(error.message);
  const { error: re } = await db().rpc("set_payout_invoice_pdf", { p_tenant_id: tenantId, p_run_id: runId, p_path: path });
  if (re) throw new Error(re.message);
}

async function storedOrDrawn(tenantId: string, runId: string, stored: { path: string | null; ref: string; partnerName: string } | null) {
  if (stored?.path && stored.path.startsWith(`${tenantId}/`)) {
    const { data } = await db().storage.from(ACCOUNTING_BUCKET).download(stored.path);
    if (data) return { bytes: new Uint8Array(await data.arrayBuffer()), filename: fileName(stored.ref, stored.partnerName) };
  }
  return drawInvoicePdf(tenantId, runId);
}

/** The agency's copy: the stored PDF once published, else drawn now (a draft's preview). */
export async function invoicePdf(tenantId: string, runId: string) {
  const live = await ledgerLive();
  const { data, error } = await db().from("payout_run").select(live ? "id, partner_id, invoice_number, invoice_pdf_path" : "id").eq("tenant_id", tenantId).eq("id", runId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new PayoutError("That invoice isn't in this agency.", 404);
  const r = data as Loose;
  if (!live || !r.invoice_pdf_path) return drawInvoicePdf(tenantId, runId);
  const { data: partner } = await db().from("partners").select("name").eq("id", r.partner_id).maybeSingle();
  return storedOrDrawn(tenantId, runId, { path: r.invoice_pdf_path, ref: invoiceRef({ id: r.id, invoiceNumber: r.invoice_number }), partnerName: partner?.name ?? "Partner" });
}

/** The partner's copy: its own published or paid invoice only. */
export async function partnerInvoicePdf(tenantId: string, partnerId: string, runId: string) {
  const r = (await partnerRun(tenantId, partnerId, runId)) as Loose;
  const { data: partner } = await db().from("partners").select("name").eq("id", partnerId).maybeSingle();
  return storedOrDrawn(tenantId, runId, { path: r.invoice_pdf_path ?? null, ref: invoiceRef({ id: r.id, invoiceNumber: r.invoice_number }), partnerName: partner?.name ?? "Partner" });
}

// ─── the partner's "Coming up" ────────────────────────────────────────────────────────────────

export type PartnerTrackerRow = Omit<TrackerRow, "partnerId" | "lastRunId" | "entries"> & { expectedOn: string | null };

const toTracker = (r: Loose): TrackerRow => ({
  dealId: r.deal_id, partnerId: r.partner_id, clientName: r.client_name, transferredOn: r.transferred_on, submittedOn: r.submitted_on, issuedOn: r.issued_on,
  policyNumber: r.policy_number, carrier: r.carrier, chargedBackOn: r.charged_back_on, payableCents: Number(r.payable_cents), unpaidCents: Number(r.unpaid_cents),
  invoicedCents: Number(r.invoiced_cents), paidCents: Number(r.paid_cents), entries: Number(r.entries), openFrom: r.open_from, lastRunId: r.last_run_id,
});

/** Every client the partner sent, where it stands and when payment can be expected. Its own rows only. */
export async function partnerTracker(tenantId: string, partnerId: string): Promise<PartnerTrackerRow[]> {
  if (!(await ledgerLive())) throw new PayoutError(LEDGER_PENDING_MESSAGE, 503);
  const { error: se } = await db().rpc("sync_partner_ledger", { p_tenant_id: tenantId, p_partner_id: partnerId });
  if (se) fail(se);
  const [{ data, error }, timers] = await Promise.all([
    db().from("partner_client_tracker").select("*").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("transferred_on", { ascending: false }).limit(1000),
    cadences(tenantId),
  ]);
  if (error) fail(error);
  const cadence = timers.byPartner.get(partnerId) ?? timers.agency;
  const now = today();
  return ((data ?? []) as Loose[]).map(toTracker).map((row) => ({
    dealId: row.dealId, clientName: row.clientName, transferredOn: row.transferredOn, submittedOn: row.submittedOn, issuedOn: row.issuedOn, policyNumber: row.policyNumber,
    carrier: row.carrier, chargedBackOn: row.chargedBackOn, payableCents: row.payableCents, unpaidCents: row.unpaidCents, invoicedCents: row.invoicedCents, paidCents: row.paidCents,
    openFrom: row.openFrom, expectedOn: row.openFrom ? expectedPayOn(cadence, row.openFrom, now, timers.draftDays) : null,
  }));
}

export type { ItemType };
