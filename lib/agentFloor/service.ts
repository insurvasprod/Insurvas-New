import "server-only";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agentFloorWaitThresholds } from "@/lib/settings/queries";
import { postAgentReadyCards } from "@/lib/partnerChat/service";
import { listDueCallbacks } from "@/lib/callbacks/service";

export type AgentAvailability = "ready" | "on_break" | "off";

export type FloorMember = {
  id: string;
  name: string;
  role: string;
  availability: AgentAvailability | "offline" | "on_call";
  lastSeenAt: string | null;
};

export type FloorLead = {
  id: string;
  leadId: string;
  customer: string;
  age: string;
  state: string;
  partnerName: string;
  productLine: string;
  screeningOutcome: string;
  screeningWarning: string | null;
  duplicateWarning: boolean;
  queuedAt: string;
  ownerName: string | null;
};

export type FloorCall = FloorLead & {
  activeCallId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  startedAt: string;
};

function ageOf(lastSeenAt: string | null, now: number) {
  if (!lastSeenAt) return "offline" as const;
  return now - new Date(lastSeenAt).getTime() > 60_000 ? "offline" as const : null;
}

export async function getAgentFloor(tenantId: string, currentUserId: string, currentRole: string) {
  const supabase = getSupabaseServiceClient();
  const inbox = await import("@/lib/transferInbox/service").then(({ getTransferInbox }) => getTransferInbox(tenantId, { status: "all" }, currentUserId, currentRole));

  const { data: calls, error: callsError } = await supabase
    .from("active_calls")
    .select("id, work_item_id, user_id, agent_role, started_at")
    .eq("tenant_id", tenantId)
    .is("ended_at", null);
  if (callsError) throw new Error(`Could not load active calls: ${callsError.message}`);

  const memberRows = await supabase
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "producer", "assistant"]);
  if (memberRows.error) throw new Error(`Could not load floor members: ${memberRows.error.message}`);

  const memberIds = (memberRows.data ?? []).map((row) => row.user_id);
  const [usersResult, presenceResult] = await Promise.all([
    memberIds.length
      ? supabase.from("users").select("id, name, status").in("id", memberIds).eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("agent_presence").select("user_id, status, last_seen_at").eq("tenant_id", tenantId),
  ]);
  if (usersResult.error) throw new Error(`Could not load floor users: ${usersResult.error.message}`);
  if (presenceResult.error) throw new Error(`Could not load floor presence: ${presenceResult.error.message}`);

  const users = new Map((usersResult.data ?? []).map((user) => [user.id, user]));
  const presence = new Map((presenceResult.data ?? []).map((row) => [row.user_id, row]));
  const activeByUser = new Set((calls ?? []).map((call) => call.user_id));
  const now = Date.now();
  const members: FloorMember[] = (memberRows.data ?? [])
    .filter((row) => users.has(row.user_id))
    .map((row) => {
      const user = users.get(row.user_id)!;
      const seen = presence.get(row.user_id);
      const stale = ageOf(seen?.last_seen_at ?? null, now);
      const availability = activeByUser.has(row.user_id)
        ? "on_call"
        : stale ?? ((seen?.status as AgentAvailability | undefined) ?? "off");
      return { id: row.user_id, name: user.name, role: row.role, availability, lastSeenAt: seen?.last_seen_at ?? null };
    });

  const toLead = (item: (typeof inbox.items)[number]): FloorLead => ({
    id: item.id,
    leadId: item.leadId,
    customer: item.customer,
    age: item.age,
    state: item.state,
    partnerName: item.partnerName,
    productLine: item.productLine,
    screeningOutcome: item.screeningOutcome,
    screeningWarning: item.screeningWarning,
    duplicateWarning: item.duplicateWarning,
    queuedAt: item.queuedAt,
    ownerName: item.ownerName,
  });
  const byId = new Map(inbox.items.map((item) => [item.id, item]));

  const onCalls: FloorCall[] = (calls ?? []).flatMap((call) => {
    const item = byId.get(call.work_item_id);
    const user = users.get(call.user_id);
    if (!item || !user) return [];
    return [{ ...toLead(item), activeCallId: call.id, agentId: call.user_id, agentName: user.name, agentRole: call.agent_role, startedAt: call.started_at }];
  });

  const pendingHandoffs = currentRole === "assistant"
    ? []
    : (await import("@/lib/bufferHandoff/service").then(({ listPendingBufferHandoffs }) => listPendingBufferHandoffs(tenantId, currentUserId)));

  return {
    waiting: inbox.items.filter((item) => item.status === "unclaimed").map(toLead),
    onCalls,
    available: members.filter((member) => member.availability !== "on_call"),
    members,
    pendingHandoffs,
    waitThresholds: await agentFloorWaitThresholds(),
    realtimeTopic: `agent-floor:${tenantId}`,
    callbacks: await listDueCallbacks(tenantId),
    generatedAt: new Date().toISOString(),
  };
}

export async function updateAgentPresence(params: { tenantId: string; userId: string; status: AgentAvailability; request: Request }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("agent_presence")
    .upsert({ tenant_id: params.tenantId, user_id: params.userId, status: params.status, last_seen_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" })
    .select("user_id, status, last_seen_at, updated_at")
    .single();
  if (error) throw new Error(`Could not update availability: ${error.message}`);
  await audit({ actorType: "tenant", actorId: params.userId, action: "tenant.agent_presence_updated", targetType: "agent_presence", targetId: `${params.tenantId}:${params.userId}`, metadata: { status: params.status }, request: params.request });
  if (params.status === "ready") void postAgentReadyCards(params.tenantId, params.userId, `agent-ready:${params.userId}:${data.updated_at}`).catch((error) => console.error("Partner ready cards failed", error));
  return data;
}

export async function createAgentFloorNudge(params: { tenantId: string; userId: string; workItemId: string; targetUserId?: string | null; idempotencyKey: string; message: string; request: Request }) {
  const supabase = getSupabaseServiceClient();
  const item = await supabase.from("lead_queue").select("id, status").eq("tenant_id", params.tenantId).eq("id", params.workItemId).maybeSingle();
  if (item.error) throw new Error(`Could not validate the transfer: ${item.error.message}`);
  if (!item.data || !["unclaimed", "claimed", "buffer_active", "handed_pending", "la_active"].includes(item.data.status)) throw new Error("That transfer is no longer active.");

  if (params.targetUserId) {
    const target = await supabase.from("tenant_users").select("user_id").eq("tenant_id", params.tenantId).eq("user_id", params.targetUserId).in("role", ["owner", "producer", "assistant"]).maybeSingle();
    if (target.error) throw new Error(`Could not validate the target agent: ${target.error.message}`);
    if (!target.data) throw new Error("Choose an active agent in this tenant.");
  }

  const { data, error } = await supabase
    .from("agent_floor_nudges")
    .insert({ tenant_id: params.tenantId, work_item_id: params.workItemId, target_user_id: params.targetUserId ?? null, created_by: params.userId, idempotency_key: params.idempotencyKey, message: params.message })
    .select("id, created_at")
    .maybeSingle();
  if (error && error.code !== "23505") throw new Error(`Could not send the nudge: ${error.message}`);
  if (!data) return { alreadySent: true };

  await audit({ actorType: "tenant", actorId: params.userId, action: "tenant.agent_floor_nudged", targetType: "lead_queue", targetId: params.workItemId, metadata: { nudgeId: data.id, targetUserId: params.targetUserId ?? null, message: params.message }, request: params.request });
  return { alreadySent: false, nudgeId: data.id, createdAt: data.created_at };
}
