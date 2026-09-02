import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type InboxFilters = {
  status: "unclaimed" | "claimed" | "all";
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

export async function getTransferInbox(tenantId: string, filters: InboxFilters, currentUserId: string, role?: string) {
  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase.rpc("list_transfer_inbox", {
    p_tenant_id: tenantId,
    p_status: filters.status,
    p_partner_id: filters.partnerId ?? null,
    p_product_line: filters.productLine ?? null,
    p_state: filters.state ?? null,
    p_screening_outcome: filters.screeningOutcome ?? null,
    p_claimed_by: filters.claimedBy === "me" ? currentUserId : filters.claimedBy ?? null,
  });
  if (error) throw new Error(`Could not load transfer inbox: ${error.message}`);
  const items = (rows ?? []).map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    partnerId: row.partner_id,
    partnerName: row.partner_name ?? "Unassigned partner",
    productLine: row.product_line,
    status: row.status,
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
  }));
  const partners = [...new Map(items.filter((item) => item.partnerId).map((item) => [item.partnerId!, item.partnerName])).entries()].map(([id, name]) => ({ id, name }));
  const pending = role === "owner" || role === "producer"
    ? await supabase.rpc("list_buffer_handoffs", { p_tenant_id: tenantId, p_licensed_agent_id: currentUserId })
    : { data: [], error: null };
  if (pending.error) throw new Error(`Could not load handoff offers: ${pending.error.message}`);

  return {
    items,
    partners,
    products: [...new Set(items.map((row) => row.productLine))].sort(),
    states: [...new Set(items.map((item) => item.state).filter((state) => state !== "—"))].sort(),
    claimedUsers: [...new Map(items.filter((item) => item.ownerUserId).map((item) => [item.ownerUserId!, item.ownerName ?? "Another agent"]))].map(([id, name]) => ({ id, name })),
    handoffs: (pending.data ?? []).map((handoff) => ({ id: handoff.id, workItemId: handoff.work_item_id, bufferUserId: handoff.buffer_user_id, bufferName: handoff.buffer_name, productLine: handoff.product_line, customer: handoff.customer, progressPercentage: handoff.progress_percentage, verificationSessionId: handoff.verification_session_id, offeredAt: handoff.offered_at, expiresAt: handoff.expires_at })) as PendingHandoff[],
  };
}

export async function postPartnerClaimMessage(tenantId: string, workItemId: string, userId: string, customer: string, options: { eventKey?: string; message?: string } = {}) {
  const supabase = getSupabaseServiceClient();
  const { data: queue, error: queueError } = await supabase.from("lead_queue").select("partner_id").eq("id", workItemId).eq("tenant_id", tenantId).single();
  if (queueError || !queue?.partner_id) throw new Error("Partner channel is not available for this transfer");
  const message = {
    tenant_id: tenantId,
    partner_id: queue.partner_id,
    work_item_id: workItemId,
    message: options.message ?? `${customer} is connected to the agent`,
    event_key: options.eventKey ?? null,
    created_by: userId,
  };
  const result = await supabase.from("partner_messages").insert(message);
  const { error } = result;
  if (options.eventKey && error?.code === "23505") return;
  if (error) throw new Error(`Could not post partner claim message: ${error.message}`);
}
