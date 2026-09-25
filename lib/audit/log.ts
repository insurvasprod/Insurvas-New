import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { AuditAction } from "./actions";
import { getClientIp, getUserAgent } from "@/lib/request/clientInfo";

type AuditParams = {
  actorId: string | null;
  actorType?: "admin" | "tenant" | "system";
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
function auditRow(params: AuditParams) {
  return {
    actor_type: params.actorType ?? "admin",
    actor_id: params.actorId,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    reason: params.reason ?? null,
    ip: getClientIp(params.request),
    user_agent: getUserAgent(params.request),
    metadata: (params.metadata ?? {}) as Json,
  };
}

export async function audit(params: AuditParams): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.from("audit_log").insert(auditRow(params));

  if (error) {
    console.error("audit log insert failed", params.action, error);
    throw new Error("Could not write audit log");
  }
}

const AUDIT_BULK_CHUNK = 500;

/**
 * The same rows audit() would write, inserted in chunks instead of one round trip each -- a 20k-row
 * import was 20k sequential inserts. Still throws on the first failed chunk, so a caller that
 * awaits it cannot report success without its trail. Chunks already written stay written.
 */
export async function auditMany(entries: AuditParams[]): Promise<void> {
  if (!entries.length) return;
  const supabase = getSupabaseServiceClient();

  for (let start = 0; start < entries.length; start += AUDIT_BULK_CHUNK) {
    const chunk = entries.slice(start, start + AUDIT_BULK_CHUNK);
    const { error } = await supabase.from("audit_log").insert(chunk.map(auditRow));
    if (error) {
      console.error("audit log bulk insert failed", chunk[0].action, `rows ${start}-${start + chunk.length - 1}`, error);
      throw new Error("Could not write audit log");
    }
  }
}
