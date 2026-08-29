import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  PROVIDER_CALL_PREVIEW_LIMIT,
  type ProviderCallRow,
  type ProviderSettingRow,
} from "./constants";

/** The platform registry, in display order. SA-4.2 turns this screen into a real settings page. */
export async function fetchProviderSettings(): Promise<ProviderSettingRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("provider_settings")
    .select("provider, display_label, is_enabled, is_default, sort_order")
    .order("sort_order");

  return (data as ProviderSettingRow[] | null) ?? [];
}

/** Recent provider traffic for one tenant — the evidence trail when a charge is disputed. */
export async function fetchRecentProviderCalls(
  tenantId: string,
  limit: number = PROVIDER_CALL_PREVIEW_LIMIT,
): Promise<ProviderCallRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("provider_calls")
    .select("id, ts, provider, method, status, duration_ms, idempotency_key")
    .eq("tenant_id", tenantId)
    .order("ts", { ascending: false })
    .limit(limit);

  return (data as ProviderCallRow[] | null) ?? [];
}
