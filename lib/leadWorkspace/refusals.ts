import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The attempts and callbacks the product refused, kept so the lead's record can show them.
 *
 * A refused dial is never placed and a refused callback time is never stored, so neither leaves a
 * row in tenant_call_attempts or tenant_callbacks — and "why did nobody call her on Monday" then
 * has no answer. The refusal is written to audit_log against the lead instead: append-only, already
 * tenant-scoped through the lead id, and no new table. The Attempts and Callbacks tabs read it back
 * (lib/leadWorkspace/record.ts).
 *
 * Best effort by design. The refusal is the outcome the agent is waiting on; failing to record it
 * must not turn a clear "outside the window" into a 500, so an insert error is logged, not thrown.
 */
export type DialRefusal = { tenantId: string; leadId: string; actorId: string; reason: string; message: string; inbound: boolean };
export type CallbackRefusal = { tenantId: string; leadId: string; actorId: string | null; requestedLocal: string; timezone: string; requestedAtUtc: string | null; message: string };

async function record(action: "tenant.dial_refused" | "tenant.callback_refused", actorId: string | null, leadId: string, metadata: Record<string, unknown>) {
  try {
    const { error } = await getSupabaseServiceClient().from("audit_log").insert({ actor_type: "tenant", actor_id: actorId, action, target_type: "lead", target_id: leadId, metadata: metadata as never });
    if (error) console.error("refusal audit insert failed", action, error.message);
  } catch (error) {
    console.error("refusal audit insert failed", action, error);
  }
}

export function recordDialRefused(input: DialRefusal) {
  return record("tenant.dial_refused", input.actorId, input.leadId, { tenantId: input.tenantId, reason: input.reason, message: input.message, inbound: input.inbound });
}

export function recordCallbackRefused(input: CallbackRefusal) {
  return record("tenant.callback_refused", input.actorId, input.leadId, { tenantId: input.tenantId, requestedLocal: input.requestedLocal, timezone: input.timezone, requestedAtUtc: input.requestedAtUtc, message: input.message });
}
