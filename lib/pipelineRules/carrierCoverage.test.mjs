// Setup › Carrier rules, the coverage screen (LA-4.17; boards 9, 9b): per carrier, each window verified, observed
// but unverified, or not set; the biggest gap with the policies it affects; sorted by policies affected.
// Run with: node --experimental-strip-types --test lib/pipelineRules/carrierCoverage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { affectedBy, coverageGapsOf, coverageRules, filesSummary, filterCoverage, missingRuleCount, moneySummary, sortByAffected } from "./carrierCoverageModel.ts";

const T = "tenant-a";
const C = "carrier-1";
const rule = (over) => ({ id: over.id ?? `r-${Math.random()}`, tenantId: null, carrierId: C, ruleType: "first_payment", windowDays: 30, graceDays: 5, redraftAttempts: null, redraftIntervalDays: null, source: "carrier_agreement", notes: null, effectiveFrom: "2026-01-01", createdAt: "2026-01-01T00:00:00Z", cleared: false, verifiedAt: null, ...over });

test("null means null: a window nobody set is missing, never a default", () => {
  const rules = coverageRules([], { tenantId: T, carrierId: C, asOf: "2026-11-03" });
  for (const type of Object.keys(rules)) {
    assert.equal(rules[type].state, "missing");
    assert.equal(rules[type].inForce, null);
  }
  const gaps = coverageGapsOf(rules, 112);
  assert.equal(gaps.length, 5);
  assert.deepEqual(gaps[0], { type: "first_payment", policies: 112, words: "First payment window not set", cost: "112 policies in force have no first payment countdown" });
});

test("tenant override, then Insurvas's, then nothing; verified and unverified are told apart", () => {
  const rows = [
    rule({ id: "p1", verifiedAt: "2026-01-02T00:00:00Z" }),
    rule({ id: "p2", ruleType: "ongoing_payment", windowDays: 31 }),
    rule({ id: "a1", tenantId: T, ruleType: "ongoing_payment", windowDays: 45, effectiveFrom: "2026-06-01", source: "phone_call" }),
    rule({ id: "x", tenantId: "someone-else", ruleType: "reinstatement", windowDays: 180 }),
  ];
  const rules = coverageRules(rows, { tenantId: T, carrierId: C, asOf: "2026-11-03" });
  assert.equal(rules.first_payment.state, "verified");
  assert.equal(rules.ongoing_payment.inForce.id, "a1", "the agency's own wins from its date");
  assert.equal(rules.ongoing_payment.insurvas.id, "p2", "Insurvas's is kept beside it");
  assert.equal(rules.ongoing_payment.state, "unverified");
  assert.equal(rules.reinstatement.state, "missing", "another agency's rule is never this one's");
});

test("effective-dated: a rule dated ahead is upcoming, and the history keeps every row newest first", () => {
  const rows = [rule({ id: "p1" }), rule({ id: "a-next", tenantId: T, windowDays: 40, effectiveFrom: "2026-12-01" }), rule({ id: "a-old", tenantId: T, windowDays: 20, effectiveFrom: "2026-03-01" })];
  const rules = coverageRules(rows, { tenantId: T, carrierId: C, asOf: "2026-11-03" });
  assert.equal(rules.first_payment.inForce.id, "a-old");
  assert.equal(rules.first_payment.upcoming.id, "a-next");
  assert.deepEqual(rules.first_payment.history.map((r) => r.id), ["a-next", "a-old", "p1"]);
});

test("the list sorts by policies affected, filters by gap or unverified, and counts every missing window", () => {
  const make = (name, inForce, rows) => ({ carrierId: name, carrierName: name, inForce, rules: coverageRules(rows.map((r) => ({ ...r, carrierId: name })), { tenantId: T, carrierId: name, asOf: "2026-11-03" }) });
  const all = ["first_payment", "ongoing_payment", "reinstatement", "conservation", "cancellation_request"].map((type) => rule({ ruleType: type, verifiedAt: "2026-01-02T00:00:00Z" }));
  const complete = make("Aetna", 408, all);
  const small = make("Americo", 112, []);
  const big = make("American Amicable", 641, all.slice(0, 3).map((r, i) => (i === 1 ? { ...r, verifiedAt: null } : r)));
  const sorted = sortByAffected([complete, small, big]);
  assert.deepEqual(sorted.map((r) => r.carrierName), ["American Amicable", "Americo", "Aetna"]);
  assert.equal(affectedBy(complete), 0);
  assert.deepEqual(filterCoverage(sorted, "missing", "").map((r) => r.carrierName), ["American Amicable", "Americo"]);
  assert.deepEqual(filterCoverage(sorted, "unverified", "").map((r) => r.carrierName), ["American Amicable"]);
  assert.deepEqual(filterCoverage(sorted, "all", "aetna").map((r) => r.carrierName), ["Aetna"]);
  assert.equal(missingRuleCount(sorted), 2 + 5);
});

test("money and files summaries say what is not set instead of guessing", () => {
  assert.equal(moneySummary(null, null), "Trigger and lag not set");
  assert.equal(moneySummary("on_first_draft", 30), "On first draft · 30 d");
  assert.equal(moneySummary("on_issue", null), "On issue · lag not set");
  assert.equal(filesSummary(null, null), "Format not set · no layout yet");
  assert.equal(filesSummary("pdf", 2), "PDF · layout v2");
});
