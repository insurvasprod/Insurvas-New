import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import type { PaidMethod } from "./invoicesCore";
import { fromRow } from "./settingsCore";
import { producerView, type Basis, type PaysOn, type ProducerEntry, type ProducerRun } from "./producersCore";

/**
 * LA-7.5 (Notion sprint, Module 7 — Accounting) · producer splits, server side. The producer
 * ledger is filled from LA-4.12's commission entries by producer_ledger_sync (20261015250000);
 * this file reads, records splits (a new row is the only change a split has) and calls the run
 * writers. No money is moved.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const PRODUCERS_PENDING_MESSAGE = "Producer splits need a database update (20261015200000–20261015250000).";

export class ProducerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new ProducerError(PRODUCERS_PENDING_MESSAGE, 503);
  if (error.code === "P0002") throw new ProducerError(error.message.replace(/^\w+: /, ""), 404);
  if (error.code === "23505") throw new ProducerError(error.message.includes("covers") ? error.message.replace(/^\w+: /, "") : "A split already starts on that date for this producer, carrier and product.", 409);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new ProducerError(error.message.replace(/^\w+: /, ""), 400);
  throw new Error(error.message);
}

const toEntry = (e: Loose): ProducerEntry => ({ id: e.id, entryType: e.entry_type, policyNumber: e.policy_number, carrierId: e.carrier_id, commissionEntryId: e.commission_entry_id, splitPctBpApplied: e.split_pct_bp_applied, amountCents: Number(e.amount_cents), occurredOn: e.occurred_on, payoutRunId: e.payout_run_id, reason: e.reason });
const toRun = (r: Loose): ProducerRun => ({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, status: r.status, negativePolicy: r.negative_policy, balanceBeforeCents: Number(r.balance_before_cents), earnedCents: Number(r.earned_cents), clawedBackCents: Number(r.clawed_back_cents), withheldCents: Number(r.withheld_cents), netCents: Number(r.net_cents), balanceAfterCents: Number(r.balance_after_cents), paidOn: r.paid_on });

export async function syncProducerLedger(tenantId: string): Promise<number> {
  const { data, error } = await db().rpc("producer_ledger_sync", { p_tenant_id: tenantId });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** The agency's view: every member who could be paid a split, their balance, their splits, their runs. */
export async function producersOverview(tenantId: string) {
  const [members, balances, splits, runs, carriers, settings] = await Promise.all([
    db().from("tenant_users").select("user_id, role, users!inner(name, email)").eq("tenant_id", tenantId).not("accepted_at", "is", null),
    db().rpc("producer_balances", { p_tenant_id: tenantId, p_producer: null }),
    db().from("producer_split").select("*").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    db().from("producer_payout_run").select("*").eq("tenant_id", tenantId).order("period_start", { ascending: false }).limit(500),
    db().from("carriers").select("id, name").order("name"),
    db().from("accounting_settings").select("producer_negative_policy, producer_recovery_cap_bp, producer_default_split_bp, producer_default_basis").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  for (const r of [balances, splits, runs]) if (r.error) fail(r.error);
  const bal = new Map<string, Loose>(((balances.data ?? []) as Loose[]).map((b) => [b.producer_user_id, b]));
  const people = ((members.data ?? []) as Loose[]).filter((m) => m.role === "producer" || m.role === "owner" || bal.has(m.user_id)).map((m) => {
    const b = bal.get(m.user_id);
    return {
      userId: m.user_id as string, name: (m.users?.name as string | null) ?? (m.users?.email as string) ?? "Unnamed", role: m.role as string,
      balanceCents: b ? Number(b.balance_cents) : 0, owedCents: b ? Number(b.owed_cents) : 0, clawedBackCents: b ? Number(b.clawed_back_cents) : 0, paidCents: b ? Number(b.paid_cents) : 0,
    };
  });
  return {
    people,
    splits: ((splits.data ?? []) as Loose[]).map((s) => ({ id: s.id as string, producerUserId: s.producer_user_id as string, carrierId: s.carrier_id as string | null, productCode: s.product_code as string | null, splitPctBp: Number(s.split_pct_bp), basis: s.basis as Basis, paysOn: s.pays_on as PaysOn, effectiveFrom: s.effective_from as string })),
    runs: ((runs.data ?? []) as Loose[]).map((r) => ({ ...toRun(r), producerUserId: r.producer_user_id as string })),
    carriers: ((carriers.data ?? []) as Loose[]).map((c) => ({ id: c.id as string, name: c.name as string })),
    settings: (() => { const s = fromRow(settings.data); return { negativePolicy: s.producerNegativePolicy as string, recoveryCapBp: s.producerRecoveryCapBp, defaultSplitBp: s.producerDefaultSplitBp, defaultBasis: s.producerDefaultBasis as Basis }; })(),
  };
}

export async function producerEntries(tenantId: string, producerUserId: string, limit = 500): Promise<ProducerEntry[]> {
  const { data, error } = await db().from("producer_ledger_entry").select("id, entry_type, policy_number, carrier_id, commission_entry_id, split_pct_bp_applied, amount_cents, occurred_on, payout_run_id, reason")
    .eq("tenant_id", tenantId).eq("producer_user_id", producerUserId).order("occurred_on", { ascending: false }).order("id").limit(limit);
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map(toEntry);
}

export async function addSplit(tenantId: string, by: string, input: { producerUserId: string; carrierId: string | null; productCode: string | null; splitPctBp: number; basis: Basis; paysOn: PaysOn; effectiveFrom: string }) {
  const { data: member } = await db().from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", input.producerUserId).maybeSingle();
  if (!member) throw new ProducerError("That person isn't in this agency.", 404);
  const { data, error } = await db().from("producer_split").insert({
    tenant_id: tenantId, producer_user_id: input.producerUserId, carrier_id: input.carrierId, product_code: input.productCode?.trim() || null,
    split_pct_bp: input.splitPctBp, basis: input.basis, pays_on: input.paysOn, effective_from: input.effectiveFrom, created_by: by,
  }).select("id").single();
  if (error) fail(error);
  await syncProducerLedger(tenantId);
  return data.id as string;
}

export async function buildProducerRun(tenantId: string, by: string, producerUserId: string, from: string, to: string) {
  const { data, error } = await db().rpc("build_producer_run", { p_tenant_id: tenantId, p_producer: producerUserId, p_from: from, p_to: to, p_by: by });
  if (error) fail(error);
  return data as string;
}

export async function producerRunAction(tenantId: string, by: string, runId: string, action: { kind: "publish" } | { kind: "paid"; paidOn: string; method: PaidMethod | null; reference: string | null } | { kind: "void"; reason: string }) {
  const call = action.kind === "publish" ? db().rpc("publish_producer_run", { p_tenant_id: tenantId, p_run_id: runId, p_by: by })
    : action.kind === "paid" ? db().rpc("mark_producer_run_paid", { p_tenant_id: tenantId, p_run_id: runId, p_paid_on: action.paidOn, p_method: action.method, p_reference: action.reference })
    : db().rpc("void_producer_run", { p_tenant_id: tenantId, p_run_id: runId, p_reason: action.reason, p_by: by });
  const { error } = await call;
  if (error) fail(error);
}

export async function writeOff(tenantId: string, by: string, producerUserId: string, reason: string): Promise<number> {
  const { data, error } = await db().rpc("write_off_producer_balance", { p_tenant_id: tenantId, p_producer: producerUserId, p_reason: reason, p_by: by });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** A producer's own view — only their rows, only if the agency lets producers see their balance (LA-7.9). */
export async function myBalance(tenantId: string, userId: string) {
  const { data: settings } = await db().from("accounting_settings").select("producers_see_balance").eq("tenant_id", tenantId).maybeSingle();
  if (settings && settings.producers_see_balance === false) return { visible: false as const };
  await syncProducerLedger(tenantId);
  const [bal, entries, runs] = await Promise.all([
    db().rpc("producer_balances", { p_tenant_id: tenantId, p_producer: userId }),
    producerEntries(tenantId, userId, 300),
    db().from("producer_payout_run").select("*").eq("tenant_id", tenantId).eq("producer_user_id", userId).in("status", ["published", "paid"]).order("period_start", { ascending: false }).limit(60),
  ]);
  if (bal.error) fail(bal.error);
  if (runs.error) fail(runs.error);
  const b = ((bal.data ?? []) as Loose[])[0];
  return { visible: true as const, ...producerView({ balanceCents: b ? Number(b.balance_cents) : 0, entries, runs: ((runs.data ?? []) as Loose[]).map(toRun) }) };
}
