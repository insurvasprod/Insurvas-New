/**
 * Finds tenants whose cached entitlement disagrees with the plan they are subscribed to, and
 * optionally rebuilds them. "What they should have" is the plan's features, plus the features of
 * add-ons still attached, with the tenant's feature overrides applied (off removes, on adds) —
 * exactly what refresh_tenant_entitlement() builds, so none of those three reads as drift.
 *
 *   node --env-file=.env.local scripts/reconcile-entitlements.mjs            # report only
 *   node --env-file=.env.local scripts/reconcile-entitlements.mjs --fix      # rebuild the drifted
 *   node --env-file=.env.local scripts/reconcile-entitlements.mjs --fix --include-missing
 *
 * ## Why this exists
 *
 * `tenant_entitlements` is a cache. `refresh_tenant_entitlement()` rebuilds one tenant's row and is
 * called by every admin route that changes a subscription — assign, change plan, cancel, pause,
 * resume. What nothing calls is a **reconciliation**: when `plan_features` changes by any route
 * other than the admin screens — a migration, a seed, a direct fix — the caches of tenants already
 * on that plan are never rebuilt, and nothing notices.
 *
 * Measured on 2026-09-21 across 35 non-cancelled subscriptions:
 *
 *   15  cache matches the plan
 *    5  cache DISAGREES — every one on `advance`, each missing `partner_quality`, a feature their
 *       plan grants and they pay for, stale since 2026-09-12
 *   15  no entitlement row at all
 *
 * `admin_rebuild_entitlements` exists in the database for exactly this and is called from nowhere
 * in the codebase (`npm run verify:rpc-contract` lists it among the uncalled functions).
 *
 * ## The two groups are not the same, which is why they are separate flags
 *
 * **Drifted** rows are unambiguous: the tenant has a plan, the plan grants a feature, the cache
 * omits it. Rebuilding can only bring them closer to what was sold. `--fix` handles these.
 *
 * **Missing** rows are a product decision. A tenant with no entitlement row falls back to the LA-0
 * bridge default, which is a fixed feature list rather than their plan's. Creating the row replaces
 * that default with the real plan — which for some tenants means **fewer** features than they see
 * today. That is almost certainly correct, and it is still a visible change to a live account, so
 * it needs `--include-missing` said out loud.
 */
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const fix = process.argv.includes("--fix");
const includeMissing = process.argv.includes("--include-missing");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const [
    { data: plans, error: planError },
    { data: planFeatures, error: pfError },
    { data: subs, error: subError },
    { data: cached, error: entError },
    { data: attached, error: attachedError },
    { data: addonFeatures, error: afError },
    overridesRead,
  ] = await Promise.all([
    sb.from("plans").select("id, code, version"),
    sb.from("plan_features").select("plan_id, feature_key"),
    sb.from("subscriptions").select("id, tenant_id, plan_id, status").neq("status", "cancelled"),
    sb.from("tenant_entitlements").select("tenant_id, entitlement, computed_at"),
    sb.from("subscription_addons").select("subscription_id, addon_id").is("detached_at", null),
    sb.from("addon_features").select("addon_id, feature_key"),
    sb.from("tenant_feature_overrides").select("tenant_id, feature_key, state"),
  ]);

  for (const [what, error] of [["plans", planError], ["plan_features", pfError], ["subscriptions", subError], ["tenant_entitlements", entError], ["subscription_addons", attachedError], ["addon_features", afError]]) {
    if (error) {
      console.error(`Could not read ${what}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  // Per-tenant overrides (20260924344000) are part of what the engine is SUPPOSED to produce, so they
  // are expected, not drift. Before that migration the table does not exist and there are none.
  let overrides = overridesRead.data ?? [];
  if (overridesRead.error) {
    if (!["42P01", "PGRST205"].includes(overridesRead.error.code ?? "") && !/does not exist|schema cache/i.test(overridesRead.error.message)) {
      console.error(`Could not read tenant_feature_overrides: ${overridesRead.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log("tenant_feature_overrides is not in the database yet; counting no overrides.");
    overrides = [];
  }

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const grantedBy = new Map();
  for (const row of planFeatures) {
    if (!grantedBy.has(row.plan_id)) grantedBy.set(row.plan_id, new Set());
    grantedBy.get(row.plan_id).add(row.feature_key);
  }
  // Attached add-ons grant features too — the engine unions them with the plan's (SA-2.6).
  const featuresByAddon = new Map();
  for (const row of addonFeatures) {
    if (!featuresByAddon.has(row.addon_id)) featuresByAddon.set(row.addon_id, new Set());
    featuresByAddon.get(row.addon_id).add(row.feature_key);
  }
  const addonKeysBySub = new Map();
  for (const row of attached) {
    if (!addonKeysBySub.has(row.subscription_id)) addonKeysBySub.set(row.subscription_id, new Set());
    for (const key of featuresByAddon.get(row.addon_id) ?? []) addonKeysBySub.get(row.subscription_id).add(key);
  }
  const overridesByTenant = new Map();
  for (const row of overrides) {
    if (!overridesByTenant.has(row.tenant_id)) overridesByTenant.set(row.tenant_id, []);
    overridesByTenant.get(row.tenant_id).push(row);
  }
  const cacheByTenant = new Map(cached.map((row) => [row.tenant_id, row]));

  const drifted = [];
  const missing = [];
  let matching = 0;

  for (const sub of subs) {
    // plan ∪ attached add-ons, then this tenant's overrides: off removes, on adds.
    const expected = new Set([...(grantedBy.get(sub.plan_id) ?? []), ...(addonKeysBySub.get(sub.id) ?? [])]);
    for (const override of overridesByTenant.get(sub.tenant_id) ?? []) {
      if (override.state === "off") expected.delete(override.feature_key);
      else expected.add(override.feature_key);
    }
    const row = cacheByTenant.get(sub.tenant_id);
    const plan = planById.get(sub.plan_id);

    if (!row) {
      missing.push({ tenant: sub.tenant_id, plan: plan?.code, status: sub.status });
      continue;
    }

    const have = new Set(row.entitlement?.features ?? []);
    const absent = [...expected].filter((key) => !have.has(key));
    const extra = [...have].filter((key) => !expected.has(key));

    if (absent.length || extra.length) {
      drifted.push({ tenant: sub.tenant_id, plan: plan?.code, status: sub.status, absent, extra, computed: row.computed_at });
    } else matching += 1;
  }

  console.log(`non-cancelled subscriptions : ${subs.length}`);
  console.log(`  cache matches the plan    : ${matching}`);
  console.log(`  cache has drifted         : ${drifted.length}`);
  console.log(`  no entitlement row        : ${missing.length}`);

  for (const row of drifted) {
    console.log(
      `\n  DRIFT ${row.tenant.slice(0, 8)} ${row.plan} (${row.status}) computed ${String(row.computed).slice(0, 10)}` +
        `\n        missing from the cache : ${row.absent.join(", ") || "—"}` +
        `\n        present but not granted: ${row.extra.join(", ") || "—"}`,
    );
  }

  const targets = [...drifted, ...(includeMissing ? missing : [])];

  if (!fix) {
    console.log(`\nReport only. Re-run with --fix to rebuild ${drifted.length} drifted row(s)` +
      `${missing.length ? `, or --fix --include-missing to also create ${missing.length} absent one(s)` : ""}.`);
    return;
  }

  let rebuilt = 0;
  for (const row of targets) {
    const { error } = await sb.rpc("refresh_tenant_entitlement", { p_tenant_id: row.tenant });
    if (error) {
      console.error(`  failed ${row.tenant}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    rebuilt += 1;
  }

  console.log(`\nRebuilt ${rebuilt} of ${targets.length} entitlement(s). Re-run without --fix to confirm.`);
}

await main();
