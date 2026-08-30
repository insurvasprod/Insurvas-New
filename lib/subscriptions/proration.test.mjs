// Run with: npm test
//
// SA-3.4's acceptance criterion is a single exact number, so it gets an exact test.
import { test } from "node:test";
import assert from "node:assert/strict";

import { prorate, daysElapsedBetween, periodLengthInDays } from "./proration.ts";

test("the ticket's worked example produces exactly $122.58", () => {
  // Basic $249 billed on the 14th, upgraded to Advanced $449 on day 12 of a 31-day period.
  const result = prorate({
    oldPriceCents: 24900,
    newPriceCents: 44900,
    periodDays: 31,
    daysElapsed: 12,
  });

  assert.equal(result.remainingDays, 19);
  assert.equal(result.creditCents, 15261, "credit should be $152.61");
  assert.equal(result.chargeCents, 27519, "charge should be $275.19");
  assert.equal(result.netCents, 12258, "net should be $122.58");
});

test("each side is rounded before netting, so the lines add up on the document", () => {
  const { creditCents, chargeCents, netCents } = prorate({
    oldPriceCents: 24900,
    newPriceCents: 44900,
    periodDays: 31,
    daysElapsed: 12,
  });

  // Netting first and rounding once gives 12258 here too, but not always — and a total its own
  // two lines do not sum to is something the customer can see.
  assert.equal(chargeCents - creditCents, netCents);
});

test("a change on the last day prorates nothing", () => {
  const result = prorate({ oldPriceCents: 24900, newPriceCents: 44900, periodDays: 31, daysElapsed: 31 });

  assert.equal(result.remainingDays, 0);
  assert.equal(result.netCents, 0);
});

test("a change past the end of the period cannot invert the credit", () => {
  // Clock skew or a late-processed event must not turn a credit into a charge.
  const result = prorate({ oldPriceCents: 24900, newPriceCents: 44900, periodDays: 31, daysElapsed: 45 });

  assert.equal(result.remainingDays, 0);
  assert.equal(result.creditCents, 0);
  assert.equal(result.chargeCents, 0);
});

test("a change on day zero prorates the whole period", () => {
  const result = prorate({ oldPriceCents: 24900, newPriceCents: 44900, periodDays: 31, daysElapsed: 0 });

  assert.equal(result.remainingDays, 31);
  assert.equal(result.creditCents, 24900);
  assert.equal(result.chargeCents, 44900);
  assert.equal(result.netCents, 20000);
});

test("a downgrade produces a negative net, which the caller must not charge", () => {
  const result = prorate({ oldPriceCents: 44900, newPriceCents: 24900, periodDays: 31, daysElapsed: 12 });

  assert.equal(result.netCents, -12258);
  // Downgrades apply at period end with no refund; the arithmetic is reported, not acted on.
  assert.ok(result.netCents < 0);
});

test("prices must be integer cents, not dollars", () => {
  assert.throws(() => prorate({ oldPriceCents: 249.0, newPriceCents: 449.5, periodDays: 31, daysElapsed: 12 }));
});

test("a zero-length period is refused rather than dividing by zero", () => {
  assert.throws(() => prorate({ oldPriceCents: 100, newPriceCents: 200, periodDays: 0, daysElapsed: 0 }));
});

test("yearly periods prorate too", () => {
  // 365-day period, changed halfway.
  const result = prorate({ oldPriceCents: 249000, newPriceCents: 449000, periodDays: 365, daysElapsed: 182 });

  assert.equal(result.remainingDays, 183);
  assert.equal(result.creditCents, Math.round((249000 * 183) / 365));
  assert.equal(result.chargeCents, Math.round((449000 * 183) / 365));
});

test("elapsed days floor, so a part-day is not billed", () => {
  const start = new Date("2026-08-14T00:00:00Z");
  const elevenAndAHalf = new Date("2026-08-25T12:00:00Z");

  assert.equal(daysElapsedBetween(start, elevenAndAHalf), 11);
});

test("elapsed days never go negative", () => {
  const start = new Date("2026-08-14T00:00:00Z");
  const before = new Date("2026-08-01T00:00:00Z");

  assert.equal(daysElapsedBetween(start, before), 0);
});

test("period length is measured, not assumed to be 30", () => {
  // The example's 31 days is exactly why: a month billed on the 14th of August is 31 days.
  assert.equal(
    periodLengthInDays(new Date("2026-08-14T00:00:00Z"), new Date("2026-09-14T00:00:00Z")),
    31,
  );
  assert.equal(
    periodLengthInDays(new Date("2026-02-14T00:00:00Z"), new Date("2026-03-14T00:00:00Z")),
    28,
  );
});
