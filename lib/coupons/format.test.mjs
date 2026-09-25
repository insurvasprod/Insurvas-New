// Run with: node --experimental-strip-types --test lib/coupons/format.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeDiscount,
  describeDuration,
  describeRedemptions,
  describeRestrictions,
  endOfUtcDay,
  expiresSoon,
  matchesExpiry,
  sortActiveFirst,
  statusOf,
  utcDay,
  utcDayTime,
} from "./format.ts";

const NOW = new Date("2026-09-24T12:00:00Z");

function coupon(over = {}) {
  return {
    id: "c",
    code: "C",
    discount_type: "percent",
    percent_off: 20,
    amount_off_cents: null,
    duration: "n_periods",
    duration_periods: 3,
    billing_cycle: "monthly",
    max_redemptions: 1000,
    redeemed_count: 412,
    expires_at: null,
    restricted_to_plan_ids: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const PLANS = new Map([
  ["g", { id: "g", name: "Growth", version: 2, latest: true }],
  ["s", { id: "s", name: "Scale", version: 1, latest: true }],
  ["old", { id: "old", name: "Growth", version: 1, latest: false }],
]);

test("a discount always says whether it is a percentage or a fixed amount", () => {
  assert.equal(describeDiscount(coupon()), "20% off");
  assert.equal(describeDiscount(coupon({ discount_type: "fixed", percent_off: null, amount_off_cents: 5000 })), "$50.00 off");
});

test("an unlimited cap is ∞, never a blank", () => {
  assert.equal(describeRedemptions(38, null), "38 / ∞");
  assert.equal(describeRedemptions(412, 1000), "412 / 1,000");
});

test("duration reads in the cycle's own unit", () => {
  assert.equal(describeDuration(coupon()), "First 3 months");
  assert.equal(describeDuration(coupon({ billing_cycle: "yearly", duration_periods: 1 })), "First year");
  assert.equal(describeDuration(coupon({ duration: "once", duration_periods: null })), "First invoice");
  assert.equal(describeDuration(coupon({ duration: "forever", duration_periods: null })), "Recurring");
});

test("restrictions always state the cycle, and name plans", () => {
  assert.equal(describeRestrictions(coupon({ restricted_to_plan_ids: ["g", "s"] }), PLANS), "First 3 months · monthly only · Growth, Scale");
  assert.equal(
    describeRestrictions(coupon({ duration: "forever", duration_periods: null, billing_cycle: null, restricted_to_plan_ids: ["s"] }), PLANS),
    "Recurring · any cycle · Scale only",
  );
  assert.equal(describeRestrictions(coupon({ duration: "once", duration_periods: null }), PLANS), "First invoice · monthly only · any plan");
});

test("a coupon pinned to an old plan version says which version", () => {
  assert.equal(describeRestrictions(coupon({ restricted_to_plan_ids: ["old"] }), PLANS), "First 3 months · monthly only · Growth v1 only");
});

test("unknown or unreadable plans are counted, not guessed", () => {
  assert.equal(describeRestrictions(coupon({ restricted_to_plan_ids: ["g", "gone"] }), PLANS), "First 3 months · monthly only · Growth, 1 removed plan");
  assert.equal(describeRestrictions(coupon({ restricted_to_plan_ids: ["g", "s"] }), null), "First 3 months · monthly only · 2 plans only");
});

test("status follows the apply RPC's precedence", () => {
  assert.equal(statusOf(coupon(), NOW), "active");
  assert.equal(statusOf(coupon({ redeemed_count: 1000 }), NOW), "exhausted");
  assert.equal(statusOf(coupon({ expires_at: "2026-06-01T00:00:00Z", redeemed_count: 1000 }), NOW), "expired");
  assert.equal(statusOf(coupon({ is_active: false, expires_at: "2026-06-01T00:00:00Z" }), NOW), "deactivated");
});

test("active coupons sort first, then newest", () => {
  const rows = [
    coupon({ id: "old-active", created_at: "2026-01-01T00:00:00Z" }),
    coupon({ id: "new-spent", created_at: "2026-09-20T00:00:00Z", redeemed_count: 1000 }),
    coupon({ id: "new-active", created_at: "2026-09-10T00:00:00Z" }),
  ];
  assert.deepEqual(sortActiveFirst(rows, NOW).map((r) => r.id), ["new-active", "old-active", "new-spent"]);
});

test("expiring soon means usable now and ending inside 30 days", () => {
  assert.equal(expiresSoon(coupon({ expires_at: "2026-10-10T00:00:00Z" }), NOW), true);
  assert.equal(expiresSoon(coupon({ expires_at: "2026-12-31T00:00:00Z" }), NOW), false);
  assert.equal(expiresSoon(coupon({ expires_at: "2026-09-01T00:00:00Z" }), NOW), false, "already expired");
  assert.equal(expiresSoon(coupon({ expires_at: "2026-10-10T00:00:00Z", is_active: false }), NOW), false);
  assert.equal(matchesExpiry(coupon(), "none", NOW), true);
  assert.equal(matchesExpiry(coupon(), "dated", NOW), false);
});

test("dates print in UTC", () => {
  assert.equal(utcDay("2026-12-31T23:59:59Z"), "31 Dec 2026");
  assert.equal(utcDayTime("2026-12-31T23:59:59Z"), "31 Dec 2026 23:59:59 UTC");
});

test("a picked date expires at the last second of that UTC day", () => {
  assert.equal(endOfUtcDay("2026-12-31"), "2026-12-31T23:59:59.000Z");
  assert.equal(endOfUtcDay("2026-02-30"), null);
  assert.equal(endOfUtcDay("31/12/2026"), null);
});
