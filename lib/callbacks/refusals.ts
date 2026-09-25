import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { customerName } from "./timezone";
import { nearestLegalTime, type NearestLegalTime } from "./nearest";

/**
 * Callback times refused in the last day, for the notice on the Callbacks page: "Marcus Pell's
 * callback could not be booked for 7:30 AM … The nearest legal time is 8:00 AM his time."
 *
 * The refusal itself is the audit row lib/leadWorkspace/refusals.ts writes (tenant.callback_refused)
 * wherever a time was refused — this page, the outcome wizard, the dialer. A refusal is left off
 * once the lead has a callback booked or moved after it: the agent has already fixed it.
 */
export type CallbackRefusalNotice = {
  id: string;
  leadId: string;
  customerName: string;
  actorId: string | null;
  refusedAt: string;
  /** "YYYY-MM-DDTHH:mm" in the customer's zone, as it was asked for. */
  requestedLocal: string | null;
  timezone: string;
  message: string;
  nearest: NearestLegalTime | null;
};

const WINDOW_MS = 24 * 3_600_000;
const MAX_NOTICES = 3;

export async function recentCallbackRefusals(tenantId: string): Promise<CallbackRefusalNotice[]> {
  const db = getSupabaseServiceClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const refusals = await db
    .from("audit_log")
    .select("id, actor_id, ts, target_id, metadata")
    .eq("action", "tenant.callback_refused")
    .eq("target_type", "lead")
    .eq("metadata->>tenantId", tenantId)
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(20);
  if (refusals.error || !refusals.data?.length) return [];

  type Row = { id: string; actor_id: string | null; ts: string; target_id: string | null; metadata: Record<string, unknown> | null };
  // One notice per lead: the latest refusal says what the agent last tried.
  const latest = new Map<string, Row>();
  for (const row of refusals.data as unknown as Row[]) {
    if (row.target_id && row.metadata?.tenantId === tenantId && !latest.has(row.target_id)) latest.set(row.target_id, row);
  }
  const leadIds = [...latest.keys()];
  if (!leadIds.length) return [];

  const [leads, callbacks] = await Promise.all([
    db.from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", leadIds),
    db.from("tenant_callbacks").select("lead_id, created_at, updated_at").eq("tenant_id", tenantId).in("lead_id", leadIds),
  ]);
  if (leads.error) return [];
  const valuesOf = new Map((leads.data ?? []).map((lead) => [lead.id, (lead.values ?? {}) as Record<string, unknown>]));
  const lastBooked = new Map<string, number>();
  for (const row of callbacks.error ? [] : callbacks.data ?? []) {
    const at = Math.max(Date.parse(row.created_at), Date.parse(row.updated_at ?? row.created_at));
    lastBooked.set(row.lead_id, Math.max(lastBooked.get(row.lead_id) ?? 0, at));
  }

  const open = [...latest.values()]
    .filter((row) => valuesOf.has(row.target_id as string) && (lastBooked.get(row.target_id as string) ?? 0) < Date.parse(row.ts))
    .slice(0, MAX_NOTICES);

  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  return Promise.all(open.map(async (row) => {
    const leadId = row.target_id as string;
    const timezone = str(row.metadata?.timezone) ?? "America/New_York";
    return {
      id: row.id,
      leadId,
      customerName: customerName(valuesOf.get(leadId) ?? {}),
      actorId: row.actor_id,
      refusedAt: row.ts,
      requestedLocal: str(row.metadata?.requestedLocal),
      timezone,
      message: str(row.metadata?.message) ?? "That time is outside the customer's calling window.",
      nearest: await nearestLegalTime({ tenantId, leadId, fromUtc: str(row.metadata?.requestedAtUtc), timezone }),
    };
  }));
}
