// Run with: node --experimental-strip-types --test lib/creditsLimits/present.test.mjs
//
// The usage monitor's colours are claims about a customer's allowance, so the rule is pinned here:
// over is strictly past the limit, at the limit is near, and rows with no finite limit are not rows.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMonitorEntries,
  furthestOver,
  inSentence,
  isWatchable,
  limitState,
  proximity,
  tenantsOverCount,
  tenantsOverLabel,
} from "./present.ts";
import { CREDIT_METER_KEYS } from "./constants.ts";

const meter = (over) => ({
  tenant_id: "t1",
  tenant_name: "Harbor",
  tenant_status: "active",
  meter_key: "monthly_leads_imported",
  meter_label: "Leads imported this month",
  unit: "lead",
  used_qty: 10,
  included_qty: 100,
  grant_qty: 0,
  plan_included_qty: 100,
  hard_cap: true,
  percent_used: 10,
  alert_level: "ok",
  period_start: null,
  ...over,
});

test("the board's row-state rule: over is strictly past, at the limit is near", () => {
  assert.equal(limitState(10_400, 10_000, 0.8), "over");
  assert.equal(limitState(12, 12, 0.8), "near", "12 / 12 is at the limit, not over it");
  assert.equal(limitState(9_120, 10_000, 0.8), "near");
  assert.equal(limitState(31_200, 50_000, 0.8), "ok");
  assert.equal(limitState(1, 0, 0.8), "over", "any use of a zero allowance is over");
  assert.equal(limitState(0, 0, 0.8), "ok");
  assert.equal(limitState(70, 100, 0.7), "near", "the threshold is the setting, not a hard-coded 80%");
});

test("unlimited and 0-of-0 rows are left out", () => {
  assert.equal(isWatchable(5, null), false);
  assert.equal(isWatchable(0, 0), false);
  assert.equal(isWatchable(3, 0), true);
  assert.equal(isWatchable(0, 10), true);
});

test("entries sort by proximity to the limit, over first", () => {
  const entries = buildMonitorEntries(
    [
      meter({ tenant_id: "a", tenant_name: "Vantage", used_qty: 31_200, included_qty: 50_000 }),
      meter({ tenant_id: "b", tenant_name: "Harbor", used_qty: 10_400, included_qty: 10_000 }),
      meter({ tenant_id: "c", tenant_name: "Ridgeline", meter_key: "dialer_minutes", meter_label: "Dialer minutes", used_qty: 9_120, included_qty: 10_000 }),
      meter({ tenant_id: "d", tenant_name: "Unlimited Co", included_qty: null }),
    ],
    [{ tenant_id: "e", tenant_name: "Northline", tenant_status: "active", used_qty: 12, included_qty: 12 }],
    0.8,
  );
  assert.deepEqual(entries.map((e) => e.tenantName), ["Harbor", "Northline", "Ridgeline", "Vantage"]);
  assert.equal(entries[1].kind, "seats");
  assert.equal(entries[1].grantMeter, null, "seats cannot be granted as credits");
  assert.equal(entries[0].grantMeter, "monthly_leads_imported", "lead imports are grantable (user decision)");
  assert.equal(tenantsOverCount(entries), 1);
  assert.deepEqual(furthestOver(entries), { tenantName: "Harbor", over: 400, label: "leads imported this month" });
});

test("a meter credits cannot be granted on shows no grant target", () => {
  const [entry] = buildMonitorEntries([meter({ meter_key: "some_future_meter" })], [], 0.8);
  assert.equal(entry.grantMeter, null);
});

test("proximity puts a used zero allowance above everything", () => {
  assert.equal(proximity(1, 0), Number.POSITIVE_INFINITY);
  assert.ok(proximity(104, 100) > proximity(100, 100));
});

test("copy helpers", () => {
  assert.equal(inSentence("Lead imports"), "lead imports");
  assert.equal(inSentence("TCPA checks"), "TCPA checks");
  assert.equal(tenantsOverLabel(0), "No tenant over a limit");
  assert.equal(tenantsOverLabel(1), "1 tenant over its limit");
  assert.equal(tenantsOverLabel(3), "3 tenants over their limit");
  assert.equal(furthestOver([]), null);
});

test("lead imports and consent claims are grantable meters", () => {
  assert.ok(CREDIT_METER_KEYS.includes("monthly_leads_imported"));
  assert.ok(CREDIT_METER_KEYS.includes("consent_cert_claims"));
});
