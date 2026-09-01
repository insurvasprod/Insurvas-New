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

export async function getTransferInbox(tenantId: string, filters: InboxFilters, currentUserId: string) {
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

  return {
    items,
    partners,
    products: [...new Set(items.map((row) => row.productLine))].sort(),
    states: [...new Set(items.map((item) => item.state).filter((state) => state !== "—"))].sort(),
    claimedUsers: [...new Map(items.filter((item) => item.ownerUserId).map((item) => [item.ownerUserId!, item.ownerName ?? "Another agent"]))].map(([id, name]) => ({ id, name })),
  };
}

export async function postPartnerClaimMessage(tenantId: string, workItemId: string, userId: string, customer: string) {
  const supabase = getSupabaseServiceClient();
  const { data: queue, error: queueError } = await supabase.from("lead_queue").select("partner_id").eq("id", workItemId).eq("tenant_id", tenantId).single();
  if (queueError || !queue?.partner_id) throw new Error("Partner channel is not available for this transfer");
  const { error } = await supabase.from("partner_messages").insert({
    tenant_id: tenantId,
    partner_id: queue.partner_id,
    work_item_id: workItemId,
    message: `${customer} is connected to the agent`,
    created_by: userId,
  });
  if (error) throw new Error(`Could not post partner claim message: ${error.message}`);
}
