// LA-4.13 (Notion sprint) · expected commission: trigger, lag, rate card, confidence, age bands, coverage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { addDays, ageOn, bpToPercent, coverage, percentToBp, expectedFor, firstDraftDate, mulDivRound, resolveRate, triggerOccurredOn } from "./expectedCommission.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261008230000_la_4_13_expected_commission.sql");

const fe = (over = {}) => ({ id: "s1", productCode: "final_expense", levelBp: 10000, policyYear: 1, appliesOnward: false, rateBp: 14500, effectiveFrom: "2026-01-01", bands: [], ...over });
const policy = { carrierId: "aetna", policyNumber: "P1", trigger: "on_first_draft", lagDays: 10, family: "final_expense", carrierProductCode: "FE Level", levelBp: 10000, age: 70, annualPremiumCents: 60000, schedules: [fe()], advanceRules: [{ productCode: "final_expense", advanceMonths: 9, advancePctBp: 7500, effectiveFrom: "2026-01-01" }] };

test("on first draft: issued but not drafted has no expected row and so no missing alert", () => {
  const issuedOnly = { issueDate: "2026-10-03", issuedOn: "2026-10-03", effectiveDate: "2026-10-22", paidTo: "2026-10-22", firstSeenDate: "2026-10-05" };
  assert.equal(triggerOccurredOn("on_first_draft", issuedOnly, null), null);
  assert.equal(expectedFor({ ...policy, triggerDay: triggerOccurredOn("on_first_draft", issuedOnly, null) }), null);
  // The same policy on an on-issue carrier is expected from its issue date.
  assert.equal(triggerOccurredOn("on_issue", issuedOnly, null), "2026-10-03");
  // No trigger set for the carrier: nothing is expected, rather than a guess.
  assert.equal(expectedFor({ ...policy, trigger: null, triggerDay: "2026-10-03" }), null);
});

test("the first draft is read from the change log: the first file where paid-to moved past effective", () => {
  const changes = [{ newValue: "2026-10-22", toSnapshotDate: "2026-10-25" }, { newValue: "2026-11-22", toSnapshotDate: "2026-11-01" }, { newValue: "2026-12-22", toSnapshotDate: "2026-12-01" }];
  assert.equal(firstDraftDate(changes, "2026-10-22"), "2026-11-01");
  const p = { issueDate: "2026-10-03", issuedOn: null, effectiveDate: "2026-10-22", paidTo: "2026-12-22", firstSeenDate: "2026-10-05" };
  assert.equal(triggerOccurredOn("on_first_draft", p, firstDraftDate(changes, "2026-10-22")), "2026-11-01");
  // First seen already paid past effective (an imported book): it had drafted by its first file.
  assert.equal(triggerOccurredOn("on_first_draft", { ...p, firstSeenDate: "2026-12-05" }, null), "2026-12-05");
});

test("overdue_from is trigger plus lag; no lag, never overdue", () => {
  const row = expectedFor({ ...policy, triggerDay: "2026-11-01" });
  assert.equal(row.overdue_from, "2026-11-11");
  assert.equal(expectedFor({ ...policy, lagDays: null, triggerDay: "2026-11-01" }).overdue_from, null);
  assert.equal(addDays("2026-12-28", 10), "2027-01-07");
});

test("an exact figure in integer cents, with the schedule id and version used, and the advance", () => {
  const row = expectedFor({ ...policy, triggerDay: "2026-11-01" });
  assert.deepEqual([row.confidence, row.rate_bp_applied, row.expected_amount_cents, row.schedule_id, row.schedule_version], ["exact", 14500, 87000, "s1", "2026-01-01"]);
  assert.deepEqual([row.advance_months, row.advance_pct_bp, row.expected_advance_cents], [9, 7500, 65250], "$600 × 145% = $870; 75% advanced = $652.50 (the spec's example)");
  for (const key of ["expected_amount_cents", "expected_advance_cents", "rate_bp_applied"]) assert.ok(Number.isSafeInteger(row[key]), key);
  assert.equal(mulDivRound(33333, 14500, 10000), 48333, "48332.85 rounds half up to 48333");
  assert.throws(() => mulDivRound(1.5, 1, 1));
});

test("no rate card: a reason and no figure, never $0.00", () => {
  for (const [over, why] of [[{ family: null }, /not matched to a product family/], [{ schedules: [] }, /no final expense rate/], [{ levelBp: 12000 }, /contract level \(120%\)/], [{ annualPremiumCents: null }, /no premium/]]) {
    const row = expectedFor({ ...policy, ...over, triggerDay: "2026-11-01" });
    assert.equal(row.confidence, "no_rate_card");
    assert.equal(row.expected_amount_cents, null);
    assert.equal(row.rate_bp_applied, null);
    assert.match(row.reason, why);
  }
  assert.match(sql, /confidence = 'no_rate_card' and expected_amount_cents is null and rate_bp_applied is null and reason is not null/);
});

test("rates are forward-only, levels are assumed only when there is exactly one, and age bands resolve", () => {
  const later = fe({ id: "s2", rateBp: 15000, effectiveFrom: "2026-12-01" });
  assert.equal(resolveRate({ schedules: [fe(), later], family: "final_expense", levelBp: 10000, policyYear: 1, onDay: "2026-11-01", age: 70 }).rateBp, 14500, "a raise dated later does not reach back");
  assert.equal(resolveRate({ schedules: [fe(), later], family: "final_expense", levelBp: 10000, policyYear: 1, onDay: "2026-12-15", age: 70 }).rateBp, 15000);
  const assumed = resolveRate({ schedules: [fe()], family: "final_expense", levelBp: null, policyYear: 1, onDay: "2026-11-01", age: 70 });
  assert.equal(assumed.confidence, "assumed_level");
  assert.equal(resolveRate({ schedules: [fe(), fe({ id: "s3", levelBp: 12000 })], family: "final_expense", levelBp: null, policyYear: 1, onDay: "2026-11-01", age: 70 }).confidence, "no_rate_card");
  // AMAM Senior Choice: 145%, but 110% at 80 and over.
  const banded = fe({ bands: [{ id: "b80", ageMin: 80, ageMax: 85, rateBp: 11000 }] });
  assert.deepEqual([resolveRate({ schedules: [banded], family: "final_expense", levelBp: 10000, policyYear: 1, onDay: "2026-11-01", age: 81 }).rateBp, resolveRate({ schedules: [banded], family: "final_expense", levelBp: 10000, policyYear: 1, onDay: "2026-11-01", age: 79 }).rateBp], [11000, 14500]);
  assert.match(resolveRate({ schedules: [banded], family: "final_expense", levelBp: 10000, policyYear: 1, onDay: "2026-11-01", age: null }).reason, /issue age unknown/);
  assert.equal(ageOn("1946-11-02", "2026-11-01"), 79);
  assert.equal(ageOn("1946-11-01", "2026-11-01"), 80);
});

test("coverage: carriers covered and the share of monthly premium", () => {
  const c = coverage([
    { carrierId: "a", monthlyCents: 50000, priced: true }, { carrierId: "a", monthlyCents: 10000, priced: false },
    { carrierId: "b", monthlyCents: 20000, priced: false }, { carrierId: "c", monthlyCents: 20000, priced: true },
  ]);
  assert.deepEqual([c.carriersCovered, c.carriers, c.pricedPct], [2, 3, 70]);
  assert.equal(coverage([]).pricedPct, null);
});

test("the migration: forward-only guard, one writer, triggers seeded for the listed carriers in the library", () => {
  assert.match(sql, /An expected commission figure is never rewritten/);
  assert.match(sql, /where expected_commission\.confidence = 'no_rate_card'/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.expected_commission from service_role, tenant_app/);
  assert.match(sql, /\('americo', 'on_issue', 35\), \('mutual_of_omaha', 'on_issue', null::integer\),\s*\('aetna', 'on_first_draft', 10\), \('transamerica', 'on_first_draft', null::integer\)/);
  assert.match(sql, /schedule_id is not null and schedule_version is not null/);
});

test("a typed percentage becomes basis points from its digits, and back", () => {
  assert.deepEqual(["145", "82.5", "7.25", "110%", " 0.5 "].map(percentToBp), [14500, 8250, 725, 11000, 50]);
  assert.deepEqual(["", "abc", "1.234", "-5", "12345"].map(percentToBp), [null, null, null, null, null]);
  assert.deepEqual([14500, 8250, 725, 50].map(bpToPercent), ["145", "82.5", "7.25", "0.5"]);
});