import test from "node:test";
import assert from "node:assert/strict";

import { diffPlanVersions, diffSummary, versionHistory } from "./versionDiff.ts";

const prices = (monthly, trial = 7) => ({ price_monthly_cents: monthly, price_quarterly_cents: null, price_yearly_cents: null, setup_fee_cents: 0, trial_days: trial, currency: "usd" });
const limits = (seats) => ({ max_seats: seats, max_carriers: null, max_publishers: null, max_marketing_partners: null, max_affiliates: null, max_buffer_seats: null, max_partner_users: null, max_setter_seats: null, max_active_campaigns: null });
const version = (n, patch = {}) => ({ id: `v${n}`, version: n, name: "Agency", createdAt: `2026-0${n}-01T00:00:00Z`, isArchived: false, subscribers: 0, prices: prices(27900), limits: limits(20), features: ["dialer"], meters: [], ...patch });

test("a price change, a granted feature and a raised limit are each one line", () => {
  const lines = diffPlanVersions(version(3), version(4, { prices: prices(29900), features: ["dialer", "lead_posting"], limits: limits(26) }), { features: { lead_posting: "Lead posting" } });
  assert.deepEqual(lines, [
    { key: "price:price_monthly_cents", label: "Monthly price", from: "$279.00", to: "$299.00" },
    { key: "limit:max_seats", label: "Seats", from: "20", to: "26" },
    { key: "feature:lead_posting", label: "Lead posting", from: null, to: "Granted" },
  ]);
  assert.equal(diffSummary(lines, 2), "Monthly price $279.00 → $299.00 · Seats 20 → 26 · 1 more");
});

test("a removed feature, a trial change and a meter allowance read in words", () => {
  const lines = diffPlanVersions(version(1), version(2, { prices: prices(27900, 14), features: [], meters: [{ meter_key: "dialer_minutes", included_qty: 1000, hard_cap: true }] }));
  assert.deepEqual(lines.map((line) => [line.label, line.from, line.to]), [
    ["Trial", "7 days", "14 days"],
    ["dialer", "Granted", null],
    ["dialer_minutes", "Platform default", "1,000, hard cap"],
  ]);
  assert.equal(diffSummary([]), "No change to price, limits or features");
});

test("history is newest first, each against the version before it; the first has no diff", () => {
  const rows = versionHistory([version(1), version(3, { prices: prices(29900) }), version(2)]);
  assert.deepEqual(rows.map((row) => row.version), [3, 2, 1]);
  assert.equal(rows[2].changes, null);
  assert.equal(rows[1].changes.length, 0);
  assert.equal(rows[0].changes[0].to, "$299.00");
});
