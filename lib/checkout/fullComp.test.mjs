import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isFullComp } from "../coupons/discount.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("only 100% off forever is a full comp", () => {
  assert.equal(isFullComp({ discountType: "percent", percentOff: 100, duration: "forever" }), true);
  assert.equal(isFullComp({ discountType: "percent", percentOff: 100, duration: "once" }), false, "the price comes back after one period");
  assert.equal(isFullComp({ discountType: "percent", percentOff: 100, duration: "n_periods" }), false);
  assert.equal(isFullComp({ discountType: "percent", percentOff: 99, duration: "forever" }), false);
  assert.equal(isFullComp({ discountType: "fixed", percentOff: null, duration: "forever" }), false, "a fixed amount can be smaller than a later price");
});

test("checkout starts a full-comp plan before it ever reaches the payment provider", () => {
  const start = read("lib/checkout/start.ts");
  const comp = start.indexOf("if (isFullComp(check.terms))");
  assert.ok(comp > 0, "startCheckout checks for a full comp");
  for (const later of ["checkoutPaymentMode() === \"none\"", "from(\"checkout_sessions\")", "ensureWhopPlan(", "buildProvider(", "createCheckoutSession("]) {
    assert.ok(start.indexOf(later) > comp, `${later} comes after the full-comp return`);
  }
  assert.match(start.slice(comp, comp + 600), /return \{ checkoutUrl: NO_PAYMENT_LANDING/);
});

test("a full comp sets manual billing, records the comp and never imports the provider", () => {
  const comp = read("lib/checkout/fullComp.ts");
  assert.match(comp, /completeWithoutPayment\(tenantId, plan, billingCycle\)/);
  assert.match(comp, /rpc\("record_coupon_comp", \{ p_tenant_id: tenantId, p_coupon_id: coupon\.id \}\)/);
  assert.doesNotMatch(comp, /from "@\/lib\/payments|buildProvider\(|WhopProvider|createCheckoutSession/, "no provider is reachable from the comp path");
  assert.match(read("lib/checkout/noPayment.ts"), /update\(\{ billing_mode: "manual" \}\)/);
});

test("the period billing run raises nothing for a comped tenant", () => {
  const gather = read("lib/billing/gather.ts");
  assert.match(gather, /isComped\(supabase, subscription\.tenant_id\)/);
  assert.match(gather, /const assembled = comped\s+\? \{ lines: \[\], pendingIds: \[\], creditAppliedCents: 0, waiverIds: \[\]/);
});

test("a full-comp coupon is never created at Whop, and a typed code is never dropped at checkout", () => {
  assert.match(read("lib/coupons/service.ts"), /if \(isFullComp\(input\)\) return insertCoupon\(input, null\);/);
  assert.match(read("components/public/checkout-start.tsx"), /couponCode: valid\?\.code \?\? \(couponCode\.trim\(\) \|\| undefined\)/);
});
