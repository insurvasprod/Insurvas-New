// Run with: node --experimental-strip-types --test lib/tenantFeatureOverrides/rules.test.mjs
//
// Per-tenant feature overrides (20260924344000). The rules a reviewer would otherwise have to hold
// in their head: who may switch what, what counts as a deviation, that the engine applies overrides
// but never to a cancelled tenant, and that the tenant plane says "not available on your account"
// rather than offering an upgrade for something the plan already includes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  canRemoveOverride,
  canSetOverride,
  canWriteOverrides,
  effectiveState,
  isDeviation,
  overrideRefusal,
  shortName,
} from "./constants.ts";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function latestDefining(signature) {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .find((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(signature));
  assert.ok(file, `no migration defines ${signature}`);
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(signature);
  return sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start) + 2));
}

test("switching off and removing: super admin and support agent; switching on: super admin only", () => {
  assert.equal(canSetOverride("super_admin", "on"), true);
  assert.equal(canSetOverride("super_admin", "off"), true);
  assert.equal(canSetOverride("support_agent", "off"), true);
  assert.equal(canSetOverride("support_agent", "on"), false);
  for (const role of ["billing_admin", "platform_config"]) {
    assert.equal(canSetOverride(role, "on"), false, role);
    assert.equal(canSetOverride(role, "off"), false, role);
    assert.equal(canRemoveOverride(role), false, role);
    assert.equal(canWriteOverrides(role), false, role);
  }
  assert.equal(canRemoveOverride("support_agent"), true);
});

test("an override must differ from the plan and carry a reason", () => {
  const ok = { role: "super_admin", reason: "Pilot agreed with the owner" };
  assert.equal(overrideRefusal({ ...ok, state: "on", planGrants: false }), null);
  assert.equal(overrideRefusal({ ...ok, state: "off", planGrants: true }), null);
  assert.match(overrideRefusal({ ...ok, state: "on", planGrants: true }), /already includes/);
  assert.match(overrideRefusal({ ...ok, state: "off", planGrants: false }), /nothing to switch off/);
  assert.match(overrideRefusal({ ...ok, reason: "  no ", state: "off", planGrants: true }), /at least 5/);
  assert.match(overrideRefusal({ role: "support_agent", reason: "Pilot agreed", state: "on", planGrants: false }), /super admin/);
});

test("a deviation is an override that still differs from the plan", () => {
  const on = { state: "on", reason: "x", review_on: null, set_at: "", set_by_name: null, set_by_role: null };
  assert.equal(isDeviation({ plan_grants: false, override: on }), true);
  assert.equal(isDeviation({ plan_grants: true, override: on }), false, "a plan change made it redundant");
  assert.equal(isDeviation({ plan_grants: true, override: { ...on, state: "off" } }), true);
  assert.equal(isDeviation({ plan_grants: true, override: null }), false);
  assert.equal(effectiveState({ plan_grants: true, override: { ...on, state: "off" } }, false), "off");
  assert.equal(effectiveState({ plan_grants: false, override: on }, true), "off", "cancelled grants nothing");
});

test("the board's short name", () => {
  assert.equal(shortName("Rinor Gllareva"), "R. Gllareva");
  assert.equal(shortName("Support"), "Support");
  assert.equal(shortName(null), null);
});

test("the live engine applies overrides, lists the disabled ones, and skips cancelled tenants", () => {
  const body = latestDefining("create or replace function public.refresh_tenant_entitlement");
  assert.match(body, /tenant_feature_overrides/, "the engine does not read overrides");
  assert.match(body, /'disabled_features'/, "the engine does not record which features were switched off");
  assert.match(body, /<> 'cancelled' then[\s\S]{0,200}v_granted/, "overrides must be skipped for a cancelled tenant");
  assert.match(body, /credit_grants/, "the engine regressed the credit-grant merge from 20260913330000");
  assert.match(body, /'credit_grants_included', true/, "get.ts relies on this marker to avoid double-counting grants");
  assert.match(body, /max_setter_seats/, "the engine regressed the LA-2.22 limits");
});

test("the database re-checks the role rule, and each write rebuilds the entitlement", () => {
  const set = latestDefining("create or replace function public.admin_set_tenant_feature_override");
  assert.match(set, /p_state = 'on' and v_role <> 'super_admin'/);
  assert.match(set, /override_matches_plan/);
  assert.match(set, /perform public\.refresh_tenant_entitlement\(p_tenant_id\)/);
  const remove = latestDefining("create or replace function public.admin_remove_tenant_feature_override");
  assert.match(remove, /perform public\.refresh_tenant_entitlement\(p_tenant_id\)/);
});

test("the tenant plane: kill switch first, then the neutral refusal, then the upgrade", () => {
  const source = readFileSync(join(ROOT, "lib", "entitlements", "requireFeature.ts"), "utf8");
  const kill = source.indexOf("kill.killed");
  const disabled = source.indexOf("isDisabledForTenant(entitlement, featureKey)");
  const upgrade = source.indexOf('code: "feature_not_entitled"');
  assert.ok(kill !== -1 && disabled !== -1 && upgrade !== -1);
  assert.ok(kill < disabled && disabled < upgrade, "order must be kill switch, disabled-for-tenant, not-entitled");
  assert.match(source, /code: "feature_disabled_for_tenant"/);

  const guard = readFileSync(join(ROOT, "lib", "entitlements", "guardPage.ts"), "utf8");
  assert.match(guard, /disabled: isDisabledForTenant\(entitlement, featureKey\)/);

  const notice = readFileSync(join(ROOT, "components", "app", "feature-gate-notice.tsx"), "utf8");
  const branch = notice.slice(notice.indexOf("if (guard.disabled)"), notice.indexOf("<UpgradePrompt"));
  assert.match(branch, /not available on your account/);
  assert.doesNotMatch(branch, /upgrade/i);
});
