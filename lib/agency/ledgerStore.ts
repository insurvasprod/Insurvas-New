import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agencyRpc } from "./rpc";
import { scopeFor, type ProducerScope } from "./visibility";
import type { Basis } from "./statementCore";

/**
 * AG-1.5 · reading the producer payable ledger. Writing happens only in the database (agency_ledger_sync posts
 * reported money from carrier statements; the payout run posts payouts); nothing here inserts a ledger row.
 * Every figure keeps its basis (AG-1.12): balances come back per basis and are never summed across them.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type BalanceRow = {
  producerUserId: string;
  basis: Basis;
  balanceCents: number;
  earnedCents: number;
  chargebackCents: number;
  paidCents: number;
  adjustedCents: number;
  entries: number;
};

/** Post every statement row that is ready (idempotent). */
export async function syncLedger(tenantId: string): Promise<number> {
  return agencyRpc<number>("agency_ledger_sync", { p_tenant_id: tenantId });
}

export async function readBalances(context: { tenantId: string; userId: string }, asOf?: string): Promise<{ rows: BalanceRow[]; scope: ProducerScope }> {
  const scope = await scopeFor(context);
  const raw = await agencyRpc<Array<Record<string, unknown>>>("agency_producer_balances", { p_tenant_id: context.tenantId, p_as_of: asOf ?? new Date().toISOString().slice(0, 10) });
  const rows = (raw ?? [])
    .map((r) => ({
      producerUserId: r.producer_user_id as string,
      basis: r.basis as Basis,
      balanceCents: Number(r.balance_cents),
      earnedCents: Number(r.earned_cents),
      chargebackCents: Number(r.chargeback_cents),
      paidCents: Number(r.paid_cents),
      adjustedCents: Number(r.adjusted_cents),
      entries: Number(r.entries),
    }))
    .filter((r) => scope === null || scope.includes(r.producerUserId));
  return { rows, scope };
}

/**
 * AG-1.8 · one statement: the run's header and the lines, built from the ledger NOW (only the run id and period are
 * stored). Reported basis — the basis payouts are made on.
 */
export async function readStatement(tenantId: string, runId: string) {
  const { data: run, error } = await db()
    .from("producer_payout_run")
    .select("id, producer_user_id, period_start, period_end, status, paid_on, paid_method, payment_reference, withheld_cents, decision_mode, decision_reason")
    .eq("tenant_id", tenantId)
    .eq("id", runId)
    .maybeSingle();
  if (error || !run) return null;
  const [entries, producer, agency] = await Promise.all([
    readProducerEntries(tenantId, run.producer_user_id, { to: run.period_end }),
    db().from("producer").select("display_name").eq("tenant_id", tenantId).eq("user_id", run.producer_user_id).maybeSingle(),
    db().from("agency").select("legal_name, dba_name").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const before = entries.filter((e) => e.occurredOn < run.period_start);
  const during = entries.filter((e) => e.occurredOn >= run.period_start && e.occurredOn <= run.period_end && (e.payoutRunId === null || e.payoutRunId === run.id));
  return {
    run: {
      id: run.id as string,
      producerUserId: run.producer_user_id as string,
      periodStart: run.period_start as string,
      periodEnd: run.period_end as string,
      status: run.status as string,
      paidOn: (run.paid_on as string | null) ?? null,
      method: (run.paid_method as string | null) ?? null,
      reference: (run.payment_reference as string | null) ?? null,
      withheldCents: Number(run.withheld_cents ?? 0),
      decision: (run.decision_mode as string | null) ?? null,
      decisionReason: (run.decision_reason as string | null) ?? null,
    },
    producer: (producer.data?.display_name as string | null) ?? "Producer",
    agency: (agency.data?.dba_name as string | null) ?? (agency.data?.legal_name as string | null) ?? "Agency",
    before,
    during,
  };
}

export type LedgerEntry = {
  id: string;
  entryType: string;
  basis: Basis;
  policyNumber: string | null;
  carrierId: string | null;
  carrierName: string | null;
  clientName: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  levelBps: number | null;
  shareBps: number | null;
  amountCents: number;
  occurredOn: string;
  payoutRunId: string | null;
  reason: string | null;
};

/** One producer's entries, oldest first. Client name and policy number only — no SSN, bank, routing or card. */
export async function readProducerEntries(tenantId: string, producerUserId: string, range?: { from?: string; to?: string; runId?: string }): Promise<LedgerEntry[]> {
  let query = db()
    .from("producer_ledger_entry")
    .select("id, entry_type, basis, policy_number, carrier_id, split_pct_bp_applied, amount_cents, occurred_on, payout_run_id, reason")
    .eq("tenant_id", tenantId)
    .eq("producer_user_id", producerUserId)
    .order("occurred_on", { ascending: true })
    .order("id", { ascending: true });
  if (range?.from) query = query.gte("occurred_on", range.from);
  if (range?.to) query = query.lte("occurred_on", range.to);
  const { data, error } = await query;
  if (error) throw new Error(`readProducerEntries: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // producer_ledger_entry has no foreign key to carriers (LA-7.5), so PostgREST cannot embed the name: read it apart.
  const carrierIds = [...new Set(rows.map((r) => r.carrier_id as string | null).filter(Boolean))] as string[];
  const carrierName = new Map<string, string>();
  if (carrierIds.length) {
    const { data: carriers } = await db().from("carriers").select("id, name").in("id", carrierIds);
    for (const c of (carriers ?? []) as Array<{ id: string; name: string }>) carrierName.set(c.id, c.name);
  }
  const policies = [...new Set(rows.map((r) => r.policy_number as string | null).filter(Boolean))] as string[];
  const policyInfo = new Map<string, { client: string | null; premium: number | null; mode: string | null; effective: string | null; carrier: string }>();
  if (policies.length) {
    const { data: pcs } = await db()
      .from("policy_current")
      .select("carrier_id, policy_number, premium_cents, premium_mode, effective_date, extra")
      .eq("tenant_id", tenantId)
      .in("policy_number", policies);
    for (const pc of (pcs ?? []) as Array<Record<string, unknown>>) {
      const extra = (pc.extra ?? {}) as Record<string, unknown>;
      const client = [extra.insured_first_name ?? extra.first_name, extra.insured_last_name ?? extra.last_name].filter((v) => typeof v === "string" && v).join(" ") || null;
      policyInfo.set(`${pc.carrier_id}:${pc.policy_number}`, { client, premium: pc.premium_cents == null ? null : Number(pc.premium_cents), mode: (pc.premium_mode as string | null) ?? null, effective: (pc.effective_date as string | null) ?? null, carrier: pc.carrier_id as string });
    }
  }
  const levels = new Map<string, number | null>();
  for (const r of rows) {
    const key = `${r.carrier_id}:${r.policy_number}`;
    if (!r.carrier_id || levels.has(key)) continue;
    const effective = policyInfo.get(key)?.effective ?? (r.occurred_on as string);
    const { data: level } = await (getSupabaseServiceClient() as unknown as { rpc(n: string, a: Record<string, unknown>): PromiseLike<{ data: number | null }> })
      .rpc("producer_level_bps_as_of", { p_tenant_id: tenantId, p_producer_user_id: producerUserId, p_carrier_id: r.carrier_id, p_as_of: effective });
    levels.set(key, level ?? null);
  }
  return rows
    .filter((r) => !range?.runId || r.payout_run_id === range.runId || r.payout_run_id === null)
    .map((r) => {
      const key = `${r.carrier_id}:${r.policy_number}`;
      const info = policyInfo.get(key);
      return {
        id: r.id as string,
        entryType: r.entry_type as string,
        basis: r.basis as Basis,
        policyNumber: (r.policy_number as string | null) ?? null,
        carrierId: (r.carrier_id as string | null) ?? null,
        carrierName: carrierName.get(r.carrier_id as string) ?? null,
        clientName: info?.client ?? null,
        premiumCents: info?.premium ?? null,
        premiumMode: info?.mode ?? null,
        levelBps: levels.get(key) ?? null,
        shareBps: (r.split_pct_bp_applied as number | null) ?? null,
        amountCents: Number(r.amount_cents),
        occurredOn: r.occurred_on as string,
        payoutRunId: (r.payout_run_id as string | null) ?? null,
        reason: (r.reason as string | null) ?? null,
      };
    });
}
