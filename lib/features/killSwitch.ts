import "server-only";
import { cache } from "react";

// SA-4.10 · Reading the kill switches, and the cache that makes it cheap.
//
// Consulted BEFORE the entitlement at every enforcement point. The switches are platform-wide, so
// this is one small lookup shared by every tenant rather than per-tenant work — which is why it is
// not folded into tenant_entitlements. See supabase/migrations/0014_feature_switches.sql.

import { formatUtc } from "@/lib/audit/logView";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  applyKillSwitches,
  isFeatureAvailable,
  killSwitchNotice,
  type FeatureSwitch,
  type SwitchReason,
} from "./killSwitchRules";

export type { FeatureSwitch, SwitchReason };

// Kill switches are safety controls. Do not cache them in the application process: an admin write
// can be handled by a different route bundle or server instance, so in-memory invalidation cannot
// guarantee that the next tenant request sees the new state. The table is intentionally tiny and
// the direct read gives immediate cross-process propagation.
export function invalidateKillSwitchCache(): void {
  // Kept as a compatibility hook for callers that invalidate after a write.
}

async function loadSwitches(): Promise<Map<string, FeatureSwitch>> {
  const supabase = getSupabaseServiceClient();

  // Only rows that are not plain "on" matter — an absent row already means available.
  const { data, error } = await supabase
    .from("feature_switches")
    .select("feature_key, state, beta_tenant_ids, off_message, updated_at")
    .neq("state", "on");

  // The live control plane names this table platform_feature_controls and calls the operator
  // message `reason`. Keep the application contract stable while reading either deployed shape.
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compat = supabase as unknown as { from: (table: string) => any };
    const fallback = await compat
      .from("platform_feature_controls")
      .select("feature_key, state, beta_tenant_ids, reason, updated_at")
      .neq("state", "on");
    if (!fallback.error) {
      return new Map(
        (fallback.data ?? []).map(
          (row: {
            feature_key: string;
            state: FeatureSwitch["state"];
            beta_tenant_ids: string[];
            reason: string | null;
            updated_at: string | null;
          }) => [
            row.feature_key,
            {
              feature_key: row.feature_key,
              state: row.state,
              beta_tenant_ids: row.beta_tenant_ids ?? [],
              off_message: row.reason,
              updated_at: row.updated_at,
            },
          ],
        ),
      );
    }
  }

  if (error) {
    // FAIL OPEN, loudly. This is the one judgement in the file worth arguing about: if the table
    // cannot be read, every feature stays reachable rather than the whole product going dark.
    // Failing closed would turn one unreadable table into a total outage for every tenant, which
    // is a far worse failure than a killed feature staying up for a few more seconds — and the
    // switches exist to handle rare incidents, not to be the primary access control. Entitlements
    // still apply either way, so nobody gets anything they did not pay for.
    console.error(
      "[kill-switch] could not load switches — every feature is treated as ON",
      error,
    );
    return new Map();
  }

  return new Map(
    (data ?? []).map((row) => [row.feature_key, row as FeatureSwitch]),
  );
}

// Request-scoped only (React `cache`): one render that asks for the menu, the route guard and a
// tile's gate reads the table once instead of three times. This is NOT the process cache the note
// at the top rules out — nothing outlives the request, so an admin's switch is still seen by the
// very next request on any instance.
const currentSwitches = cache(loadSwitches);

/**
 * The switch table on its own, for callers that already have to await something else.
 *
 * `effectiveFeatures` below couples the read to the apply, which forces a caller that must first
 * resolve an entitlement into two serial round trips. The read depends on neither the feature list
 * nor the tenant — only `applyKillSwitches` does — so a caller can fetch this alongside whatever
 * else it needs and apply the result afterwards. Measured on the agent dashboard: ~170ms of ~340ms
 * of data time, removed by overlapping it with the entitlement read.
 *
 * This is not a cache and does not become one: every call still reads the table, which is the
 * property the note at the top of this file is protecting.
 */
export async function loadFeatureSwitches(): Promise<Map<string, FeatureSwitch>> {
  return currentSwitches();
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
  return applyKillSwitches(
    grantedFeatureKeys,
    await currentSwitches(),
    tenantId,
  );
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

  if (!data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compat = supabase as unknown as { from: (table: string) => any };
    const fallback = await compat
      .from("platform_feature_controls")
      .select("feature_key, state, beta_tenant_ids, reason, updated_at");
    if (!fallback.error) {
      return new Map(
        (fallback.data ?? []).map(
          (row: {
            feature_key: string;
            state: FeatureSwitch["state"];
            beta_tenant_ids: string[];
            reason: string | null;
            updated_at: string | null;
          }) => [
            row.feature_key,
            {
              feature_key: row.feature_key,
              state: row.state,
              beta_tenant_ids: row.beta_tenant_ids ?? [],
              off_message: row.reason,
              updated_at: row.updated_at,
            },
          ],
        ),
      );
    }
  }

  return new Map(
    (data ?? []).map((row) => [row.feature_key, row as FeatureSwitch]),
  );
}

/**
 * The reason given with each switch's latest change, for the admin screen's "Internal:" line.
 *
 * Read from audit_log, not from the switch: the reason is required by the PUT route and written to
 * the audit row, and nowhere else. One indexed lookup per key (audit_log_target_ts_idx on
 * (target_id, ts desc), 20260924347000) rather than one scan of every switch change ever made.
 *
 * Deliberately separate from loadSwitches: that one is on the enforcement path of every tenant
 * request, and nothing about the admin screen's history belongs there. A failed read here only
 * loses the reason line — it never changes what is reachable.
 */
export async function fetchSwitchReasons(
  featureKeys: readonly string[],
): Promise<Map<string, SwitchReason>> {
  const keys = [...new Set(featureKeys)];
  if (keys.length === 0) return new Map();

  const supabase = getSupabaseServiceClient();
  const rows = await Promise.all(
    keys.map(async (key) => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("target_id, reason, ts, actor_id")
        .eq("action", "feature.switch_changed")
        .eq("target_id", key)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle<{ target_id: string; reason: string | null; ts: string; actor_id: string | null }>();
      if (error) {
        console.error("[kill-switch] could not read the reason for", key, error);
        return null;
      }
      return data;
    }),
  );

  const found = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  const actorIds = [...new Set(found.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actors } = actorIds.length
    ? await supabase.from("admin_users").select("id, name, email").in("id", actorIds)
    : { data: [] as { id: string; name: string | null; email: string }[] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.name || a.email]));

  return new Map(
    found.map((row) => [
      row.target_id,
      {
        reason: row.reason?.trim() || null,
        changedAt: row.ts,
        changedAtUtc: formatUtc(row.ts),
        changedBy: row.actor_id ? actorName.get(row.actor_id) ?? null : null,
      },
    ]),
  );
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

  const { error } = await supabase
    .from("feature_switches")
    .upsert(row, { onConflict: "feature_key" });
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compat = supabase as unknown as { from: (table: string) => any };
    const fallback = await compat.from("platform_feature_controls").upsert(
      {
        feature_key: input.featureKey,
        state: input.state,
        beta_tenant_ids: row.beta_tenant_ids,
        reason: input.offMessage,
        updated_by: adminId,
        updated_at: row.updated_at,
      },
      { onConflict: "feature_key" },
    );
    if (fallback.error)
      throw new Error(
        `Could not save the switch for ${input.featureKey}: ${fallback.error.message}`,
      );
  }

  invalidateKillSwitchCache();
  return { from: before, to: row as unknown as FeatureSwitch };
}
