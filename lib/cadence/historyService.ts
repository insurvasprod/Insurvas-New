import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { cadenceCaveat, type CadenceCaveat, type CadenceVersion } from "./history";
import { readableInterval } from "./changes";
import { PREFERRED_TIMES, type CadenceRow, type PreferredTime } from "./engine";

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

/** One save of one scope, for the History sheet: the rules as stored, who saved them and when. */
export type ScopeVersion = {
  id: string;
  savedAt: string;
  savedBy: string | null;
  source: "save" | "baseline";
  rules: CadenceRow[];
};

type VersionRow = {
  id: string;
  saved_at: string;
  saved_by: string | null;
  source: string;
  rules: Array<{ attempt_number: number; delay_interval: string; preferred_slot: string | null; disposition_scope: string | null }> | null;
};

/**
 * Settings round 8 · History: every recorded version of ONE scope (the agency default when
 * `campaignId` is null), newest first, at most 50. Null when 20260925706200 is not applied — the sheet
 * then says history needs a database update. Max calls is not part of a version (the limits table
 * keeps no history), so a version is its rules only.
 */
export async function scopeVersions(tenantId: string, campaignId: string | null): Promise<ScopeVersion[] | null> {
  type Loose = PromiseLike<Result<unknown>> & {
    select(columns: string): Loose;
    eq(column: string, value: unknown): Loose;
    is(column: string, value: null): Loose;
    in(column: string, values: string[]): Loose;
    order(column: string, options?: { ascending?: boolean }): Loose;
    limit(count: number): Loose;
  };
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Loose };
  const base = db.from("tenant_cadence_versions").select("id, saved_at, saved_by, source, rules").eq("tenant_id", tenantId);
  const scoped = campaignId ? base.eq("campaign_id", campaignId) : base.is("campaign_id", null);
  const result = (await scoped.order("saved_at", { ascending: false }).limit(50)) as Result<VersionRow[]>;
  if (result.error) {
    if (isSchemaGap(result.error)) return null;
    throw new Error(`Could not load the cadence history: ${result.error.message}`);
  }
  const rows = result.data ?? [];
  const people = [...new Set(rows.map((row) => row.saved_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (people.length > 0) {
    const users = (await db.from("users").select("id, name").in("id", people)) as Result<Array<{ id: string; name: string | null }>>;
    for (const user of users.data ?? []) if (user.name) names.set(user.id, user.name);
  }
  return rows.map((row) => ({
    id: row.id,
    savedAt: row.saved_at,
    savedBy: row.saved_by ? names.get(row.saved_by) ?? null : null,
    source: row.source === "baseline" ? "baseline" : "save",
    rules: (row.rules ?? []).map((rule) => ({
      attemptNumber: Number(rule.attempt_number),
      delayInterval: readableInterval(String(rule.delay_interval ?? "")),
      preferredSlot: slotOf(rule.preferred_slot),
      dispositionScope: rule.disposition_scope ?? null,
    })),
  }));
}

const slotOf = (value: string | null): PreferredTime | null =>
  value && (PREFERRED_TIMES as readonly string[]).includes(value) ? (value as PreferredTime) : null;

/** The comparison's cadence caveat for two campaigns over their two matched periods. */
export async function comparisonCadenceCaveat(
  tenantId: string,
  a: { campaignId: string; name: string; from: string; to: string },
  b: { campaignId: string; name: string; from: string; to: string },
): Promise<CadenceCaveat> {
  return cadenceCaveat(await cadenceVersions(tenantId), a, b);
}
