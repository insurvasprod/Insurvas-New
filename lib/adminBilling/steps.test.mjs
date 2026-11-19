import test from "node:test";
import assert from "node:assert/strict";

import { billingFootFor, billingStepsFor } from "./steps.ts";

const keys = (role) => billingStepsFor(role).map((step) => step.key);

test("a super admin gets every Billing step and Payment provider at the foot", () => {
  assert.deepEqual(keys("super_admin"), ["workspace", "subscriptions", "trials", "failed", "invoices", "refunds", "reconciliation", "coupons", "offers", "credits", "revenue"]);
  assert.equal(billingFootFor("super_admin")?.href, "/admin/payments");
});

test("billing ops gets neither Credits & limits nor Payment provider (as before the merge)", () => {
  const steps = keys("billing_admin");
  assert.ok(!steps.includes("credits"));
  assert.ok(steps.includes("workspace") && steps.includes("reconciliation"));
  assert.equal(billingFootFor("billing_admin"), null);
});

test("platform config gets only Credits & limits; support gets no Billing", () => {
  assert.deepEqual(keys("platform_config"), ["credits"]);
  assert.deepEqual(keys("support_agent"), []);
});
