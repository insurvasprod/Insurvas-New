// One policy's money check (ledger-r1 1·A). Run with: node --experimental-strip-types --test lib/ledger/policyMoney.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pairPolicyMoney } from "./policyMoney.ts";

const line = (id, kind, postedOn, amountCents, lineNumber = 1) => ({ id, kind, postedOn, amountCents, statementId: "s1", lineNumber, periodStart: "2026-10-01", periodEnd: "2026-10-31" });

test("an advance and its chargeback each pair with their own line, and the policy nets to zero", () => {
  const check = pairPolicyMoney(
    [
      { id: "p:advance", kind: "advance", policyYear: 1, postedOn: "2026-06-10", amountCents: 68400, rateBp: 10000 },
      { id: "p:chargeback", kind: "chargeback", policyYear: 1, postedOn: "2026-10-01", amountCents: -68400, rateBp: null },
    ],
    [line("l3", "advance", "2026-06-10", 68400, 3), line("l8", "chargeback", "2026-10-20", -68400, 8)],
  );
  assert.deepEqual(check.rows.map((r) => [r.kind, r.expectedCents, r.paidCents, r.line?.lineNumber, r.matches]), [
    ["chargeback", -68400, -68400, 8, true],
    ["advance", 68400, 68400, 3, true],
  ]);
  assert.equal(check.differenceCents, 0);
  assert.equal(check.paidOutCents, 68400);
  assert.equal(check.takenBackCents, 68400);
});

test("a short line keeps its gap, an unpaid entry has no line, and an unexpected line stands alone", () => {
  const check = pairPolicyMoney(
    [
      { id: "p:advance", kind: "advance", policyYear: 1, postedOn: "2026-06-10", amountCents: 81000, rateBp: 10000 },
      { id: "p:2", kind: "commission", policyYear: 2, postedOn: "2027-06-10", amountCents: 5400, rateBp: 500 },
    ],
    [line("a", "advance", "2026-06-12", 64800), line("x", "adjustment", "2026-07-01", 1200)],
  );
  const byKind = Object.fromEntries(check.rows.map((r) => [r.kind, r]));
  assert.equal(byKind.advance.gapCents, -16200);
  assert.equal(byKind.advance.matches, false);
  assert.equal(byKind.commission.paidCents, null);
  assert.equal(byKind.commission.line, null);
  assert.equal(byKind.adjustment.expectedCents, null);
  assert.equal(check.differenceCents, 64800 + 1200 - 81000 - 5400);
});

test("each line pays one entry: the nearest of its kind", () => {
  const check = pairPolicyMoney(
    [
      { id: "y1", kind: "commission", policyYear: 1, postedOn: "2025-01-01", amountCents: 1000, rateBp: 100 },
      { id: "y2", kind: "commission", policyYear: 2, postedOn: "2026-01-01", amountCents: 1000, rateBp: 100 },
    ],
    [line("late", "commission", "2026-01-05", 1000)],
  );
  assert.equal(check.rows.find((r) => r.key === "y2").paidCents, 1000);
  assert.equal(check.rows.find((r) => r.key === "y1").paidCents, null);
});

test("the hand policy page opens on the money check, one page, no tabs", () => {
  const page = readFileSync(join(process.cwd(), "app/app/(shell)/policies/[id]/page.tsx"), "utf8");
  assert.match(page, /pairPolicyMoney\(/);
  assert.match(page, /title="Expected vs Paid"/);
  assert.doesNotMatch(page, /<ViewTabs\b/, "one page: the money check and the facts together");
});
