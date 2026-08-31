// Run with: npm test
//
// #44's whole point is that money now reaches a customer's invoice without a human in the loop.
// Every rule that decides an amount gets a test, and the ones that decide NOT to bill get tests
// too — a missing overage line is as expensive a bug as a wrong one, and much quieter.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  overageLines,
  addonLines,
  pendingChargeLines,
  creditApplied,
  creditLine,
  assemblePeriodInvoice,
} from "./lines.ts";

const meter = (over) => ({
  meterKey: "dials",
  label: "Dials",
  unit: "dials",
  usedQty: 1000 + over,
  includedQty: 1000,
  hardCap: false,
});

// ── overage ──────────────────────────────────────────────────────────────────

test("overage bills only the units above the allowance", () => {
  const [line] = overageLines([meter(250)], [{ meterKey: "dials", sellCents: 3 }]);
  assert.equal(line.quantity, 250);
  assert.equal(line.unit_cents, 3);
  assert.equal(line.amount_cents, 750);
  assert.equal(line.included_qty, 1000);
  assert.equal(line.kind, "overage");
});

test("usage exactly at the allowance produces nothing", () => {
  assert.deepEqual(overageLines([meter(0)], [{ meterKey: "dials", sellCents: 3 }]), []);
});

test("an unlimited allowance can never produce overage", () => {
  const unlimited = { ...meter(500), includedQty: null };
  assert.deepEqual(overageLines([unlimited], [{ meterKey: "dials", sellCents: 3 }]), []);
});

test("a hard-capped meter produces no overage, because the usage was refused at the door", () => {
  const capped = { ...meter(500), hardCap: true };
  assert.deepEqual(overageLines([capped], [{ meterKey: "dials", sellCents: 3 }]), []);
});

test("an unpriced meter is not billed rather than billed at zero or at a guess", () => {
  assert.deepEqual(overageLines([meter(500)], []), []);
  assert.deepEqual(overageLines([meter(500)], [{ meterKey: "dials", sellCents: 0 }]), []);
});

test("the label states the allowance so the customer can check the arithmetic", () => {
  const [line] = overageLines([meter(250)], [{ meterKey: "dials", sellCents: 3 }]);
  assert.match(line.label, /250/);
  assert.match(line.label, /1,000/);
});

// ── add-ons ──────────────────────────────────────────────────────────────────

const addon = (over) => ({ code: "seats", name: "Extra seats", priceCents: 1500, billingCycle: over });

test("an add-on on the subscription's own cycle is billed", () => {
  const { lines, skipped } = addonLines([addon("monthly")], "monthly");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount_cents, 1500);
  assert.equal(lines[0].kind, "addon");
  assert.deepEqual(skipped, []);
});

test("an add-on on a different cycle is skipped and reported, never billed anyway", () => {
  const { lines, skipped } = addonLines([addon("yearly")], "monthly");
  assert.deepEqual(lines, []);
  assert.equal(skipped.length, 1);
});

test("a zero-priced add-on adds no line", () => {
  const free = { ...addon("monthly"), priceCents: 0 };
  assert.deepEqual(addonLines([free], "monthly").lines, []);
});

// ── pending charges ──────────────────────────────────────────────────────────

test("a pending charge keeps its own kind and amount", () => {
  const [line] = pendingChargeLines([
    { id: "1", kind: "plan", label: "Advanced, 19 days", quantity: 1, includedQty: null, unitCents: 27519, amountCents: 27519 },
  ]);
  assert.equal(line.kind, "plan");
  assert.equal(line.amount_cents, 27519);
  assert.equal("included_qty" in line, false);
});

// ── credit ───────────────────────────────────────────────────────────────────

test("credit is clamped to the bill, so an invoice can never go negative", () => {
  assert.equal(creditApplied(50_000, 12_258), 12_258);
});

test("credit smaller than the bill is spent in full", () => {
  assert.equal(creditApplied(5_000, 12_258), 5_000);
});

test("no credit and no bill both mean nothing is applied", () => {
  assert.equal(creditApplied(0, 12_258), 0);
  assert.equal(creditApplied(5_000, 0), 0);
  assert.equal(creditApplied(-100, 12_258), 0);
});

test("a credit line carries a positive amount, matching create_custom_invoice", () => {
  assert.equal(creditLine(5_000).amount_cents, 5_000);
  assert.equal(creditLine(0), null);
});

// ── the whole assembly ───────────────────────────────────────────────────────

test("the ticket's worked upgrade reaches an invoice as two lines netting $122.58", () => {
  // SA-3.4's example: Basic $249 → Advanced $449 on day 12 of a 31-day period.
  const result = assemblePeriodInvoice({
    pending: [
      { id: "a", kind: "credit", label: "Basic, 19 unused days", quantity: 1, includedQty: null, unitCents: 15261, amountCents: 15261 },
      { id: "b", kind: "plan", label: "Advanced, 19 days", quantity: 1, includedQty: null, unitCents: 27519, amountCents: 27519 },
    ],
    addons: [],
    cycle: "monthly",
    usage: [],
    pricing: [],
    creditBalanceCents: 0,
  });

  assert.equal(result.totalCents, 12_258);
  assert.equal(result.lines.length, 2, "both halves stay visible rather than being netted into one");
  assert.deepEqual(result.pendingIds, ["a", "b"]);
});

test("add-ons, overage and credit combine into one invoice", () => {
  const result = assemblePeriodInvoice({
    pending: [],
    addons: [addon("monthly")],                                   // 1500
    cycle: "monthly",
    usage: [meter(250)],                                          // 250 × 3 = 750
    pricing: [{ meterKey: "dials", sellCents: 3 }],
    creditBalanceCents: 1_000,
  });

  assert.equal(result.subtotalCents, 2_250);
  assert.equal(result.creditAppliedCents, 1_000);
  assert.equal(result.totalCents, 1_250);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines.at(-1).kind, "credit", "credit is last, because it applies to everything above it");
});

test("credit larger than the charges leaves a total of zero, not a negative one", () => {
  const result = assemblePeriodInvoice({
    pending: [],
    addons: [addon("monthly")],
    cycle: "monthly",
    usage: [],
    pricing: [],
    creditBalanceCents: 999_999,
  });

  assert.equal(result.totalCents, 0);
  assert.equal(result.creditAppliedCents, 1_500, "only what the bill could absorb is spent");
});

test("nothing to bill produces no lines at all", () => {
  const result = assemblePeriodInvoice({
    pending: [], addons: [], cycle: "monthly", usage: [], pricing: [], creditBalanceCents: 10_000,
  });
  assert.deepEqual(result.lines, []);
  assert.equal(result.totalCents, 0);
  assert.equal(result.creditAppliedCents, 0, "credit is not spent when there is nothing to spend it on");
});

test("a downgrade's pending credit reduces the bill without inverting it", () => {
  const result = assemblePeriodInvoice({
    pending: [
      { id: "c", kind: "credit", label: "Unused Advanced days", quantity: 1, includedQty: null, unitCents: 5_000, amountCents: 5_000 },
    ],
    addons: [addon("monthly")],   // 1500
    cycle: "monthly",
    usage: [],
    pricing: [],
    creditBalanceCents: 0,
  });

  assert.equal(result.subtotalCents, 1_500);
  assert.equal(result.totalCents, -3_500, "the caller decides what to do with a negative net; it raises no invoice");
});
