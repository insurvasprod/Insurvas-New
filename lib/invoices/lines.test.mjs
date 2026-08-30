// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceLines, totalCents } from "./lines.ts";

const PLAN_B = { name: "Plan B", version: 1, billingCycle: "monthly", priceCents: 24900, setupFeeCents: 0 };
const WITH_SETUP = { ...PLAN_B, setupFeeCents: 5000 };

test("a plain renewal is one plan line at our price", () => {
  const lines = buildInvoiceLines(PLAN_B, { isFirstPeriod: false });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "plan");
  assert.equal(lines[0].amount_cents, 24900);
  assert.equal(totalCents(lines), 24900);
});

test("the label names the version, because the price belongs to a version", () => {
  const [line] = buildInvoiceLines(PLAN_B, { isFirstPeriod: false });

  assert.match(line.label, /Plan B v1/);
  assert.match(line.label, /monthly/);
});

test("a setup fee is charged on the first period only", () => {
  const first = buildInvoiceLines(WITH_SETUP, { isFirstPeriod: true });
  const renewal = buildInvoiceLines(WITH_SETUP, { isFirstPeriod: false });

  assert.equal(totalCents(first), 29900);
  assert.equal(first.some((l) => l.kind === "setup_fee"), true);

  // Billing it every month is the obvious way to overcharge a long-standing customer.
  assert.equal(totalCents(renewal), 24900);
  assert.equal(renewal.some((l) => l.kind === "setup_fee"), false);
});

test("a zero setup fee adds no line at all", () => {
  const lines = buildInvoiceLines(PLAN_B, { isFirstPeriod: true });

  // A $0.00 line on an invoice is noise, not information.
  assert.equal(lines.length, 1);
});

test("a free plan still produces an invoice line", () => {
  // Zero is a price; null would be an absence. A free plan is genuinely billable at zero.
  const lines = buildInvoiceLines({ ...PLAN_B, priceCents: 0 }, { isFirstPeriod: true });

  assert.equal(lines.length, 1);
  assert.equal(totalCents(lines), 0);
});

test("discounts and credits subtract, matching the SQL", () => {
  const lines = [
    { kind: "plan", label: "Plan B", amount_cents: 24900 },
    { kind: "addon", label: "Extra seats", amount_cents: 5000 },
    { kind: "discount", label: "Launch offer", amount_cents: 2500 },
  ];

  assert.equal(totalCents(lines), 27400);
});

test("a discount stored as a negative still subtracts once", () => {
  // The SQL takes abs() of discount lines. If this used the raw value, a negative amount would
  // ADD to the total — the customer would be charged for their own discount.
  const positive = totalCents([{ kind: "discount", label: "d", amount_cents: 2500 }]);
  const negative = totalCents([{ kind: "discount", label: "d", amount_cents: -2500 }]);

  assert.equal(positive, -2500);
  assert.equal(negative, -2500);
});
