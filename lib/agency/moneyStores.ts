import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agencyRpc } from "./rpc";

/**
 * AG-1.4 attribution queue · AG-1.6 policy splits · AG-1.12 reconciliation — the reads and the one writer each.
 * All money stays in integer cents; every figure returned names its basis where it has one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

// ─── AG-1.4 ──────────────────────────────────────────────────────────────────────────────────────
export type AttributionItem = {
  id: string;
  kind: "disagreement" | "unattributed";
  status: "open" | "resolved";
  writingNumberUserId: string | null;
  applicationUserId: string | null;
  carrierName: string | null;
  policyNumber: string | null;
  agentIdentifier: string | null;
  amountCents: number;
  fileName: string | null;
  rowNumber: number | null;
  resolvedUserId: string | null;
  resolvedAt: string | null;
  reason: string | null;
  createdAt: string;
};

export async function readAttribution(tenantId: string): Promise<AttributionItem[]> {
  await agencyRpc<number>("agency_attribution_scan", { p_tenant_id: tenantId });
  const { data, error } = await db()
    .from("agency_attribution_item")
    .select("id, kind, status, writing_number_user_id, application_user_id, policy_number, agent_identifier, amount_cents, file_id, row_number, resolved_user_id, resolved_at, reason, created_at, carrier_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`readAttribution: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const carriers = [...new Set(rows.map((r) => r.carrier_id as string | null).filter(Boolean))] as string[];
  const files = [...new Set(rows.map((r) => r.file_id as string | null).filter(Boolean))] as string[];
  const [carrierRows, fileRows] = await Promise.all([
    carriers.length ? db().from("carriers").select("id, name").in("id", carriers) : { data: [] },
    files.length ? db().from("file_registry").select("id, file_name").in("id", files) : { data: [] },
  ]);
  const carrierName = new Map(((carrierRows.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const fileName = new Map(((fileRows.data ?? []) as Array<{ id: string; file_name: string }>).map((f) => [f.id, f.file_name]));
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as AttributionItem["kind"],
    status: r.status as AttributionItem["status"],
    writingNumberUserId: (r.writing_number_user_id as string | null) ?? null,
    applicationUserId: (r.application_user_id as string | null) ?? null,
    carrierName: carrierName.get(r.carrier_id as string) ?? null,
    policyNumber: (r.policy_number as string | null) ?? null,
    agentIdentifier: (r.agent_identifier as string | null) ?? null,
    amountCents: Number(r.amount_cents),
    fileName: fileName.get(r.file_id as string) ?? null,
    rowNumber: (r.row_number as number | null) ?? null,
    resolvedUserId: (r.resolved_user_id as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

export async function resolveAttribution(tenantId: string, itemId: string, producerUserId: string, reason: string, actorId: string) {
  await agencyRpc("agency_attribution_resolve", { p_tenant_id: tenantId, p_item_id: itemId, p_user_id: producerUserId, p_reason: reason, p_actor: actorId });
  // the row can now be posted to the chosen producer's ledger
  await agencyRpc<number>("agency_ledger_sync", { p_tenant_id: tenantId });
}

// ─── AG-1.6 ──────────────────────────────────────────────────────────────────────────────────────
export type PolicySplit = {
  setId: string;
  carrierId: string;
  carrierName: string | null;
  policyNumber: string;
  writerUserId: string | null;
  shares: Array<{ producerUserId: string; shareBps: number; isWriter: boolean }>;
  createdAt: string;
};

export async function readSplits(tenantId: string): Promise<PolicySplit[]> {
  const { data, error } = await db()
    .from("policy_split")
    .select("set_id, carrier_id, policy_number, producer_user_id, share_bps, is_writer, created_at, carriers(name)")
    .eq("tenant_id", tenantId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`readSplits: ${error.message}`);
  const sets = new Map<string, PolicySplit>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const key = r.set_id as string;
    const set = sets.get(key) ?? { setId: key, carrierId: r.carrier_id as string, carrierName: ((r.carriers as { name?: string } | null)?.name) ?? null, policyNumber: r.policy_number as string, writerUserId: null, shares: [], createdAt: r.created_at as string };
    set.shares.push({ producerUserId: r.producer_user_id as string, shareBps: Number(r.share_bps), isWriter: Boolean(r.is_writer) });
    if (r.is_writer) set.writerUserId = r.producer_user_id as string;
    sets.set(key, set);
  }
  for (const set of sets.values()) set.shares.sort((a, b) => Number(b.isWriter) - Number(a.isWriter));
  return [...sets.values()];
}

export async function saveSplit(input: { tenantId: string; carrierId: string; policyNumber: string; writerUserId: string; shares: Array<{ producerUserId: string; shareBps: number }>; actorId: string }) {
  return agencyRpc<string>("set_policy_split", {
    p_tenant_id: input.tenantId,
    p_carrier_id: input.carrierId,
    p_policy_number: input.policyNumber,
    p_shares: input.shares.map((s) => ({ producer_user_id: s.producerUserId, share_bps: s.shareBps })),
    p_writer: input.writerUserId,
    p_actor: input.actorId,
  });
}

// ─── AG-1.12 ─────────────────────────────────────────────────────────────────────────────────────
export type TruthRow = { producerUserId: string; expectedCents: number | null; reportedCents: number; receivedCents: number; expectedMissingLevels: number };
export type VarianceItem = { id: string; producerUserId: string; kind: "expected_reported" | "reported_received"; varianceCents: number; status: "open" | "reviewed"; note: string | null; periodStart: string; periodEnd: string };

export async function readThreeTruths(tenantId: string, from: string, to: string, thresholdCents: number): Promise<{ rows: TruthRow[]; reviews: VarianceItem[] }> {
  await agencyRpc<number>("agency_ledger_sync", { p_tenant_id: tenantId });
  await agencyRpc<number>("agency_reconcile", { p_tenant_id: tenantId, p_from: from, p_to: to, p_threshold_cents: thresholdCents });
  const truths = await agencyRpc<Array<Record<string, unknown>>>("agency_three_truths", { p_tenant_id: tenantId, p_from: from, p_to: to });
  const { data } = await db()
    .from("agency_variance_review")
    .select("id, producer_user_id, kind, variance_cents, status, note, period_start, period_end")
    .eq("tenant_id", tenantId)
    .eq("period_start", from)
    .eq("period_end", to);
  return {
    rows: (truths ?? []).map((r) => ({
      producerUserId: r.producer_user_id as string,
      expectedCents: r.expected_cents == null ? null : Number(r.expected_cents),
      reportedCents: Number(r.reported_cents),
      receivedCents: Number(r.received_cents),
      expectedMissingLevels: Number(r.expected_missing_levels ?? 0),
    })),
    reviews: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      producerUserId: r.producer_user_id as string,
      kind: r.kind as VarianceItem["kind"],
      varianceCents: Number(r.variance_cents),
      status: r.status as VarianceItem["status"],
      note: (r.note as string | null) ?? null,
      periodStart: r.period_start as string,
      periodEnd: r.period_end as string,
    })),
  };
}

export async function markVariance(tenantId: string, itemId: string, note: string, actorId: string) {
  await agencyRpc("agency_variance_mark", { p_tenant_id: tenantId, p_item_id: itemId, p_note: note, p_actor: actorId });
}
