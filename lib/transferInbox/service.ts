import "server-only";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { postPartnerSystemCard } from "@/lib/partnerChat/service";
import type { PreflightResult } from "@/lib/existingCustomerPreflight/types";
import { isWithAgent, screeningSignal, transferPhase, TRANSFER_PHASE_LABEL, type InboxSummary } from "./constants";

export type InboxFilters = {
  /** `open` is unclaimed plus in progress (20260924170000): what Agent Floor shows, without history. */
  status: "unclaimed" | "claimed" | "open" | "all";
  partnerId?: string;
  productLine?: string;
  state?: string;
  screeningOutcome?: string;
  claimedBy?: string;
};

export type PendingHandoff = {
  id: string;
  workItemId: string;
  bufferUserId: string;
  bufferName: string;
  productLine: string;
  customer: string;
  progressPercentage: number;
  verificationSessionId: string;
  offeredAt: string;
  expiresAt: string;
};

type TransferInboxRow = {
  id: string;
  lead_id: string;
  partner_id: string | null;
  partner_name: string | null;
  product_line: string;
  status: string;
  owner_user_id: string | null;
  owner_name: string | null;
  claimed_at: string | null;
  queued_at: string;
  wait_seconds: number;
  customer: string;
  age: string;
  state: string;
  screening_outcome: string;
  screening_warning: string | null;
  duplicate_warning: boolean;
  preflight_status: string;
  preflight_result: unknown;
};

type BufferHandoffRow = {
  id: string;
  work_item_id: string;
  buffer_user_id: string;
  buffer_name: string;
  product_line: string;
  customer: string;
  progress_percentage: number;
  verification_session_id: string;
  offered_at: string;
  expires_at: string;
};

type SummaryRow = { waiting?: number; longest_wait_seconds?: number; average_wait_seconds?: number; claimed?: number; claimed_without_call?: number; needs_review?: number };
type TransferInboxBundle = { items?: TransferInboxRow[]; handoffs?: BufferHandoffRow[]; truncated?: boolean; summary?: SummaryRow | null };

function summaryFrom(row: SummaryRow | null | undefined): InboxSummary | null {
  if (!row || typeof row !== "object") return null;
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return { waiting: n(row.waiting), longestWaitSeconds: n(row.longest_wait_seconds), averageWaitSeconds: n(row.average_wait_seconds), claimed: n(row.claimed), claimedWithoutCall: n(row.claimed_without_call), needsReview: n(row.needs_review) };
}

export async function getTransferInbox(tenantId: string, filters: InboxFilters, currentUserId: string, role?: string) {
  const supabase = getSupabaseServiceClient();
  // Keep the inbox and handoff reads in one service-only RPC. This removes a second PostgREST
  // round trip from the 500-row hot path and gives callers one response boundary.
  const { data: bundle, error } = await supabase.rpc("list_transfer_inbox_bundle", {
    p_tenant_id: tenantId,
    p_status: filters.status,
    p_partner_id: filters.partnerId ?? null,
    p_product_line: filters.productLine ?? null,
    p_state: filters.state ?? null,
    p_screening_outcome: filters.screeningOutcome ?? null,
    p_claimed_by: filters.claimedBy === "me" ? currentUserId : filters.claimedBy ?? null,
    p_licensed_agent_id: role === "owner" || role === "producer" ? currentUserId : null,
  });
  if (error) throw new Error(`Could not load transfer inbox: ${error.message}`);
  const payload = (bundle ?? {}) as unknown as TransferInboxBundle;
  const rows = payload.items ?? [];
  const items = (rows ?? []).map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    partnerId: row.partner_id,
    partnerName: row.partner_name ?? "Unassigned partner",
    productLine: row.product_line,
    status: row.status,
    // LA-1.14-6: the spec's five states, whichever of the two licensed-agent words is stored.
    phase: transferPhase(row.status),
    phaseLabel: TRANSFER_PHASE_LABEL[transferPhase(row.status)],
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    claimedAt: row.claimed_at,
    queuedAt: row.queued_at,
    waitSeconds: row.wait_seconds,
    customer: row.customer,
    age: row.age,
    state: row.state,
    screeningOutcome: row.screening_outcome,
    screeningWarning: row.screening_warning,
    duplicateWarning: row.duplicate_warning,
    preflightStatus: row.preflight_status,
    preflight: row.preflight_result as unknown as PreflightResult,
    // The inbox's one screening label (constants.ts). Additive: Agent Floor keeps reading the raw
    // screeningOutcome / duplicateWarning / preflightStatus it already used.
    screening: screeningSignal({ screeningOutcome: row.screening_outcome, preflightStatus: row.preflight_status, duplicateWarning: row.duplicate_warning }),
  }));
  const partners = [...new Map(items.filter((item) => item.partnerId).map((item) => [item.partnerId!, item.partnerName])).entries()].map(([id, name]) => ({ id, name }));

  return {
    items,
    // The RPC keeps the newest 500 matching rows; true when it reached that cap, so older ones may be missing.
    truncated: payload.truncated === true,
    // The KPI tiles over the whole open set (20260924335200). Null until that migration is applied;
    // the inbox route then computes it with getInboxSummaryFallback.
    summary: summaryFrom(payload.summary) ?? null,
    partners,
    products: [...new Set(items.map((row) => row.productLine))].sort(),
    states: [...new Set(items.map((item) => item.state).filter((state) => state !== "—"))].sort(),
    claimedUsers: [...new Map(items.filter((item) => item.ownerUserId).map((item) => [item.ownerUserId!, item.ownerName ?? "Another agent"]))].map(([id, name]) => ({ id, name })),
    handoffs: (payload.handoffs ?? []).map((handoff) => ({ id: handoff.id, workItemId: handoff.work_item_id, bufferUserId: handoff.buffer_user_id, bufferName: handoff.buffer_name, productLine: handoff.product_line, customer: handoff.customer, progressPercentage: handoff.progress_percentage, verificationSessionId: handoff.verification_session_id, offeredAt: handoff.offered_at, expiresAt: handoff.expires_at })) as PendingHandoff[],
  };
}

/** Customer display name, mirroring the `customer` column of public.list_transfer_inbox. */
export function transferCustomerName(values: unknown): string {
  const v = (values && typeof values === "object" && !Array.isArray(values) ? values : {}) as Record<string, unknown>;
  const pick = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");
  const composed = [v.first_name, v.last_name].filter((part) => part != null).map((part) => String(part)).join(" ").trim();
  return pick(v.full_name) || pick(v.name) || composed || "Unnamed customer";
}

/**
 * The partner's "Connected" card, once per claim (LA-1.14-7). A buffer claim is a connection too: the
 * customer is now on the line with the agency. "Transferred" is the licensed agent accepting the
 * buffer's handoff (lib/bufferHandoff). The event key keeps each card to exactly one post.
 */
export async function postPartnerClaimMessage(tenantId: string, workItemId: string, userId: string, customer: string, options: { eventKey?: string; message?: string; partnerId?: string | null } = {}) {
  // Callers that already read the tenant-scoped queue row pass partnerId, saving a round trip.
  let partnerId = options.partnerId;
  if (partnerId === undefined) {
    const { data: queue, error: queueError } = await getSupabaseServiceClient().from("lead_queue").select("partner_id").eq("id", workItemId).eq("tenant_id", tenantId).single();
    if (queueError) throw new Error("Partner channel is not available for this transfer");
    partnerId = queue?.partner_id ?? null;
  }
  if (!partnerId) throw new Error("Partner channel is not available for this transfer");
  return postPartnerSystemCard({ tenantId, partnerId, workItemId, userId, eventKey: options.eventKey ?? `claim:${workItemId}`, cardType: "connected", message: options.message ?? `${customer} is connected to the agent` });
}

/**
 * The KPI tiles before 20260924335200 is applied: the same numbers the bundle's `summary` returns,
 * read the slower way. The open set comes from list_transfer_inbox('open') with no filters (so it
 * is capped at the newest 500, which only matters to a queue that deep), and "no open call record"
 * from the tenant's open active_calls rows.
 */
export async function getInboxSummaryFallback(tenantId: string): Promise<InboxSummary> {
  const supabase = getSupabaseServiceClient();
  const [open, calls] = await Promise.all([
    supabase.rpc("list_transfer_inbox", { p_tenant_id: tenantId, p_status: "open" }),
    supabase.from("active_calls").select("work_item_id").eq("tenant_id", tenantId).is("ended_at", null),
  ]);
  if (open.error) throw new Error(`Could not load the inbox summary: ${open.error.message}`);
  const rows = (open.data ?? []) as unknown as TransferInboxRow[];
  const onCall = new Set(((calls.data ?? []) as Array<{ work_item_id: string }>).map((row) => row.work_item_id));
  const waiting = rows.filter((row) => row.status === "unclaimed");
  const withAgent = rows.filter((row) => isWithAgent(row.status));
  return {
    waiting: waiting.length,
    longestWaitSeconds: waiting.reduce((longest, row) => Math.max(longest, row.wait_seconds), 0),
    averageWaitSeconds: waiting.length ? Math.round(waiting.reduce((sum, row) => sum + row.wait_seconds, 0) / waiting.length) : 0,
    claimed: withAgent.length,
    // Unknown when the call records could not be read: report none rather than guess.
    claimedWithoutCall: calls.error ? 0 : withAgent.filter((row) => !onCall.has(row.id)).length,
    needsReview: rows.filter((row) => row.screening_outcome === "dnc").length,
  };
}

export class ClaimNextError extends Error {
  constructor(public code: "no_transfer_waiting" | "role_not_allowed" | "language_not_spoken" | "schema_pending" | "claim_failed", message: string) { super(message); }
}

/**
 * Claim the oldest waiting inbound transfer that matches the inbox filters (claim_next_transfer,
 * 20260924335100). Race-safe in the database: concurrent callers skip each other's locked rows.
 */
export async function claimNextTransfer(params: { tenantId: string; userId: string; role: string; partnerId?: string | null; productLine?: string | null; state?: string | null; screeningOutcome?: string | null }) {
  // claim_next_transfer is newer than database.types.ts; typed locally.
  const supabase = getSupabaseServiceClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string; details?: string | null } | null }> };
  const { data, error } = await supabase.rpc("claim_next_transfer", {
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_owner_role: params.role,
    p_partner_id: params.partnerId ?? null,
    p_product_line: params.productLine ?? null,
    p_state: params.state ?? null,
    p_screening_outcome: params.screeningOutcome ?? null,
  });
  if (error) {
    if (error.message === "NO_TRANSFER_WAITING") throw new ClaimNextError("no_transfer_waiting", "No transfer is waiting that matches these filters.");
    if (error.message === "LANGUAGE_NOT_SPOKEN") throw new ClaimNextError("language_not_spoken", "The next caller asked for a language you do not list.");
    if (error.message === "ROLE_NOT_ALLOWED") throw new ClaimNextError("role_not_allowed", "Your role cannot claim transfers.");
    if (error.code === "42883" || error.code === "PGRST202") throw new ClaimNextError("schema_pending", "This setting needs a database update that has not been applied yet.");
    console.error("[claim-next] claim_next_transfer failed", error.code, error.message, error.details);
    throw new ClaimNextError("claim_failed", "Could not claim the next transfer.");
  }
  return data as { work_item_id: string; lead_id: string; active_call_id?: string | null; verification_session_id?: string | null; status: string; claimed_at: string };
}

/**
 * After a claim commits: tell the partner (a system card in their chat) and write the audit row.
 * Shared by Claim transfer and Claim next so the two cannot drift. A chat failure never undoes the
 * claim — it is audited on its own and reported back as `chatPosted: false`.
 */
export async function announceTransferClaim(params: { tenantId: string; userId: string; role: string; workItemId: string; claim: unknown; request: Request; via?: "claim" | "claim_next" }) {
  const supabase = getSupabaseServiceClient();
  // One tenant-scoped row (plus its lead) instead of the 500-row inbox bundle: it yields the same
  // customer name and the partner id the chat card needs.
  const claimed = await supabase
    .from("lead_queue")
    .select("partner_id, agent_leads!lead_queue_lead_id_fkey(values)")
    .eq("id", params.workItemId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();
  const claimedLead = claimed.data?.agent_leads as unknown as { values: unknown } | { values: unknown }[] | null | undefined;
  const leadValues = Array.isArray(claimedLead) ? claimedLead[0]?.values : claimedLead?.values;
  const customer = claimed.data && leadValues !== undefined ? transferCustomerName(leadValues) : "Customer";
  let chatPosted = true;
  try {
    const isBuffer = params.role === "assistant";
    const partnerId = claimed.error || !claimed.data ? undefined : claimed.data.partner_id;
    await postPartnerClaimMessage(params.tenantId, params.workItemId, params.userId, customer, isBuffer
      ? { eventKey: `buffer-claim:${params.workItemId}`, message: `${customer} is connected to the buffer agent`, partnerId }
      : { partnerId });
  } catch (chatError) {
    chatPosted = false;
    console.error("Partner claim message failed after claim", chatError);
    await audit({ actorType: "tenant", actorId: params.userId, action: "tenant.transfer_claim_chat_failed", targetType: "lead_queue", targetId: params.workItemId, reason: chatError instanceof Error ? chatError.message : "Unknown chat error", request: params.request }).catch(() => undefined);
  }
  const claim = (params.claim ?? {}) as { active_call_id?: string; verification_session_id?: string };
  await audit({ actorType: "tenant", actorId: params.userId, action: "tenant.transfer_claimed", targetType: "lead_queue", targetId: params.workItemId, metadata: { activeCallId: claim.active_call_id ?? null, verificationSessionId: claim.verification_session_id ?? null, chatPosted, ...(params.via === "claim_next" ? { via: "claim_next" } : {}) }, request: params.request });
  return { chatPosted };
}
