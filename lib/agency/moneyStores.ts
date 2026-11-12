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
    files.length ? db().from("file_registry").select("id, original_filename").in("id", files) : { data: [] },
  ]);
  const carrierName = new Map(((carrierRows.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const fileName = new Map(((fileRows.data ?? []) as Array<{ id: string; original_filename: string }>).map((f) => [f.id, f.original_filename]));
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

// ─── Commissions › Who gets the credit (round 7, mockups-r7/commissions.html 3·A) ───────────────────────────
/** Why a row waits: two producers named, an agent code nobody has, or no writing number at all. */
export type CreditWhy = "two" | "code" | "none";
export type CreditPerson = { userId: string; name: string; producerId: string | null };
export type CreditRow = {
  id: string;
  why: CreditWhy;
  carrierId: string | null;
  carrierName: string | null;
  policyNumber: string | null;
  clientName: string | null;
  agentIdentifier: string | null;
  amountCents: number;
  fileId: string | null;
  rowNumber: number | null;
  writingNumber: CreditPerson | null;
  application: CreditPerson | null;
  createdAt: string;
  resolvedAt: string | null;
  resolved: CreditPerson | null;
  reason: string | null;
};

const CREDIT_COLUMNS = "id, kind, status, writing_number_user_id, application_user_id, carrier_id, policy_number, agent_identifier, amount_cents, file_id, row_number, resolved_user_id, resolved_at, reason, created_at";

/**
 * The credit queue as Commissions › Who gets the credit lists it: every open row, oldest first, and the rows decided
 * in the last 30 days, newest first; each with its carrier, client and the producers it names. Reads only (the scan
 * that raises items runs with the ledger sync, not on opening a page).
 */
export async function readCreditQueue(tenantId: string): Promise<{ open: CreditRow[]; decided: CreditRow[] }> {
  const open: Array<Record<string, unknown>> = [];
  for (let at = 0; at < 20_000; at += 1000) {
    const { data, error } = await db().from("agency_attribution_item").select(CREDIT_COLUMNS).eq("tenant_id", tenantId).eq("status", "open")
      .order("created_at").order("id").range(at, at + 999);
    if (error) throw new Error(`readCreditQueue: ${error.message}`);
    open.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < 1000) break;
  }
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: done, error } = await db().from("agency_attribution_item").select(CREDIT_COLUMNS).eq("tenant_id", tenantId).eq("status", "resolved")
    .gte("resolved_at", since).order("resolved_at", { ascending: false }).limit(500);
  if (error) throw new Error(`readCreditQueue: ${error.message}`);
  const decided = (done ?? []) as Array<Record<string, unknown>>;
  const rows = [...open, ...decided];

  const carrierIds = [...new Set(rows.map((r) => r.carrier_id as string | null).filter(Boolean))] as string[];
  const policies = [...new Set(rows.map((r) => r.policy_number as string | null).filter(Boolean))] as string[];
  const policyParts: string[][] = [];
  for (let at = 0; at < policies.length; at += 200) policyParts.push(policies.slice(at, at + 200));
  const [carriers, producers, current] = await Promise.all([
    carrierIds.length ? db().from("carriers").select("id, name").in("id", carrierIds) : { data: [] },
    db().from("producer").select("id, user_id, display_name").eq("tenant_id", tenantId),
    Promise.all(policyParts.map(async (part) => ((await db().from("policy_current").select("carrier_id, policy_number, contact_id, extra").eq("tenant_id", tenantId).in("policy_number", part)).data ?? []) as Array<Record<string, unknown>>)),
  ]);
  const carrierName = new Map(((carriers.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const producerOf = new Map(((producers.data ?? []) as Array<{ id: string; user_id: string; display_name: string }>).map((p) => [p.user_id, { producerId: p.id, name: p.display_name }]));
  const clientOf = new Map<string, string>();
  const contactOf = new Map<string, string>();
  for (const pc of current.flat()) {
    const key = `${pc.carrier_id}:${pc.policy_number}`;
    const extra = (pc.extra ?? {}) as Record<string, unknown>;
    const name = [extra.insured_first_name ?? extra.first_name, extra.insured_last_name ?? extra.last_name].filter((v) => typeof v === "string" && v).join(" ");
    if (name) clientOf.set(key, name);
    else if (pc.contact_id) contactOf.set(key, pc.contact_id as string);
  }
  const contactIds = [...new Set(contactOf.values())];
  if (contactIds.length) {
    const named = new Map<string, string>();
    for (let at = 0; at < contactIds.length; at += 200) {
      const { data } = await db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", contactIds.slice(at, at + 200));
      for (const c of (data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
        if (name) named.set(c.id, name);
      }
    }
    for (const [key, id] of contactOf) if (named.has(id)) clientOf.set(key, named.get(id)!);
  }
  const person = (userId: unknown): CreditPerson | null => {
    if (!userId) return null;
    const p = producerOf.get(userId as string);
    return { userId: userId as string, name: p?.name ?? "A producer", producerId: p?.producerId ?? null };
  };
  const shape = (r: Record<string, unknown>): CreditRow => ({
    id: r.id as string,
    why: r.kind === "disagreement" ? "two" : r.agent_identifier ? "code" : "none",
    carrierId: (r.carrier_id as string | null) ?? null,
    carrierName: carrierName.get(r.carrier_id as string) ?? null,
    policyNumber: (r.policy_number as string | null) ?? null,
    clientName: clientOf.get(`${r.carrier_id}:${r.policy_number}`) ?? null,
    agentIdentifier: (r.agent_identifier as string | null) ?? null,
    amountCents: Number(r.amount_cents),
    fileId: (r.file_id as string | null) ?? null,
    rowNumber: r.row_number == null ? null : Number(r.row_number),
    writingNumber: person(r.writing_number_user_id),
    application: person(r.application_user_id),
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolved: person(r.resolved_user_id),
    reason: (r.reason as string | null) ?? null,
  });
  return { open: open.map(shape), decided: decided.map(shape) };
}

// ─── Commissions › Producer pay (round 7, 4·A / 4·1) ──────────────────────────────────────────────────────
/** What was paid out to each producer in a month (reported basis), as a positive figure. Reads only. */
export async function readMonthPayouts(tenantId: string, from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let at = 0; at < 50_000; at += 1000) {
    const { data, error } = await db().from("producer_ledger_entry").select("producer_user_id, amount_cents")
      .eq("tenant_id", tenantId).eq("basis", "reported").in("entry_type", ["payout", "split_paid"]).gte("occurred_on", from).lte("occurred_on", to)
      .order("id").range(at, at + 999);
    if (error) throw new Error(`readMonthPayouts: ${error.message}`);
    for (const r of (data ?? []) as Array<{ producer_user_id: string; amount_cents: number | string }>) out.set(r.producer_user_id, (out.get(r.producer_user_id) ?? 0) - Number(r.amount_cents));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** One producer's open review items, any month, newest first. Reads only (the reconciliation raises them). */
export async function readOpenReviews(tenantId: string, producerUserId: string): Promise<VarianceItem[]> {
  const { data, error } = await db().from("agency_variance_review").select("id, producer_user_id, kind, variance_cents, status, note, period_start, period_end")
    .eq("tenant_id", tenantId).eq("producer_user_id", producerUserId).eq("status", "open").order("period_end", { ascending: false });
  if (error) throw new Error(`readOpenReviews: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    producerUserId: r.producer_user_id as string,
    kind: r.kind as VarianceItem["kind"],
    varianceCents: Number(r.variance_cents),
    status: r.status as VarianceItem["status"],
    note: (r.note as string | null) ?? null,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
  }));
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
  // The truths read only the synced ledger, never the review rows agency_reconcile writes, so they are read beside
  // it; the reviews are read once it has written them.
  const [truths, { data }] = await Promise.all([
    agencyRpc<Array<Record<string, unknown>>>("agency_three_truths", { p_tenant_id: tenantId, p_from: from, p_to: to }),
    agencyRpc<number>("agency_reconcile", { p_tenant_id: tenantId, p_from: from, p_to: to, p_threshold_cents: thresholdCents }).then(() =>
      db()
        .from("agency_variance_review")
        .select("id, producer_user_id, kind, variance_cents, status, note, period_start, period_end")
        .eq("tenant_id", tenantId)
        .eq("period_start", from)
        .eq("period_end", to)),
  ]);
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
