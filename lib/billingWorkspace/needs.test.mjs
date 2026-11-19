import test from "node:test";
import assert from "node:assert/strict";

import { allNeeds, needsFor, stepCounts } from "./needs.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const base = {
  now: NOW,
  billingRun: { healthy: true, description: "ok", lastFinishedAt: null },
  stuckWebhooks: { count: 0, oldestReceivedAt: null },
  pastDue: { count: 0, atRiskCents: null },
  overdue: { count: 0, owedCents: 0 },
  mismatched: 0,
  trials: [],
  creditNotesToApprove: 0,
  creditNotesOwn: 0,
  overLimit: 0,
};
const all = () => true;
const every = new Set(["workspace", "trials", "failed", "invoices", "refunds", "reconciliation", "credits"]);

test("a quiet platform needs nothing and every badge is zero", () => {
  const rows = needsFor(base, all);
  assert.deepEqual(rows, []);
  assert.deepEqual(stepCounts(base, every, rows), { workspace: 0, trials: 0, failed: 0, invoices: 0, refunds: 0, reconciliation: 0, credits: 0 });
});

test("failing rows come before look rows, and each opens its page filtered", () => {
  const input = {
    ...base,
    billingRun: { healthy: false, description: "stale", lastFinishedAt: "2026-09-13T04:52:00Z" },
    stuckWebhooks: { count: 2, oldestReceivedAt: new Date(NOW - 64 * 86_400_000).toISOString() },
    overdue: { count: 19, owedCents: 214_000 },
    trials: [{ daysLeft: 2, hasPaymentMethod: false }, { daysLeft: 6, hasPaymentMethod: false }, { daysLeft: 9, hasPaymentMethod: false }, { daysLeft: 1, hasPaymentMethod: true }],
  };
  const rows = needsFor(input, all);
  assert.deepEqual(rows.map((row) => row.key), ["billing-run", "webhooks", "overdue", "trials"]);
  assert.equal(rows[0].detail, "Last finished Sep 13 · invoices aren't being raised");
  assert.equal(rows[1].detail, "2 waiting, oldest 64 days");
  assert.equal(rows[2].detail, "19 · $2,140.00 owed");
  assert.equal(rows[2].href, "/admin/invoices?lens=overdue");
  assert.equal(rows[3].detail, "2 within 7 days");
  const counts = stepCounts(input, every, rows);
  assert.equal(counts.workspace, 4);
  assert.equal(counts.trials, 1, "the badge counts 3 days or fewer with no card");
});

test("a failed read is 'Couldn't check' and its badge is left out, never zero", () => {
  const input = { ...base, overdue: null, overLimit: null };
  const rows = needsFor(input, all);
  assert.deepEqual(rows.map((row) => [row.key, row.tone]), [["overdue", "unknown"], ["over-limit", "unknown"]]);
  const counts = stepCounts(input, every, rows);
  assert.equal("invoices" in counts, false);
  assert.equal("credits" in counts, false);
  assert.equal(counts.workspace, 0);
});

test("a role sees only the rows and badges for pages it can open", () => {
  const input = { ...base, overLimit: 2, overdue: { count: 3, owedCents: 100 } };
  const rows = needsFor(input, (href) => !href.startsWith("/admin/credits-limits"));
  assert.deepEqual(rows.map((row) => row.key), ["overdue"]);
  const counts = stepCounts(input, new Set(["workspace", "invoices"]), rows);
  assert.deepEqual(counts, { workspace: 1, invoices: 3 });
});

test("a credit note raised by this admin is not theirs to approve", () => {
  const rows = allNeeds({ ...base, creditNotesToApprove: 0, creditNotesOwn: 2 });
  assert.equal(rows.some((row) => row.key === "approve"), false);
});
