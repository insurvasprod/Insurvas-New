import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap, type QueryError } from "@/lib/supabase/schemaGap";
import { getCommissionLedger } from "@/lib/ledger/service";
import type { ChargebackExposure } from "@/lib/ledger/compute";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";
import {
  exposureFor,
  isLapseSignalKind,
  monthlyPremiumCents,
  rankAtRisk,
  totalsAtRisk,
  type AtRiskPolicy,
  type AtRiskTotals,
  type LapseResolution,
  type LapseSignalKind,
  type OpenSignal,
} from "./model";

/**
 * Lapse risk for one tenant, as the viewer may see it.
 *
 * Scope is the commission rule, because every row carries a commission figure: roleCanViewCommission
 * is asked about each policy's producer (tenant_policies.created_by, the only attribution the book
 * carries), exactly as the ledger does. An owner sees and acts on every policy; a producer on the
 * policies they recorded. Recording and resolving use the same test, so nobody can put a policy on
 * a list they cannot read.
 */

export const LAPSE_SCHEMA_PENDING_MESSAGE = "Lapse signals need a database update that has not been applied yet.";

export type RecordablePolicy = { id: string; policyNumber: string; insuredName: string; status: "active" | "pending" };

export type LapseRiskView = {
  /** "pending" until the lapse-signal migration is applied; the list is then empty by necessity. */
  storage: "ready" | "pending";
  policies: AtRiskPolicy[];
  totals: AtRiskTotals;
  /** Active and pending policies the viewer may record a signal on. */
  recordable: RecordablePolicy[];
  chargebackExposure: { totalCents: number; policies: ChargebackExposure[] };
};

export class LapseRiskError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "LapseRiskError";
  }
}

type Result<T> = { data: T | null; error: QueryError };
type Query<T = unknown> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  is(column: string, value: null): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  insert(value: unknown): Query<T>;
  maybeSingle(): PromiseLike<Result<T>>;
  single(): PromiseLike<Result<T>>;
};
type LooseDb = {
  from<T = unknown>(table: string): Query<T>;
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Result<T>>;
};
const db = () => getSupabaseServiceClient() as unknown as LooseDb;

type PolicyRow = { id: string; policy_number: string; insured_name: string; carrier: string; product: string; annual_premium_cents: number; status: string; created_by: string | null };
type SignalRow = { id: string; policy_id: string; kind: string; occurred_on: string; note: string | null; source: string; recorded_at: string; recorded_by: string | null };

function isPending(error: QueryError): boolean {
  if (!error) return false;
  return isSchemaGap(error) || error.code === "42883" || error.code === "PGRST202" || /could not find the function/i.test(error.message);
}

function viewerCanSee(viewer: TenantContext) {
  return (producerUserId: string | null | undefined) => roleCanViewCommission(viewer.role, viewer.userId, producerUserId ?? undefined);
}

export async function getLapseRisk(viewer: TenantContext, today?: string): Promise<LapseRiskView> {
  const canView = viewerCanSee(viewer);
  const [ledger, policies, signals] = await Promise.all([
    getCommissionLedger({ tenantId: viewer.tenantId, canView, today }),
    db()
      .from<PolicyRow[]>("tenant_policies")
      .select("id, policy_number, insured_name, carrier, product, annual_premium_cents, status, created_by")
      .eq("tenant_id", viewer.tenantId)
      .in("status", ["active", "pending"])
      .order("policy_number", { ascending: true }),
    db()
      .from<SignalRow[]>("tenant_policy_lapse_signals")
      .select("id, policy_id, kind, occurred_on, note, source, recorded_at, recorded_by")
      .eq("tenant_id", viewer.tenantId)
      .is("resolved_at", null),
  ]);
  if (policies.error) throw new Error(`Could not load policies: ${policies.error.message}`);

  const pending = Boolean(signals.error) && isPending(signals.error);
  if (signals.error && !pending) throw new Error(`Could not load lapse signals: ${signals.error.message}`);

  const visible = (policies.data ?? []).filter((row) => canView(row.created_by));
  const byPolicy = new Map<string, SignalRow[]>();
  for (const signal of signals.data ?? []) {
    if (!isLapseSignalKind(signal.kind)) continue;
    byPolicy.set(signal.policy_id, [...(byPolicy.get(signal.policy_id) ?? []), signal]);
  }

  const recorderIds = [...new Set((signals.data ?? []).map((signal) => signal.recorded_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (recorderIds.length) {
    const users = await db().from<Array<{ id: string; name: string | null }>>("users").select("id, name").in("id", recorderIds);
    for (const user of users.data ?? []) if (user.name) names.set(user.id, user.name);
  }

  const atRisk: AtRiskPolicy[] = visible
    .filter((row) => byPolicy.has(row.id))
    .map((row) => ({
      policyId: row.id,
      policyNumber: row.policy_number,
      insuredName: row.insured_name,
      carrier: row.carrier,
      product: row.product,
      status: row.status as "active" | "pending",
      annualPremiumCents: row.annual_premium_cents,
      monthlyPremiumCents: monthlyPremiumCents(row.annual_premium_cents),
      exposure: exposureFor(row, ledger),
      signals: (byPolicy.get(row.id) ?? []).map(
        (signal): OpenSignal => ({
          id: signal.id,
          kind: signal.kind as LapseSignalKind,
          occurredOn: signal.occurred_on,
          note: signal.note,
          source: signal.source === "feed" ? "feed" : "manual",
          recordedAt: signal.recorded_at,
          recordedByName: signal.recorded_by ? (names.get(signal.recorded_by) ?? null) : null,
        }),
      ),
    }));

  const ranked = rankAtRisk(atRisk);
  return {
    storage: pending ? "pending" : "ready",
    policies: ranked,
    totals: totalsAtRisk(ranked),
    recordable: visible.map((row) => ({ id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, status: row.status as "active" | "pending" })),
    chargebackExposure: { totalCents: ledger.totals.exposureCents, policies: ledger.exposure },
  };
}

/** The one policy a write names, if it is this tenant's and the viewer's to act on. */
async function policyInScope(viewer: TenantContext, policyId: string) {
  const result = await db()
    .from<{ id: string; policy_number: string; status: string; created_by: string | null }>("tenant_policies")
    .select("id, policy_number, status, created_by")
    .eq("id", policyId)
    .eq("tenant_id", viewer.tenantId)
    .maybeSingle();
  if (result.error) throw new Error(`Could not load the policy: ${result.error.message}`);
  // Out of scope reads as missing: a producer learns nothing about a colleague's book from a 403.
  if (!result.data || !viewerCanSee(viewer)(result.data.created_by)) throw new LapseRiskError("Policy not found", 404, "policy_not_found");
  return result.data;
}

export async function recordLapseSignal(
  viewer: TenantContext,
  input: { policyId: string; kind: LapseSignalKind; occurredOn: string; note: string | null },
): Promise<{ signalId: string; policyNumber: string }> {
  const policy = await policyInScope(viewer, input.policyId);
  if (policy.status !== "active" && policy.status !== "pending") {
    throw new LapseRiskError(`This policy is already ${policy.status}; there is nothing left to put at risk.`, 409, "policy_ended");
  }
  const inserted = await db()
    .from<{ id: string }>("tenant_policy_lapse_signals")
    .insert({ tenant_id: viewer.tenantId, policy_id: policy.id, kind: input.kind, occurred_on: input.occurredOn, note: input.note, source: "manual", recorded_by: viewer.userId })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    if (isPending(inserted.error)) throw new LapseRiskError(LAPSE_SCHEMA_PENDING_MESSAGE, 503, "lapse_signals_unavailable");
    if (inserted.error?.code === "23514") throw new LapseRiskError("That signal could not be recorded: check the date and the note.", 400, "signal_invalid");
    throw new Error(`Could not record the lapse signal: ${inserted.error?.message ?? "no row returned"}`);
  }
  return { signalId: inserted.data.id, policyNumber: policy.policy_number };
}

export async function resolveLapseSignals(
  viewer: TenantContext,
  input: { policyId: string; resolution: LapseResolution; note: string | null },
): Promise<{ resolved: number; policyStatus: string; previousStatus: string; policyNumber: string }> {
  const policy = await policyInScope(viewer, input.policyId);
  const result = await db().rpc<Array<{ resolved_count: number; policy_status: string }>>("resolve_policy_lapse_signals", {
    p_tenant_id: viewer.tenantId,
    p_policy_id: policy.id,
    p_resolution: input.resolution,
    p_actor: viewer.userId,
    p_note: input.note,
  });
  if (result.error) {
    if (isPending(result.error)) throw new LapseRiskError(LAPSE_SCHEMA_PENDING_MESSAGE, 503, "lapse_signals_unavailable");
    if (result.error.code === "P0002") throw new LapseRiskError("Policy not found", 404, "policy_not_found");
    throw new Error(`Could not resolve the lapse signals: ${result.error.message}`);
  }
  const row = result.data?.[0];
  if (!row || row.resolved_count === 0) throw new LapseRiskError("This policy has no open lapse signals.", 409, "no_open_signals");
  return { resolved: row.resolved_count, policyStatus: row.policy_status, previousStatus: policy.status, policyNumber: policy.policy_number };
}
