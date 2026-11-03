// Run with: node --experimental-strip-types --test lib/billing/overageAllowance.test.mjs
//
// Overage is billed from admin_usage_monitor's included_qty (gather.ts fetchUsage). The user's rule
// (2026-09-25): that allowance is the one enforcement uses — plan row or platform default, plus
// attached add-on credits, plus the period's grants. The live definition is the last migration to
// define the function, so that is the one read here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const SIGNATURE = "create or replace function public.admin_usage_monitor(";

function latestBody() {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .find((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(SIGNATURE));
  assert.ok(file, "no migration defines admin_usage_monitor");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(SIGNATURE);
  return sql.slice(start, sql.indexOf("$$;", start));
}

test("the overage allowance counts attached add-on credits, as enforcement does", () => {
  const body = latestBody();
  assert.match(body, /addon_meters/, "add-on credits must reach the billed allowance");
  assert.match(body, /detached_at is null/, "a detached add-on must stop counting");
  assert.match(body, /'trialing', 'active', 'past_due', 'cancelling'/, "add-ons come from the subscription enforcement picks");
  assert.match(body, /base_included \+ v\.addon_qty \+ v\.grant_qty/, "plan/default + add-ons + grants");
});

test("an unlimited base stays unlimited and no plan means no finite allowance", () => {
  const body = latestBody();
  assert.match(body, /when v\.base_included is null then null::integer/);
  assert.match(body, /when g\.plan_id is null then null::integer/);
  assert.match(body, /when pm\.meter_key is not null then pm\.included_qty\s+else mp\.default_included/, "a plan row, even NULL, beats the platform default");
});

test("the columns billing reads are still returned", () => {
  const body = latestBody();
  for (const column of ["tenant_id uuid", "meter_key text", "meter_label text", "unit text", "used_qty integer", "included_qty integer", "hard_cap boolean", "period_start timestamptz"]) {
    assert.ok(body.includes(column), `admin_usage_monitor lost ${column}`);
  }
});
