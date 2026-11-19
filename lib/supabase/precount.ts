import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Pre-counted figures (20261118100000, speed pass 2026-11-18). A figure that recounts the whole book
 * (the campaign funnel, the all-time scorecard, the returns summary) is read from `tenant_precount`,
 * kept fresh by pg_cron while it is in use, instead of being counted on every open.
 *
 *   const { data, error } = await precounted(tenantId, "campaign_funnel", {}, () => db.rpc("tenant_campaign_funnel", { p_tenant_id: tenantId }));
 *
 * The answer has the same shape as the live call. Until the migration is applied, and only then, the
 * live call runs instead (the first missing-function answer is remembered for this process, so a page
 * never pays for both). Any other failure is returned as the error, as the live call's would be.
 */
export type PrecountKey = "campaign_funnel" | "vendor_returns_summary" | "vendor_undialable_rates" | "vendor_scorecard_report";

type Answer = { data: unknown; error: { message: string; code?: string } | null };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<Answer> };

let missing = false;

function isMissingPrecount(error: Answer["error"]): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function public\.precount_get/i.test(error.message);
}

export async function precounted(tenantId: string, key: PrecountKey, args: Record<string, string | number | null>, live: () => PromiseLike<Answer>): Promise<Answer> {
  if (missing) return live();
  const kept = await (getSupabaseServiceClient() as unknown as RpcClient).rpc("precount_get", { p_tenant_id: tenantId, p_key: key, p_args: dropNulls(args) });
  if (isMissingPrecount(kept.error)) {
    missing = true;
    return live();
  }
  return kept;
}

/** After a write that changes these figures: the next open counts them live, not from the kept copy. */
export async function forgetPrecounted(tenantId: string, keys: PrecountKey[]): Promise<void> {
  if (missing || keys.length === 0) return;
  const result = await (getSupabaseServiceClient() as unknown as RpcClient).rpc("precount_forget", { p_tenant_id: tenantId, p_keys: keys });
  if (isMissingPrecount(result.error) || /precount_forget/i.test(result.error?.message ?? "")) return;
  if (result.error) throw new Error(`Could not refresh the counted figures: ${result.error.message}`);
}

// The kept copy is keyed by its arguments as JSON, so an absent argument and a null one must be the same key.
function dropNulls(args: Record<string, string | number | null>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(args)) if (value !== null && value !== undefined && value !== "") out[name] = value;
  return out;
}
