// QA 2026-11-03: a chargeback line read "Expected $270.00" (the policy's first-year commission). Expected beside a
// chargeback is the finding's own figure — $0.00 for one on a policy the files show active — or "—".
// Run with: node --experimental-strip-types --test lib/commissions/lineExpected.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chargebackLines, fileLineExpectedCents, findingExpectedCents } from "./lineExpected.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("an unexpected chargeback expected nothing; other findings keep their own figure", () => {
  assert.equal(findingExpectedCents("unexpected_chargeback", 27000), 0);
  assert.equal(findingExpectedCents("unexpected_chargeback", null), 0);
  assert.equal(findingExpectedCents("duplicate_chargeback", -20250), -20250);
  assert.equal(findingExpectedCents("short_paid", 27000), 27000);
});

test("a file's chargeback lines never show the policy's first-year commission as expected", () => {
  assert.ok(chargebackLines(["chargeback"]));
  assert.ok(chargebackLines(["chargeback", "reversal of chargeback"]));
  assert.ok(!chargebackLines(["advance", "chargeback"]));
  assert.ok(!chargebackLines([]));
  // The QA line: −$202.50 charged back, the policy's expected advance $270.00, an open unexpected-chargeback finding.
  assert.equal(fileLineExpectedCents({ types: ["chargeback"], expectedCents: 27000 }, { type: "unexpected_chargeback", expectedCents: 0 }), 0);
  // No finding about a chargeback: "—".
  assert.equal(fileLineExpectedCents({ types: ["chargeback"], expectedCents: 27000 }, null), null);
  assert.equal(fileLineExpectedCents({ types: ["chargeback"], expectedCents: 27000 }, { type: "short_paid", expectedCents: 27000 }), null);
  // Commission lines are unchanged.
  assert.equal(fileLineExpectedCents({ types: ["advance"], expectedCents: 27000 }, null), 27000);
});

test("Pay issues reads the finding's expected through the one rule, for carrier files and hand imports", () => {
  // Round 7: both sources become one PayIssue in one place (lib/discrepancies/payIssues.ts), each through the rule.
  const src = read("lib/discrepancies/payIssues.ts");
  assert.match(src, /findingExpectedCents\(row\.type, row\.expectedCents\)/);
  assert.match(src, /findingExpectedCents\(type, item\.detail\?\.expectedCents \?\? null\)/);
  assert.match(src, /const type: DiscrepancyType = HAND_TYPE\[item\.kind\];/);
});
