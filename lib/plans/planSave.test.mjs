// Run with: node --experimental-strip-types --test lib/plans/planSave.test.mjs
//
// SA-2 audit (2026-10-15): a new plan version copies every limit column (and every version-owned
// table), the plan editor saves in one transaction, and the editor names the version a publish will
// really create.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { diffPlanMeters, nextPlanVersion, planSaveErrorResponse } from "./planSave.ts";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function latestDefining(signature) {
  const file = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort().reverse()
    .find((n) => readFileSync(join(MIGRATIONS, n), "utf8").includes(signature));
  assert.ok(file, `no migration defines ${signature}`);
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(signature);
  return sql.slice(start, sql.indexOf("$$;", start));
}

test("fix 3: a new version copies every column of every version-owned table, found from the catalog", () => {
  const create = latestDefining("create or replace function public.admin_create_plan_version");
  for (const table of ["plan_features", "plan_prices", "plan_limits", "plan_meters", "plan_available_addons", "plan_product_access"]) {
    assert.match(create, new RegExp(`sa2_copy_plan_rows\\('public\\.${table}'`), `${table} is not copied`);
  }
  assert.doesNotMatch(create, /max_seats|max_publishers/, "no hand-written limit column list to fall behind");
  assert.match(create, /pg_advisory_xact_lock\(hashtextextended\('plan-version:'/, "version numbers are taken under a lock");

  const copy = latestDefining("create or replace function public.sa2_copy_plan_rows");
  assert.match(copy, /from pg_attribute a/);
  assert.match(copy, /a\.attname not in \('plan_id', 'created_at', 'updated_at'\)/);
  assert.match(copy, /a\.attgenerated = ''/);
});

test("fix 4: the editor's save is one transactional RPC, with the rebuild inside it", () => {
  const route = read("app/api/admin/plans/[id]/version/route.ts");
  const rpcs = [...route.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rpcs, ["admin_save_plan_version_complete"]);
  assert.doesNotMatch(route, /\.update\(\{ max_setter_seats/, "no write outside the transaction");
  assert.doesNotMatch(route, /rebuildEntitlementsForPlan/);

  const save = latestDefining("create or replace function public.admin_save_plan_version_complete");
  assert.match(save, /from public\.admin_save_plan_version\(/);
  assert.match(save, /update public\.plan_limits set %I = \$1 where plan_id = \$2/);
  assert.match(save, /insert into public\.plan_meters/);
  assert.match(save, /perform public\.refresh_tenant_entitlement\(v_tenant\)/);
});

test("fix 5: the editor names the version a publish will create, not this row + 1", () => {
  assert.equal(nextPlanVersion([1, 2, 5], 2), 6, "editing v2 while v5 exists publishes v6");
  assert.equal(nextPlanVersion([], 3), 4);
  const editor = read("components/admin/plan-version-editor.tsx");
  assert.doesNotMatch(editor, /planVersion \+ 1/);
  assert.match(editor, /Publish version \$\{nextVersion\}/);
  assert.match(read("lib/plans/versionEditor.ts"), /nextVersion: nextPlanVersion\(/);
});

test("fix 8: meters are editable on the plan version, and the change is audited", () => {
  const editor = read("components/admin/plan-version-editor.tsx");
  assert.match(editor, /Usage allowances/);
  assert.match(editor, /meters: Object\.entries\(meterDrafts\)/);
  assert.match(editor, /\["max_carriers", "Carriers"\]/, "max_carriers is editable with the other limits");
  const route = read("app/api/admin/plans/[id]/version/route.ts");
  assert.match(route, /meters: meterChanges/);
  assert.match(route, /requireAdminRole\(CAN_MANAGE_PLANS\)/, "plan design stays super_admin (Basic Idea §2.5)");

  assert.deepEqual(
    diffPlanMeters(
      [{ meter_key: "dialer_minutes", included_qty: 1000, hard_cap: true }, { meter_key: "sms_segments", included_qty: null, hard_cap: false }],
      [{ meter_key: "dialer_minutes", included_qty: 2000, hard_cap: true }, { meter_key: "dnc_lookups", included_qty: 0, hard_cap: true }],
    ),
    {
      dialer_minutes: { from: { included_qty: 1000, hard_cap: true }, to: { included_qty: 2000, hard_cap: true } },
      sms_segments: { from: { included_qty: null, hard_cap: false }, to: null },
      dnc_lookups: { from: null, to: { included_qty: 0, hard_cap: true } },
    },
  );
  assert.deepEqual(diffPlanMeters([{ meter_key: "a", included_qty: 1, hard_cap: true }], [{ meter_key: "a", included_qty: 1, hard_cap: true }]), {});
});

test("plan save refusals are 4xx with words, the unexpected is a 500", () => {
  assert.equal(planSaveErrorResponse({ message: "no_features" }).status, 400);
  assert.equal(planSaveErrorResponse({ message: "plan_not_found" }).status, 404);
  assert.equal(planSaveErrorResponse({ message: "invalid_plan_meter: dialer_minutes" }).status, 400);
  assert.equal(planSaveErrorResponse({ message: "unknown_plan_limit: max_x" }).status, 400);
  assert.equal(planSaveErrorResponse({ message: "insert or update violates foreign key", code: "23503" }).status, 400);
  assert.equal(planSaveErrorResponse({ message: "timeout" }).status, 500);
});
