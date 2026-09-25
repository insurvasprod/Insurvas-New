// Run with: node --experimental-strip-types --test lib/coupons/deactivate.test.mjs
//
// Deactivation must fail closed: the local row changes only after Whop has confirmed the promo
// code is off. Driven with a fake provider — nothing here reaches Whop or the database.
import { test } from "node:test";
import assert from "node:assert/strict";

import { deactivateCouponWith } from "./deactivate.ts";

const COUPON = { id: "c1", code: "LAUNCH20", is_active: true, whop_promo_code_id: "promo_1" };

function harness({ coupon = COUPON, promo = undefined, markInactive = true } = {}) {
  const calls = { deactivate: 0, read: 0, marked: 0 };
  const fake =
    promo === null
      ? null
      : {
          async deactivatePromoCode(id) {
            calls.deactivate++;
            assert.equal(id, "promo_1");
            if (promo?.deactivate instanceof Error) throw promo.deactivate;
            return { status: promo?.deactivate ?? "inactive" };
          },
          async getPromoCodeStatus() {
            calls.read++;
            if (promo?.read instanceof Error) throw promo.read;
            return promo?.read ?? "active";
          },
        };
  const deps = {
    loadCoupon: async () => coupon,
    promoCodes: () => fake,
    markInactive: async () => {
      calls.marked++;
      return markInactive;
    },
  };
  return { deps, calls };
}

test("Whop confirms, then the row is marked inactive", async () => {
  const { deps, calls } = harness();
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "deactivated");
  assert.equal(outcome.providerStatus, "inactive");
  assert.equal(outcome.confirmedByRead, false);
  assert.deepEqual(calls, { deactivate: 1, read: 0, marked: 1 });
});

test("Whop refusing leaves the row untouched", async () => {
  const { deps, calls } = harness({ promo: { deactivate: new Error("Whop POST failed with 500"), read: "active" } });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "provider_refused");
  assert.match(outcome.message, /500/);
  assert.equal(calls.marked, 0);
});

test("a timeout with no answer to the read either leaves the row untouched", async () => {
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const { deps, calls } = harness({ promo: { deactivate: timeout, read: new Error("still down") } });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "provider_refused");
  assert.equal(calls.marked, 0);
});

test("a failed call is not a refusal when a read shows the code is already off", async () => {
  // The first attempt landed but its answer was lost, or someone switched it off in Whop's dashboard.
  const { deps, calls } = harness({ promo: { deactivate: new Error("timeout"), read: "archived" } });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "deactivated");
  assert.equal(outcome.confirmedByRead, true);
  assert.equal(outcome.providerStatus, "archived");
  assert.equal(calls.marked, 1);
});

test("a 200 that still reports the code active is not a confirmation", async () => {
  const { deps, calls } = harness({ promo: { deactivate: "active" } });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "provider_refused");
  assert.equal(calls.marked, 0);
});

test("no Whop configured means nothing changes", async () => {
  const { deps, calls } = harness({ promo: null });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "provider_not_configured");
  assert.equal(calls.marked, 0);
});

test("a coupon with no Whop promo code is deactivated locally without calling Whop", async () => {
  const { deps, calls } = harness({ coupon: { ...COUPON, whop_promo_code_id: null }, promo: null });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "deactivated");
  assert.equal(outcome.whopPromoCodeId, null);
  assert.deepEqual(calls, { deactivate: 0, read: 0, marked: 1 });
});

test("deactivating twice does not call Whop the second time", async () => {
  const { deps, calls } = harness({ coupon: { ...COUPON, is_active: false } });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "already_inactive");
  assert.equal(calls.deactivate, 0);
});

test("an unknown coupon is not found", async () => {
  const { deps } = harness({ coupon: null });
  assert.equal((await deactivateCouponWith(deps, "nope")).kind, "not_found");
});

test("Whop off but the local write failing is reported, not hidden", async () => {
  const { deps } = harness({ markInactive: false });
  const outcome = await deactivateCouponWith(deps, "c1");
  assert.equal(outcome.kind, "local_write_failed");
  assert.equal(outcome.whopPromoCodeId, "promo_1");
});
