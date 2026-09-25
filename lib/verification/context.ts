import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * What the inbound verification screen shows around the form: who claimed the transfer and when,
 * the partner, how long the call record has been open, and the change history.
 *
 * Deliberately outside lib/verification/service.ts. That module is the one verification
 * implementation both the inbound route and the outbound application route call
 * (lib/outboundApplication/noFork.test.mjs); this is screen context read beside it, keyed by the
 * ids the panel already returned, and it changes nothing about how a field is verified.
 *
 * History has three sources, each already written by the product:
 *   - the claim: the `tenant.transfer_claimed` audit row (lead_queue.claimed_at when it is missing);
 *   - corrections: verification_field_changes, one row per correction with the old and new value
 *     (the values are not returned — the screen names the field, it does not replay banking data);
 *   - confirmations and "marked outstanding": the `tenant.verification_field_updated` audit rows
 *     update_verification_field writes for this session (corrections are skipped there, so a
 *     correction is not listed twice).
 */
export type VerificationHistoryEntry = { id: string; kind: "claimed" | "confirmed" | "corrected" | "outstanding"; fieldKey: string | null; at: string; actorName: string; isYou: boolean };
export type VerificationContext = {
  claim: { at: string | null; byName: string | null; isYou: boolean };
  partnerName: string | null;
  /** active_calls.started_at of the open call record; null when there is none. */
  callStartedAt: string | null;
  history: VerificationHistoryEntry[];
};

type AuditRow = { id: string; ts: string; actor_id: string | null; action: string; target_id: string | null; metadata: Record<string, unknown> | null };

export async function getVerificationContext(params: { tenantId: string; userId: string; workItemId: string; leadId: string; sessionId: string }): Promise<VerificationContext> {
  const supabase = getSupabaseServiceClient();
  const [queue, call, changes, audits] = await Promise.all([
    supabase.from("lead_queue").select("claimed_at, claimed_by, owner_user_id, partner_id").eq("id", params.workItemId).eq("tenant_id", params.tenantId).maybeSingle(),
    supabase.from("active_calls").select("started_at").eq("tenant_id", params.tenantId).eq("work_item_id", params.workItemId).is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("verification_field_changes").select("id, field_key, actor_id, created_at").eq("tenant_id", params.tenantId).eq("session_id", params.sessionId).order("created_at", { ascending: false }).limit(50),
    supabase.from("audit_log").select("id, ts, actor_id, action, target_id, metadata").in("target_id", [params.leadId, params.workItemId]).in("action", ["tenant.verification_field_updated", "tenant.transfer_claimed"]).order("ts", { ascending: false }).limit(150),
  ]);

  const auditRows = (audits.error ? [] : (audits.data ?? [])) as unknown as AuditRow[];
  // Newest first, so this is the latest claim (a reopened transfer can be claimed again).
  const claimAudit = auditRows.find((row) => row.action === "tenant.transfer_claimed" && row.target_id === params.workItemId) ?? null;
  const stateRows = auditRows.filter((row) => row.action === "tenant.verification_field_updated" && row.metadata?.sessionId === params.sessionId && row.metadata?.state !== "corrected");
  const changeRows = changes.error ? [] : (changes.data ?? []);

  const claimedBy = claimAudit?.actor_id ?? queue.data?.claimed_by ?? null;
  const claimedAt = claimAudit?.ts ?? queue.data?.claimed_at ?? null;
  const actorIds = [...new Set([claimedBy, ...changeRows.map((row) => row.actor_id), ...stateRows.map((row) => row.actor_id)].filter((id): id is string => typeof id === "string"))];
  const [users, partner] = await Promise.all([
    actorIds.length ? supabase.from("users").select("id, name").in("id", actorIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    queue.data?.partner_id ? supabase.from("partners").select("name").eq("id", queue.data.partner_id).eq("tenant_id", params.tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const names = new Map(((users.data ?? []) as Array<{ id: string; name: string }>).map((user) => [user.id, user.name]));
  const who = (id: string | null) => (id === params.userId ? "You" : (id && names.get(id)) || "Another agent");

  const history: VerificationHistoryEntry[] = [
    ...changeRows.map((row) => ({ id: `change:${row.id}`, kind: "corrected" as const, fieldKey: row.field_key, at: row.created_at, actorName: who(row.actor_id), isYou: row.actor_id === params.userId })),
    ...stateRows.map((row) => ({
      id: `audit:${row.id}`,
      kind: row.metadata?.state === "outstanding" ? "outstanding" as const : "confirmed" as const,
      fieldKey: typeof row.metadata?.fieldKey === "string" ? row.metadata.fieldKey : null,
      at: row.ts,
      actorName: who(row.actor_id),
      isYou: row.actor_id === params.userId,
    })),
    ...(claimedAt ? [{ id: "claim", kind: "claimed" as const, fieldKey: null, at: claimedAt, actorName: who(claimedBy), isYou: claimedBy === params.userId }] : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    claim: { at: claimedAt, byName: claimedBy ? who(claimedBy) : null, isYou: claimedBy === params.userId },
    partnerName: (partner.data as { name?: string } | null)?.name ?? null,
    callStartedAt: call.error ? null : call.data?.started_at ?? null,
    history,
  };
}
