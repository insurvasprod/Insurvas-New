import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { shouldTouchPresence } from "./lastSeen";

/**
 * "Last seen" on Settings › Team & access: stamps a member as active.
 *
 * Called from the alert-feed poll (GET /api/app/notifications), which every signed-in agent tab
 * already makes every few seconds, so presence costs no request of its own. Two throttles keep it
 * cheap: this process writes a given member at most once a minute, and the SQL function refuses a
 * write inside the same minute anyway (several servers, several tabs). Never awaited on the request
 * path — callers hand it to after().
 *
 * Until migration 20260924220400 is applied the function does not exist; the first failure is
 * remembered and nothing is attempted again for ten minutes, so an unapplied migration costs one
 * failed call per server per ten minutes rather than one per poll.
 */
const lastWrite = new Map<string, number>();
let pendingUntil = 0;
const PENDING_RETRY_MS = 10 * 60_000;

export async function touchMemberPresence(tenantId: string, userId: string, now = Date.now()): Promise<void> {
  if (now < pendingUntil) return;
  const key = `${tenantId}:${userId}`;
  if (!shouldTouchPresence(lastWrite.get(key), now)) return;
  lastWrite.set(key, now);
  // The map only needs recent members; drop it wholesale rather than let it grow on a long-lived server.
  if (lastWrite.size > 5000) lastWrite.clear();
  const { error } = await getSupabaseServiceClient().rpc("touch_tenant_member_activity" as never, { p_tenant_id: tenantId, p_user_id: userId } as never);
  if (!error) return;
  if (isPendingSchema(error as { message: string; code?: string })) {
    pendingUntil = now + PENDING_RETRY_MS;
    return;
  }
  lastWrite.delete(key);
  console.error(`[team] could not record presence: ${error.message}`);
}
