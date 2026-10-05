// LA-4.10 · plan display names: the blob's plan_name wins, the tidied code is the fallback, and the
// migration renames for display only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { planDisplayName } = await import("./display.ts");
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the entitlement's plan name is shown; a blob without one tidies the code", () => {
  assert.equal(planDisplayName("basic", "Ledger"), "Ledger");
  assert.equal(planDisplayName("advance", "  Advanced "), "Advanced");
  assert.equal(planDisplayName("plan_c"), "Plan C", "a blob computed before 20261003100000");
  assert.equal(planDisplayName("plan_c", ""), "Plan C");
  assert.equal(planDisplayName(null), "No plan");
});

test("the migration renames plans.name only, patches the live function once, and refreshes on rename", () => {
  const sql = read("supabase/migrations/20261003100000_la_4_10_plan_display_names.sql");
  for (const [code, name] of [["basic", "Ledger"], ["pro", "Basic"], ["advance", "Advanced"]]) {
    assert.match(sql, new RegExp(`update public\\.plans set name = '${name}' +where code = '${code}'`));
  }
  assert.doesNotMatch(sql, /set code\b/i, "plans.code never changes");
  assert.match(sql, /replace\(pg_get_functiondef\('public\.refresh_tenant_entitlement\(uuid\)'::regprocedure\), E'\\r\\n', E'\\n'\)/, "CRLF from the SQL editor is normalised");
  assert.match(sql, /if v_count <> 1 then\s+raise exception/, "the anchor must occur exactly once");
  assert.match(sql, /after update of name on public\.plans/);
  assert.match(sql, /exception when others then\s+raise warning/, "a failed refresh never fails a rename");
  assert.doesNotMatch(sql, /set_config|\bset (local )?app\./i, "no session settings on the pooler");
  // Both places the agent app names the plan pass the blob's name.
  assert.match(read("app/app/(shell)/layout.tsx"), /planDisplayName\(entitlement\.plan_code, entitlement\.plan_name\)/);
  assert.match(read("components/app/feature-gate-notice.tsx"), /planName=\{guard\.entitlement\.plan_name\}/);
});
