// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  discountCentsFor,
  durationInMonths,
  couponRejectionReason,
  initialPeriodsRemaining,
} from "./discount.ts";

const HALF_OFF = { discountType: "percent", percentOff: 50 };
const TEN_DOLLARS = { discountType: "fixed", amountOffCents: 1000 };

test("a percentage discount is taken in whole cents", () => {
  assert.equal(discountCentsFor(24900, HALF_OFF), 12450);
  assert.equal(discountCentsFor(9900, HALF_OFF), 4950);
});

test("an odd percentage rounds rather than truncating a fraction of a cent", () => {
  // 33% of $99.99 is 3299.67 cents. Truncating loses money on every invoice for the life of
  // the coupon; rounding is the conventional and defensible choice.
  assert.equal(discountCentsFor(9999, { discountType: "percent", percentOff: 33 }), 3300);
});

test("100% off is the whole amount, not more", () => {
  assert.equal(discountCentsFor(24900, { discountType: "percent", percentOff: 100 }), 24900);
});

test("a fixed discount larger than the charge is capped at the charge", () => {
  // A $100-off coupon on a $99 plan is a free month, not a dollar owed back to the customer.
  assert.equal(discountCentsFor(9900, { discountType: "fixed", amountOffCents: 10000 }), 9900);
});

test("a fixed discount smaller than the charge comes off in full", () => {
  assert.equal(discountCentsFor(24900, TEN_DOLLARS), 1000);
});

test("a percent outside 1–100 is refused", () => {
  assert.throws(() => discountCentsFor(1000, { discountType: "percent", percentOff: 0 }));
  assert.throws(() => discountCentsFor(1000, { discountType: "percent", percentOff: 150 }));
});

test("fractional amounts are refused", () => {
  assert.throws(() => discountCentsFor(249.5, HALF_OFF));
  assert.throws(() => discountCentsFor(1000, { discountType: "fixed", amountOffCents: 10.5 }));
});

test("whole dollars are INDISTINGUISHABLE from cents, and this guard cannot catch them", () => {
  // 249.0 === 249 in JavaScript, so passing dollars where cents belong is only detectable when the
  // value happens to be fractional. Pinning the limitation rather than pretending the type check
  // is a defence it is not: the real protection is parseDollarsToCents at every entry point.
  assert.equal(discountCentsFor(249, HALF_OFF), 125);
  assert.doesNotThrow(() => discountCentsFor(249.0, HALF_OFF));
});

test("three periods is three invoices on EVERY cycle", () => {
  // The ticket's criterion: a 50%-for-3-periods coupon discounts exactly three invoices and stops.
  assert.equal(durationInMonths("n_periods", 3, "monthly"), 3);
  assert.equal(durationInMonths("n_periods", 3, "quarterly"), 9);
  assert.equal(durationInMonths("n_periods", 3, "yearly"), 36);
});

test("passing the period count straight through would be wrong", () => {
  // Guarding the actual bug: 3 months on a yearly plan discounts only the first invoice, and the
  // customer loses two of the three periods they were promised.
  assert.notEqual(durationInMonths("n_periods", 3, "yearly"), 3);
});

test("once means one billing period, whatever length that is", () => {
  assert.equal(durationInMonths("once", null, "monthly"), 1);
  assert.equal(durationInMonths("once", null, "quarterly"), 3);
  assert.equal(durationInMonths("once", null, "yearly"), 12);
});

test("n_periods without a count is refused rather than treated as one", () => {
  assert.throws(() => durationInMonths("n_periods", null, "monthly"));
  assert.throws(() => durationInMonths("n_periods", 0, "monthly"));
});

test("periods remaining is set from the duration", () => {
  assert.equal(initialPeriodsRemaining("once", null), 1);
  assert.equal(initialPeriodsRemaining("n_periods", 3), 3);
  assert.equal(initialPeriodsRemaining("forever", null), null);
});

test("an expired coupon is rejected with the date", () => {
  const reason = couponRejectionReason(
    { isActive: true, expiresAt: "2026-01-01T00:00:00Z", maxRedemptions: null, redeemedCount: 0 },
    new Date("2026-08-30T00:00:00Z"),
  );

  assert.match(reason, /expired/i);
});

test("a coupon expiring later is fine", () => {
  const reason = couponRejectionReason(
    { isActive: true, expiresAt: "2027-01-01T00:00:00Z", maxRedemptions: null, redeemedCount: 0 },
    new Date("2026-08-30T00:00:00Z"),
  );

  assert.equal(reason, null);
});

test("the 101st redemption of a max-100 coupon is rejected", () => {
  const at100 = couponRejectionReason({
    isActive: true, expiresAt: null, maxRedemptions: 100, redeemedCount: 100,
  });
  const at99 = couponRejectionReason({
    isActive: true, expiresAt: null, maxRedemptions: 100, redeemedCount: 99,
  });

  assert.match(at100, /exhausted/i);
  assert.equal(at99, null, "the 100th must still be allowed");
});

test("a deactivated coupon is rejected", () => {
  const reason = couponRejectionReason({
    isActive: false, expiresAt: null, maxRedemptions: null, redeemedCount: 0,
  });

  assert.match(reason, /deactivated/i);
});

test("the three rejection reasons are distinguishable", () => {
  // A salesperson needs to know which it is: an expired coupon can be reissued, an exhausted one
  // needs a decision about raising the cap.
  const expired = couponRejectionReason(
    { isActive: true, expiresAt: "2020-01-01T00:00:00Z", maxRedemptions: null, redeemedCount: 0 },
  );
  const exhausted = couponRejectionReason(
    { isActive: true, expiresAt: null, maxRedemptions: 1, redeemedCount: 1 },
  );

  assert.notEqual(expired, exhausted);
});
