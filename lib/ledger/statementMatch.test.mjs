import test from "node:test";
import assert from "node:assert/strict";

import { normaliseInsuredName, normalisePolicyNumber, policyIsWithCarrier, proposeExactMatches, proposeFallbackMatches, reconcileStatements, statementTotals } from "./statementMatch.ts";

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

// ── LA-4.3 · matching by insured name when the policy number does not match ──

const statementCarrier = { id: "c1", code: "MOO", name: "Mutual of Omaha" };
const namedPolicies = [
  { id: "p1", policyNumber: "MO-1001", insuredName: "Marla Jenkins", carrier: "Mutual of Omaha" },
  { id: "p2", policyNumber: "MO-1002", insuredName: "Robert Cline", carrier: "Mutual of Omaha" },
  { id: "p3", policyNumber: "MO-1003", insuredName: "Robert Cline", carrier: "Mutual of Omaha" },
  { id: "p4", policyNumber: "AM-2001", insuredName: "Dolores Ruiz", carrier: "Americo" },
];
const line = (lineNumber, policyNumber, insuredName, amountCents = 5000) => ({ lineNumber, policyNumber, insuredName, amountCents, error: null });

test("4.3: names are compared the way carriers print them", () => {
  assert.equal(normaliseInsuredName("JENKINS, MARLA"), "marla jenkins");
  assert.equal(normaliseInsuredName("Marla J. Jenkins"), "marla jenkins", "a middle initial is dropped");
  assert.equal(normaliseInsuredName("  marla   jenkins "), "marla jenkins");
});

test("4.3: a unique insured name with the statement's carrier is proposed, by name, and only when the number did not match", () => {
  const lines = [line(1, "MO-1001", "Marla Jenkins"), line(2, "MO1O01-typo", "JENKINS, MARLA")];
  const exact = proposeExactMatches(lines, namedPolicies, statementCarrier);
  const named = proposeFallbackMatches(lines, namedPolicies, statementCarrier, exact);
  assert.equal(exact.get(1).policyId, "p1");
  assert.equal(named.has(1), false, "an exact proposal is not second-guessed");
  assert.equal(named.get(2).policyId, "p1");
  assert.equal(named.get(2).method, "name");
  assert.match(named.get(2).reason, /Check before accepting/);
});

test("4.3: an ambiguous name, or a name with another carrier, proposes nothing", () => {
  const lines = [line(1, "", "Robert Cline"), line(2, "", "Dolores Ruiz")];
  const named = proposeFallbackMatches(lines, namedPolicies, statementCarrier, proposeExactMatches(lines, namedPolicies, statementCarrier));
  assert.equal(named.get(1).policyId, null);
  assert.match(named.get(1).reason, /2 Mutual of Omaha policies are for Robert Cline/);
  assert.equal(named.has(2), false, "Dolores Ruiz is an Americo policy, not this carrier's");
});

test("4.3: the amount breaks a name tie when one policy's expected entry is within the tolerance", () => {
  const lines = [line(1, "", "Robert Cline", 4210)];
  const expected = new Map([["p2", [4205]], ["p3", [9000]]]);
  const named = proposeFallbackMatches(lines, namedPolicies, statementCarrier, proposeExactMatches(lines, namedPolicies, statementCarrier), expected);
  assert.equal(named.get(1).policyId, "p2");
  assert.match(named.get(1).reason, /name, carrier and amount match/);
  const both = proposeFallbackMatches(lines, namedPolicies, statementCarrier, new Map(), new Map([["p2", [4205]], ["p3", [4250]]]));
  assert.equal(both.get(1).policyId, null, "two policies within the tolerance is still a tie");
});
