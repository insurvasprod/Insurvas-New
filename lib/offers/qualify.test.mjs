import { test } from "node:test";
import assert from "node:assert/strict";

import { customerContexts, qualifiesNow, whoQualifies } from "./qualify.ts";

const now = new Date("2026-11-17T12:00:00Z");
const offer = (over = {}) => ({
  id: "o1", name: "Welcome", is_active: true, starts_at: null, ends_at: null, max_redemptions: null, redeemed_count: 0,
  eligible_plan_types: [], eligible_plan_ids: [], new_customers_only: false, existing_customers_only: false, eligible_cycles: [], ...over,
});
const customer = (over = {}) => ({ subscriptionId: "s1", tenantId: "t1", tenantName: "Acme", planName: "Basic", planType: "individual", planId: "p1", billingCycle: "monthly", isNewCustomer: true, ...over });

test("an offer that is off, not started, ended or used up qualifies nobody", () => {
  assert.equal(qualifiesNow(offer(), customer(), now), true);
  assert.equal(qualifiesNow(offer({ is_active: false }), customer(), now), false);
  assert.equal(qualifiesNow(offer({ starts_at: "2026-12-01T00:00:00Z" }), customer(), now), false);
  assert.equal(qualifiesNow(offer({ ends_at: "2026-11-01T00:00:00Z" }), customer(), now), false);
  assert.equal(qualifiesNow(offer({ max_redemptions: 3, redeemed_count: 3 }), customer(), now), false);
});

test("the rules decide: plan type, cycle, new or existing", () => {
  assert.equal(qualifiesNow(offer({ eligible_plan_types: ["agency_no_teams"] }), customer(), now), false);
  assert.equal(qualifiesNow(offer({ eligible_cycles: ["yearly"] }), customer(), now), false);
  assert.equal(qualifiesNow(offer({ existing_customers_only: true }), customer(), now), false);
});

test("who qualifies names the other offers they also qualify for, overlaps first", () => {
  const a = offer({ id: "a", name: "Welcome" });
  const b = offer({ id: "b", name: "Agency switch", eligible_plan_types: ["agency_no_teams"] });
  const rows = whoQualifies(a, [a, b], [customer({ subscriptionId: "s1", tenantName: "Zed" }), customer({ subscriptionId: "s2", tenantName: "Ann", planType: "agency_no_teams" })], now);
  assert.deepEqual(rows.map((r) => [r.customer.tenantName, r.alsoQualifiesFor]), [["Ann", ["Agency switch"]], ["Zed", []]]);
});

test("a tenant's later subscription is not a new customer, and cancelled ones are left out", () => {
  const subs = [
    { id: "s1", tenant_id: "t1", tenant_name: "Acme", plan_id: "p1", plan_name: "Basic", billing_cycle: "monthly", status: "cancelled", started_at: "2026-01-01" },
    { id: "s2", tenant_id: "t1", tenant_name: "Acme", plan_id: "p1", plan_name: "Basic", billing_cycle: "monthly", status: "active", started_at: "2026-06-01" },
    { id: "s3", tenant_id: "t2", tenant_name: "Bee", plan_id: "p1", plan_name: "Basic", billing_cycle: "monthly", status: "active", started_at: "2026-06-01" },
  ];
  const out = customerContexts(subs, () => "individual");
  assert.deepEqual(out.map((c) => [c.subscriptionId, c.isNewCustomer]), [["s2", false], ["s3", true]]);
});
