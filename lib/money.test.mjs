// Run with: npm test
//
// Money is the one place a silent rounding bug is expensive, so the conversions get real tests.
// Uses Node's built-in runner — no new dependency.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseDollarsToCents,
  formatCents,
  formatCentsAsCurrency,
  availableBillingCycles,
  monthlyEquivalentCents,
} from "./money.ts";

test("parseDollarsToCents: the float-multiplication trap", () => {
  // parseFloat("449.99") * 100 === 44998.999999999996, which floors to 44998 — a cent lost on
  // every parse. These are the values that actually break.
  assert.equal(parseDollarsToCents("449.99"), 44999);
  assert.equal(parseDollarsToCents("0.29"), 29);
  assert.equal(parseDollarsToCents("1.005"), null, "3 decimals rejected, not silently rounded");
  assert.equal(parseDollarsToCents("8.87"), 887);
  assert.equal(parseDollarsToCents("19.99"), 1999);
  assert.equal(parseDollarsToCents("1234567.89"), 123456789);
});

test("parseDollarsToCents: whole numbers and formatting noise", () => {
  assert.equal(parseDollarsToCents("449"), 44900);
  assert.equal(parseDollarsToCents("$449"), 44900);
  assert.equal(parseDollarsToCents("$1,299.50"), 129950);
  assert.equal(parseDollarsToCents("  99  "), 9900);
  assert.equal(parseDollarsToCents("449."), 44900);
  assert.equal(parseDollarsToCents("0"), 0);
});

test("parseDollarsToCents: partial decimals pad correctly", () => {
  // "0.1" is ten cents, not one. Padding the wrong way is an easy off-by-10x.
  assert.equal(parseDollarsToCents("0.1"), 10);
  assert.equal(parseDollarsToCents(".5"), 50);
  assert.equal(parseDollarsToCents("2.7"), 270);
});

test("parseDollarsToCents: rejects nonsense rather than guessing", () => {
  assert.equal(parseDollarsToCents(""), null);
  assert.equal(parseDollarsToCents("   "), null);
  assert.equal(parseDollarsToCents("abc"), null);
  assert.equal(parseDollarsToCents("."), null);
  assert.equal(parseDollarsToCents("-"), null);
  assert.equal(parseDollarsToCents("12.34.56"), null);
  assert.equal(parseDollarsToCents("1e5"), null);
});

test("formatCents round-trips with parseDollarsToCents", () => {
  for (const cents of [0, 1, 10, 99, 100, 4999, 44999, 129950, 123456789]) {
    assert.equal(
      parseDollarsToCents(formatCents(cents)),
      cents,
      `round trip failed for ${cents}`,
    );
  }
});

test("formatCents pads the cents half", () => {
  assert.equal(formatCents(5), "0.05", "5 cents is not 0.5 dollars");
  assert.equal(formatCents(50), "0.50");
  assert.equal(formatCents(100), "1.00");
  assert.equal(formatCents(44999), "449.99");
  assert.equal(formatCents(0), "0.00");
});

test("formatCentsAsCurrency", () => {
  assert.equal(formatCentsAsCurrency(44999), "$449.99");
  assert.equal(formatCentsAsCurrency(129950), "$1,299.50");
  assert.equal(formatCentsAsCurrency(0), "$0.00");
  assert.equal(formatCentsAsCurrency(5), "$0.05");
});

test("availableBillingCycles: a null price means that cycle isn't offered", () => {
  const base = { setup_fee_cents: 0, trial_days: 14, currency: "USD" };

  assert.deepEqual(
    availableBillingCycles({
      ...base,
      price_monthly_cents: 9900,
      price_quarterly_cents: null,
      price_yearly_cents: null,
    }),
    ["monthly"],
    "monthly-only plan must offer only monthly",
  );

  assert.deepEqual(
    availableBillingCycles({
      ...base,
      price_monthly_cents: 9900,
      price_quarterly_cents: 27000,
      price_yearly_cents: 99000,
    }),
    ["monthly", "quarterly", "yearly"],
  );

  // A free plan is priced at zero, which is NOT the same as "not offered".
  assert.deepEqual(
    availableBillingCycles({
      ...base,
      price_monthly_cents: 0,
      price_quarterly_cents: null,
      price_yearly_cents: null,
    }),
    ["monthly"],
    "zero is a price, null is an absence",
  );

  assert.deepEqual(availableBillingCycles(null), []);
});

test("monthlyEquivalentCents is display-only and does not round-trip", () => {
  assert.equal(monthlyEquivalentCents(9900, "monthly"), 9900);
  assert.equal(monthlyEquivalentCents(27000, "quarterly"), 9000);
  assert.equal(monthlyEquivalentCents(99000, "yearly"), 8250);

  // 44900/12 = 3741.66… -> 3742. Twelve of those is 44904, not 44900. This is exactly why the
  // helper is documented as display-only and nothing bills from it.
  const perMonth = monthlyEquivalentCents(44900, "yearly");
  assert.equal(perMonth, 3742);
  assert.notEqual(perMonth * 12, 44900, "rounded per-month figures must not be used to bill");
});
