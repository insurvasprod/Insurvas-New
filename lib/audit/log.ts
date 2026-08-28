import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { AuditAction } from "./actions";
import { getClientIp, getUserAgent } from "@/lib/request/clientInfo";

type AuditParams = {
  actorId: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  request: Request;
};


/**
 * Writes one append-only row to audit_log. Every admin write route calls this before returning
 * success — see SA-0.3. Throws on failure rather than swallowing it: an admin action that can't
 * be recorded shouldn't silently appear to have succeeded without a trail.
 */
export async function audit(params: AuditParams): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.from("audit_log").insert({
    actor_type: "admin",
    actor_id: params.actorId,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    reason: params.reason ?? null,
    ip: getClientIp(params.request),
    user_agent: getUserAgent(params.request),
    metadata: (params.metadata ?? {}) as Json,
  });

  if (error) {
    console.error("audit log insert failed", params.action, error);
    throw new Error("Could not write audit log");
  }
}
