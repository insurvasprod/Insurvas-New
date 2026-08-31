import "server-only";

// SA-4.10 · Reading the kill switches, and the cache that makes it cheap.
//
// Consulted BEFORE the entitlement at every enforcement point. The switches are platform-wide, so
// this is one small lookup shared by every tenant rather than per-tenant work — which is why it is
// not folded into tenant_entitlements. See supabase/migrations/0014_feature_switches.sql.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  applyKillSwitches,
  isFeatureAvailable,
  killSwitchNotice,
  type FeatureSwitch,
} from "./killSwitchRules";

export type { FeatureSwitch };

/**
 * Thirty seconds, against a criterion of sixty.
 *
 * The margin is deliberate. Invalidation on write only reaches the process that handled the
 * toggle; on serverless every other instance keeps its copy until the TTL expires, so the TTL — not
 * the invalidation — is what actually bounds how long a killed feature stays reachable. Half the
 * budget leaves room for a slow request that started before the toggle.
 */
const CACHE_TTL_MS = 30_000;

let cache: { at: number; switches: Map<string, FeatureSwitch> } | null = null;

export function invalidateKillSwitchCache(): void {
  cache = null;
}

async function loadSwitches(): Promise<Map<string, FeatureSwitch>> {
  const supabase = getSupabaseServiceClient();

  // Only rows that are not plain "on" matter — an absent row already means available.
  const { data, error } = await supabase
    .from("feature_switches")
    .select("feature_key, state, beta_tenant_ids, off_message, updated_at")
    .neq("state", "on");

  if (error) {
    // FAIL OPEN, loudly. This is the one judgement in the file worth arguing about: if the table
    // cannot be read, every feature stays reachable rather than the whole product going dark.
    // Failing closed would turn one unreadable table into a total outage for every tenant, which
    // is a far worse failure than a killed feature staying up for a few more seconds — and the
    // switches exist to handle rare incidents, not to be the primary access control. Entitlements
    // still apply either way, so nobody gets anything they did not pay for.
    console.error("[kill-switch] could not load switches — every feature is treated as ON", error);
    return new Map();
  }

  return new Map((data ?? []).map((row) => [row.feature_key, row as FeatureSwitch]));
}

async function currentSwitches(): Promise<Map<string, FeatureSwitch>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.switches;

  const switches = await loadSwitches();
  cache = { at: Date.now(), switches };
  return switches;
}

/**
 * The entitlement's features, minus anything switched off for this tenant right now.
 *
 * Every enforcement point calls this — the agent menu, the route guard and the API — so the three
 * cannot disagree about what is reachable.
 */
export async function effectiveFeatures(
  grantedFeatureKeys: readonly string[],
  tenantId: string,
): Promise<string[]> {
  return applyKillSwitches(grantedFeatureKeys, await currentSwitches(), tenantId);
}

/** Whether one feature is reachable, plus the message to show if it is not. */
export async function featureKillState(
  featureKey: string,
  tenantId: string,
): Promise<{ killed: boolean; notice: string | null }> {
  const featureSwitch = (await currentSwitches()).get(featureKey);

  return {
    killed: !isFeatureAvailable(featureSwitch, tenantId),
    notice: killSwitchNotice(featureSwitch),
  };
}

/** Every switch, including the "on" rows the enforcement path skips. For the admin screen. */
export async function fetchAllSwitches(): Promise<Map<string, FeatureSwitch>> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("feature_switches")
    .select("feature_key, state, beta_tenant_ids, off_message, updated_at");

  return new Map((data ?? []).map((row) => [row.feature_key, row as FeatureSwitch]));
}

/**
 * Writes one switch. The caller audits — deliberately not done here, so a write and its audit row
 * cannot be separated by a future refactor that calls this from somewhere new.
 */
export async function setSwitch(
  input: {
    featureKey: string;
    state: FeatureSwitch["state"];
    betaTenantIds: string[];
    offMessage: string | null;
  },
  adminId: string,
): Promise<{ from: FeatureSwitch | null; to: FeatureSwitch }> {
  const supabase = getSupabaseServiceClient();
  const before = (await fetchAllSwitches()).get(input.featureKey) ?? null;

  const row = {
    feature_key: input.featureKey,
    state: input.state,
    // Cleared when not in beta, so a stale allowlist cannot quietly come back to life the next
    // time somebody flips the state to beta.
    beta_tenant_ids: input.state === "beta" ? input.betaTenantIds : [],
    off_message: input.offMessage,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("feature_switches").upsert(row, { onConflict: "feature_key" });
  if (error) throw new Error(`Could not save the switch for ${input.featureKey}: ${error.message}`);

  invalidateKillSwitchCache();
  return { from: before, to: row as unknown as FeatureSwitch };
}
