import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createTenantSchema } from "./schemas.ts";
import { billingModeFor } from "./createOptions.ts";

const PLAN = "8b0f2a8e-4d5f-4c43-9b1e-1f7f8f0c1a11";
const base = { tenantName: "Okafor Financial", ownerName: "Sandra Okafor", ownerEmail: "Sandra@OkaforFin.com", planId: PLAN };
const parse = (extra) => createTenantSchema.safeParse({ ...base, ...extra });

test("a plan and a billing choice are required", () => {
  assert.equal(createTenantSchema.safeParse({ ...base, planId: undefined, billing: "card" }).success, false);
  assert.equal(parse({}).success, false);
  const ok = parse({ billing: "card" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.ownerEmail, "sandra@okaforfin.com");
});

test("comped needs a reason of at least 5 characters and has no trial", () => {
  assert.equal(parse({ billing: "comped" }).success, false);
  assert.equal(parse({ billing: "comped", compReason: "free" }).success, false);
  assert.equal(parse({ billing: "comped", compReason: "Founding partner" }).success, true);
  assert.equal(parse({ billing: "comped", compReason: "Founding partner", trialDays: 14 }).success, false);
  assert.equal(parse({ billing: "comped", compReason: "Founding partner", trialDays: 0 }).success, true);
});

test("a reason is refused on a card or manual tenant", () => {
  assert.equal(parse({ billing: "card", compReason: "Founding partner" }).success, false);
  assert.equal(parse({ billing: "manual", compReason: "" }).success, true);
});

test("trial days: null keeps the plan's, 0 starts billing now, 1-90 overrides, beyond is refused", () => {
  for (const trialDays of [null, undefined, 0, 1, 14, 90]) assert.equal(parse({ billing: "card", trialDays }).success, true, String(trialDays));
  for (const trialDays of [-1, 91, 2.5]) assert.equal(parse({ billing: "manual", trialDays }).success, false, String(trialDays));
});

test("card is automatic billing; manual and comped never charge automatically", () => {
  assert.equal(billingModeFor("card"), "automatic");
  assert.equal(billingModeFor("manual"), "manual");
  assert.equal(billingModeFor("comped"), "manual");
});

test("the route provisions through admin_create_tenant_with_billing with every choice", async () => {
  const route = await readFile(new URL("../../app/api/admin/tenants/route.ts", import.meta.url), "utf8");
  assert.match(route, /"admin_create_tenant_with_billing"/);
  for (const arg of ["p_plan_id: planId", "p_billing: billing", "p_comp_reason:", "p_trial_days:"]) assert.ok(route.includes(arg), arg);
  assert.doesNotMatch(route, /rpc\("admin_attach_user_to_tenant"/);
});

test("the migration records comps in a write-guarded table that the report reads", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/20261015530000_sa_admin_plane_audit_fixes.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke insert, update, delete, truncate on table public\.tenant_comps from service_role;/);
  assert.match(sql, /constraint tenant_comps_reason_check check \(char_length\(btrim\(reason\)\) between 5 and 500\)/);
  const report = await readFile(new URL("./comps.ts", import.meta.url), "utf8");
  assert.match(report, /\.from\("tenant_comps" as never\)/);
  assert.match(report, /\.is\("ended_at" as never, null\)/);
});
