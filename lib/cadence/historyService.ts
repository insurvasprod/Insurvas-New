import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { cadenceCaveat, type CadenceCaveat, type CadenceVersion } from "./history";

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
};

/**
 * Every recorded cadence version for the tenant (both scopes), oldest first. Null when
 * 20260925706200 is not applied — the caller then says history is not recorded, never "same".
 */
export async function cadenceVersions(tenantId: string): Promise<CadenceVersion[] | null> {
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Query };
  const result = (await db
    .from("tenant_cadence_versions")
    .select("campaign_id, rule_count, fingerprint, saved_at, source")
    .eq("tenant_id", tenantId)
    .order("saved_at", { ascending: true })) as Result<Array<{ campaign_id: string | null; rule_count: number; fingerprint: string; saved_at: string; source: string }>>;
  if (result.error) {
    if (isSchemaGap(result.error)) return null;
    throw new Error(`Could not load the cadence history: ${result.error.message}`);
  }
  return (result.data ?? []).map((row) => ({
    campaignId: row.campaign_id,
    ruleCount: Number(row.rule_count ?? 0),
    fingerprint: row.fingerprint,
    savedAt: row.saved_at,
    source: row.source === "baseline" ? "baseline" : "save",
  }));
}

/** The comparison's cadence caveat for two campaigns over their two matched periods. */
export async function comparisonCadenceCaveat(
  tenantId: string,
  a: { campaignId: string; name: string; from: string; to: string },
  b: { campaignId: string; name: string; from: string; to: string },
): Promise<CadenceCaveat> {
  return cadenceCaveat(await cadenceVersions(tenantId), a, b);
}
