import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The lead behind each transfer a chat card is about, for the phone's partner chat (board H3: "a lead
 * they sent shows as a small record card that opens the lead"). Cards name the queue row
 * (work_item_id); the app's lead screen opens by lead id.
 *
 * Only ids the caller already holds are looked up — the cards of the conversations the agent route has
 * already scoped to this person — and always inside the session's tenant. The lead screen still runs
 * its own guard (a producer cannot open another producer's record), so an id here opens nothing the
 * person could not open anyway. A failed read answers an empty map: the cards still show, unlinked.
 */
const CHUNK = 100;

export async function leadIdsForWorkItems(tenantId: string, workItemIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(workItemIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return {};
  const db = getSupabaseServiceClient();
  const parts = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK));
  try {
    const answers = await Promise.all(parts.map((part) => db.from("lead_queue").select("id, lead_id").eq("tenant_id", tenantId).in("id", part)));
    const out: Record<string, string> = {};
    for (const { data, error } of answers) {
      if (error) return {};
      for (const row of (data ?? []) as { id: string; lead_id: string | null }[]) if (row.lead_id) out[row.id] = row.lead_id;
    }
    return out;
  } catch {
    return {};
  }
}
