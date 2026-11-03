import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-6.4 · how many regulator (DOI or FTC) complaints are past their response deadline and not
 * answered. Read by the app shell on every page — kept apart from the complaint store so the shell
 * loads one small query and nothing else. A failed read (or no table yet) shows no banner.
 */
export async function overdueRegulatorComplaintCount(tenantId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (getSupabaseServiceClient() as any)
    .from("complaint")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("channel", ["doi", "ftc"])
    .not("status", "in", "(responded,resolved,awaiting_regulator)")
    .is("responded_at", null)
    .lt("response_due_at", new Date().toISOString());
  return error ? 0 : count ?? 0;
}
