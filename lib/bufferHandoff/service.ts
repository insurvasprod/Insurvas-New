import "server-only";

import { getClientIp } from "@/lib/request/clientInfo";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type LicensedAgent = { id: string; name: string; role: "owner" | "producer" };

export class BufferHandoffError extends Error {
  constructor(public code: string, message = code) { super(message); }
}

export async function listLicensedAgents(tenantId: string, excludeUserId?: string): Promise<LicensedAgent[]> {
  const supabase = getSupabaseServiceClient();
  let membershipQuery = supabase.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).in("role", ["owner", "producer"]);
  if (excludeUserId) membershipQuery = membershipQuery.neq("user_id", excludeUserId);
  const memberships = await membershipQuery;
  if (memberships.error) throw new BufferHandoffError("handoff_unavailable", memberships.error.message);
  const ids = (memberships.data ?? []).map((membership) => membership.user_id);
  if (ids.length === 0) return [];
  const users = await supabase.from("users").select("id, name, status").in("id", ids).eq("status", "active");
  if (users.error) throw new BufferHandoffError("handoff_unavailable", users.error.message);
  const names = new Map((users.data ?? []).map((user) => [user.id, user.name]));
  return (memberships.data ?? []).map((membership) => ({ id: membership.user_id, name: names.get(membership.user_id) ?? "Licensed agent", role: membership.role as "owner" | "producer" }));
}

export async function getBufferHandoffContext(tenantId: string, bufferUserId: string) {
  return { licensedAgents: await listLicensedAgents(tenantId, bufferUserId), canOffer: true };
}

export async function listPendingBufferHandoffs(tenantId: string, licensedAgentId: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("list_buffer_handoffs", { p_tenant_id: tenantId, p_licensed_agent_id: licensedAgentId });
  if (error) throw new BufferHandoffError("handoff_unavailable", error.message);
  return (data ?? []).map((handoff) => ({ id: handoff.id, workItemId: handoff.work_item_id, bufferUserId: handoff.buffer_user_id, bufferName: handoff.buffer_name, productLine: handoff.product_line, customer: handoff.customer, progressPercentage: handoff.progress_percentage, verificationSessionId: handoff.verification_session_id, offeredAt: handoff.offered_at, expiresAt: handoff.expires_at }));
}

function mapError(message: string): BufferHandoffError {
  const messages: Record<string, [string, string]> = {
    BUFFER_ROLE_REQUIRED: ["buffer_role_required", "Only a buffer assistant can offer a handoff."],
    LICENSED_AGENT_REQUIRED: ["licensed_agent_required", "Choose an active licensed agent."],
    BUFFER_OWNER_REQUIRED: ["buffer_owner_required", "This transfer is no longer owned by you."],
    HANDOFF_PENDING: ["handoff_pending", "This transfer already has a pending handoff."],
    HANDOFF_NOT_FOUND: ["handoff_not_found", "That handoff is no longer available."],
    HANDOFF_NOT_AVAILABLE: ["handoff_not_available", "That handoff is no longer available."],
    HANDOFF_EXPIRED: ["handoff_expired", "The handoff timed out and returned to the buffer agent."],
    VERIFICATION_SESSION_NOT_FOUND: ["verification_session_not_found", "The verification session is no longer active."],
    ACTIVE_CALL_NOT_FOUND: ["active_call_not_found", "The active call is no longer available."],
    WORK_ITEM_NOT_FOUND: ["work_item_not_found", "That transfer was not found."],
    INVALID_HANDOFF_TIMEOUT: ["invalid_input", "The handoff timeout is invalid."],
  };
  const [code, friendly] = messages[message] ?? ["handoff_unavailable", "Could not update this handoff."];
  return new BufferHandoffError(code, friendly);
}

export async function offerBufferHandoff(params: { tenantId: string; workItemId: string; bufferUserId: string; targetUserId: string; request: Request }) {
  const { data, error } = await getSupabaseServiceClient().rpc("offer_buffer_handoff", {
    p_tenant_id: params.tenantId,
    p_work_item_id: params.workItemId,
    p_buffer_user_id: params.bufferUserId,
    p_target_user_id: params.targetUserId,
    p_timeout_seconds: 30,
    p_ip: getClientIp(params.request),
    p_user_agent: params.request.headers.get("user-agent"),
  });
  if (error) throw mapError(error.message);
  return data;
}

export async function acceptBufferHandoff(params: { tenantId: string; handoffId: string; licensedAgentId: string; request: Request }) {
  const { data, error } = await getSupabaseServiceClient().rpc("accept_buffer_handoff", {
    p_tenant_id: params.tenantId,
    p_handoff_id: params.handoffId,
    p_licensed_agent_id: params.licensedAgentId,
    p_ip: getClientIp(params.request),
    p_user_agent: params.request.headers.get("user-agent"),
  });
  if (error) throw mapError(error.message);
  return data;
}
