import test from "node:test";
import assert from "node:assert/strict";

import { normalisePolicyNumber, policyIsWithCarrier, proposeExactMatches, reconcileStatements, statementTotals } from "./statementMatch.ts";

const moo = { id: "moo", code: "mutual_of_omaha", name: "Mutual of Omaha" };
const policies = [
  { id: "p1", policyNumber: "POL-0012", insuredName: "Grace", carrier: "Mutual of Omaha" },
  { id: "p2", policyNumber: "POL-0099", insuredName: "Dermot", carrier: "Americo" },
  { id: "p3", policyNumber: "A-7", insuredName: "Alonzo", carrier: "mutual_of_omaha" },
  { id: "p4", policyNumber: "A7", insuredName: "Alonzo twin", carrier: "Mutual of Omaha" },
];

test("policy numbers compare without case, spaces or punctuation, but keep leading zeros", () => {
  assert.equal(normalisePolicyNumber(" pol-0012 "), "POL0012");
  assert.notEqual(normalisePolicyNumber("POL-12"), normalisePolicyNumber("POL-0012"));
});

test("the carrier is matched by code or name, as the ledger prices it", () => {
  assert.equal(policyIsWithCarrier("Mutual of Omaha", moo), true);
  assert.equal(policyIsWithCarrier("mutual_of_omaha", moo), true);
  assert.equal(policyIsWithCarrier("Americo", moo), false);
  assert.equal(policyIsWithCarrier("", moo), false);
});

test("exactly one policy with the number AND the carrier is a proposal; anything else says why not", () => {
  const proposals = proposeExactMatches(
    [
      { lineNumber: 1, policyNumber: "pol 0012", error: null },
      { lineNumber: 2, policyNumber: "POL-0099", error: null },
      { lineNumber: 3, policyNumber: "A7", error: null },
      { lineNumber: 4, policyNumber: "NOPE-1", error: null },
      { lineNumber: 5, policyNumber: null, error: null },
      { lineNumber: 6, policyNumber: "POL-0012", error: "bad amount" },
    ],
    policies,
    moo,
  );
  assert.deepEqual(proposals.get(1), { policyId: "p1", reason: "Policy number and carrier match." });
  assert.equal(proposals.get(2).policyId, null);
  assert.match(proposals.get(2).reason, /recorded with Americo, not Mutual of Omaha/);
  assert.equal(proposals.get(3).policyId, null, "A-7 and A7 are the same number: two candidates is not a match");
  assert.match(proposals.get(3).reason, /2 Mutual of Omaha policies share this number/);
  assert.match(proposals.get(4).reason, /No policy NOPE-1 in your book/);
  assert.match(proposals.get(5).reason, /No policy number/);
  assert.equal(proposals.get(6).policyId, null, "an unreadable line is never proposed");
});

test("the tiles: gross is everything received, chargebacks are the positive amount taken back", () => {
  const totals = statementTotals([
    { kind: "advance", amountCents: 100000 },
    { kind: "commission", amountCents: 17500 },
    { kind: "adjustment", amountCents: -500 },
    { kind: "chargeback", amountCents: -42000 },
  ]);
  assert.deepEqual(totals, { entries: 4, grossCents: 117000, advancesCents: 100000, chargebacksCents: 42000, adjustmentsCents: -500 });
  assert.deepEqual(statementTotals([]), { entries: 0, grossCents: 0, advancesCents: 0, chargebacksCents: 0, adjustmentsCents: 0 });
});

test("reconciliation compares only the expected entries inside the reported periods", () => {
  const expected = [
    { policyId: "p1", amountCents: 105750, postedOn: "2026-08-05" },
    { policyId: "p1", amountCents: 11750, postedOn: "2027-02-05" }, // outside August: not yet reported
    { policyId: "p3", amountCents: 5000, postedOn: "2026-08-10" },
  ];
  const received = [
    { policyId: "p1", amountCents: 105750, periodStart: "2026-08-01", periodEnd: "2026-08-31" },
    { policyId: "p3", amountCents: 4000, periodStart: "2026-08-01", periodEnd: "2026-08-31" },
    { policyId: "p9", amountCents: 900, periodStart: "2026-08-01", periodEnd: "2026-08-31" },
  ];
  const rows = reconcileStatements(expected, received, new Set(["p1", "p3"]));
  const byId = Object.fromEntries(rows.map((row) => [row.policyId, row]));
  assert.deepEqual([byId.p1.status, byId.p1.expectedCents, byId.p1.differenceCents, byId.p1.expectedEntries], ["agrees", 105750, 0, 1]);
  assert.deepEqual([byId.p3.status, byId.p3.differenceCents], ["short", -1000]);
  assert.equal(byId.p9.status, "unpriced", "no expected figure is not the same as short");
  assert.equal(rows[0].policyId, "p3", "a shortfall sorts first");
});

test("a few cents of rounding agree; a dollar is a difference; overlapping periods count an entry once", () => {
  const expected = [{ policyId: "p1", amountCents: 10000, postedOn: "2026-08-15" }];
  const received = [
    { policyId: "p1", amountCents: 6001, periodStart: "2026-08-01", periodEnd: "2026-08-31" },
    { policyId: "p1", amountCents: 4000, periodStart: "2026-08-01", periodEnd: "2026-08-31" },
  ];
  assert.equal(reconcileStatements(expected, received, new Set(["p1"]))[0].status, "agrees");
  const over = reconcileStatements(expected, [...received, { policyId: "p1", amountCents: 100, periodStart: "2026-08-10", periodEnd: "2026-08-20" }], new Set(["p1"]))[0];
  assert.deepEqual([over.status, over.expectedCents, over.periods.length], ["over", 10000, 2]);
});
