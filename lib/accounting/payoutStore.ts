import "server-only";

import { csvCell } from "@/lib/csv/cell";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { BusinessIdentityMissingError, loadBusinessIdentity, requireBusinessIdentity } from "@/lib/agencyProfile/identity";

import { ITEM_LABELS, partnerStatement, statementLines, type RunDispute, type RunHeader, type RunItem } from "./payoutsCore";
import type { PaidMethod } from "./invoicesCore";

/**
 * LA-7.4 (Notion sprint, Module 7 — Accounting) · partner payouts, server side. Every move is one
 * of the database's writers (20261015240000); this file only reads tables and calls them. No
 * outbound payment API is called anywhere: the agent pays as they pay today and records it here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const PAYOUTS_PENDING_MESSAGE = "Payout runs need a database update (20261015200000–20261015240000).";

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
});
const toItem = (i: Loose): RunItem => ({ id: i.id, itemType: i.item_type, sourceId: i.source_id, occurredOn: i.occurred_on, rateAppliedCents: i.rate_applied_cents == null ? null : Number(i.rate_applied_cents), ratePctBp: i.rate_pct_bp, amountCents: Number(i.amount_cents), note: i.note });
const toDispute = (d: Loose): RunDispute => ({ id: d.id, itemId: d.item_id, side: d.raised_by_side, reason: d.reason, claimCents: Number(d.claim_cents), status: d.status, resolutionNote: d.resolution_note, raisedAt: d.raised_at, resolvedAt: d.resolved_at, carriedToRunId: d.carried_to_run_id });

const RUN_COLUMNS = "id, partner_id, period_start, period_end, status, gross_cents, deductions_cents, disputed_cents, net_cents, paid_on, paid_method, payment_reference, published_at, statement_footer, void_reason, terms_snapshot_json, created_at";

async function partnerNames(tenantId: string) {
  const { data } = await db().from("partners").select("id, name, status").eq("tenant_id", tenantId).order("name");
  return ((data ?? []) as Loose[]).map((p) => ({ id: p.id as string, name: p.name as string, status: p.status as string }));
}

export async function listRuns(tenantId: string) {
  const [{ data, error }, partners] = await Promise.all([
    db().from("payout_run").select(RUN_COLUMNS).eq("tenant_id", tenantId).order("period_start", { ascending: false }).order("id").limit(500),
    partnerNames(tenantId),
  ]);
  if (error) fail(error);
  const name = new Map(partners.map((p) => [p.id, p.name]));
  return { runs: ((data ?? []) as Loose[]).map((r) => ({ ...toHeader(r), partnerName: name.get(r.partner_id) ?? "Partner" })), partners };
}

async function items(tenantId: string, runId: string): Promise<RunItem[]> {
  const out: Loose[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await db().from("payout_run_item").select("id, item_type, source_id, occurred_on, rate_applied_cents, rate_pct_bp, amount_cents, note").eq("tenant_id", tenantId).eq("run_id", runId).order("occurred_on").order("id").range(from, from + 999);
    if (error) fail(error);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out.map(toItem);
}

async function disputes(tenantId: string, runId: string): Promise<RunDispute[]> {
  const { data, error } = await db().from("payout_dispute").select("*").eq("tenant_id", tenantId).eq("run_id", runId).order("raised_at");
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map(toDispute);
}

export async function getRun(tenantId: string, id: string) {
  const { data: r, error } = await db().from("payout_run").select(RUN_COLUMNS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!r) throw new PayoutError("That run isn't in this agency.", 404);
  const [its, ds, partner] = await Promise.all([items(tenantId, id), disputes(tenantId, id), db().from("partners").select("name").eq("id", r.partner_id).maybeSingle()]);
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

export async function partnerRuns(tenantId: string, partnerId: string) {
  const { data, error } = await db().from("payout_run").select("id, period_start, period_end, status, net_cents, paid_on, published_at")
    .eq("tenant_id", tenantId).eq("partner_id", partnerId).in("status", ["published", "paid"]).order("period_start", { ascending: false }).limit(120);
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => ({ id: r.id as string, periodStart: r.period_start as string, periodEnd: r.period_end as string, status: r.status as "published" | "paid", netCents: Number(r.net_cents), paidOn: r.paid_on as string | null }));
}

async function partnerRun(tenantId: string, partnerId: string, id: string) {
  const { data: r, error } = await db().from("payout_run").select(RUN_COLUMNS).eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("id", id).in("status", ["published", "paid"]).maybeSingle();
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
    if (!data || !["transfer", "lead", "sale", "issued_policy", "adjustment"].includes(data.item_type)) throw new PayoutError("Not found", 404);
    ceiling = Math.max(Number(data.amount_cents), 0);
  }
  if (input.claimCents > ceiling) throw new PayoutError("The claim is more than what it disputes.");
  const { data, error } = await db().rpc("raise_payout_dispute", { p_tenant_id: tenantId, p_run_id: runId, p_item_id: input.itemId, p_side: "partner", p_by: userId, p_reason: input.reason, p_claim_cents: input.claimCents });
  if (error) fail(error);
  return data as string;
}
