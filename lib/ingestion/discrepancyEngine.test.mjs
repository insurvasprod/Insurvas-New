// LA-4.15 (Notion sprint) · the discrepancy engine: each of the nine types, one positive and one
// negative case; the rate-free types with no rate card at all; tolerance; the wording rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_TOLERANCE_CENTS, detect, DISCREPANCY_TYPES, moneySummary } from "./discrepancyEngine.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261008250000_la_4_15_commission_discrepancies.sql", import.meta.url), "utf8");
const C = "c1";
const policy = (over = {}) => ({ carrierId: C, carrierName: "Aetna", policyNumber: "P1", status: "active", inClawbackWindow: true, lapsedOn: null, monthsPaid: 2, ...over });
const expected = (over = {}) => ({ carrierId: C, policyNumber: "P1", policyYear: 1, confidence: "exact", trigger: "on_first_draft", triggerOn: "2026-08-01", overdueFrom: "2026-08-11", reason: null, expectedAmountCents: 87000, expectedAdvanceCents: 65250, scheduleId: "s1", scheduleVersion: "2026-01-01", rateBp: 14500, premiumCents: 60000, ...over });
let n = 0;
const entry = (type, amountCents, over = {}) => ({ id: `e${++n}`, carrierId: C, policyNumber: "P1", type, correctsType: null, reversesEntryId: null, amountCents, transactionDate: "2026-08-20", statementDate: "2026-08-20", rateBp: null, commissionablePremiumCents: null, monthsAdvanced: 9, ...over });
const stmt = (date, closing, over = {}) => ({ id: date, carrierId: C, statementDate: date, fileId: null, openingCents: 0, activityCents: closing, closingCents: closing, debitCents: Math.min(0, closing), amountPaidCents: null, heldCents: null, minimumPayoutCents: null, entriesCents: null, entries: null, arithmeticOk: true, entriesOk: true, continuityOk: true, previousStatementDate: null, ...over });
const run = (over = {}) => detect({ today: "2026-10-08", policies: [policy()], expected: [], entries: [], statements: [], carrierNames: new Map([[C, "Aetna"]]), tolerance: () => DEFAULT_TOLERANCE_CENTS, ...over });
const types = (findings) => findings.map((f) => f.discrepancy_type);

test("missing: trigger fired and lag elapsed with no line; not before the lag, not once a line exists; works with no rate card", () => {
  assert.deepEqual(types(run({ expected: [expected()] })), ["missing"]);
  assert.deepEqual(types(run({ expected: [expected({ overdueFrom: "2026-10-20" })] })), [], "inside the lag: nothing yet");
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("advance", 65250)] })), []);
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("held", 350)] })), [], "held is received, not missing");
  const unpriced = run({ expected: [expected({ confidence: "no_rate_card", expectedAmountCents: null, expectedAdvanceCents: null, scheduleId: null, rateBp: null, reason: "no final expense rate" })] });
  assert.deepEqual(types(unpriced), ["missing"]);
  assert.equal(unpriced[0].difference_cents, null, "no rate: missing, but no invented amount");
  assert.match(unpriced[0].explanation, /can't be worked out yet: no final expense rate/);
});

test("short-paid and over-paid: beyond tolerance only, and the tolerance is on the finding", () => {
  const short = run({ expected: [expected()], entries: [entry("advance", 60000)] });
  assert.deepEqual(types(short), ["short_paid"]);
  assert.deepEqual([short[0].expected_amount_cents, short[0].reported_amount_cents, short[0].difference_cents, short[0].tolerance_applied_cents], [65250, 60000, 5250, 100]);
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("advance", 65200)] })), [], "50¢ under a $1 tolerance is rounding");
  const over = run({ expected: [expected()], entries: [entry("advance", 70000)] });
  assert.deepEqual([types(over), over[0].difference_cents], [["over_paid"], -4750]);
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("advance", 65300)] })), []);
  assert.equal(short[0].expected_source.schedule_id, "s1", "the rate row behind the expected figure");
  assert.deepEqual(short[0].reported_entry_ids.length, 1, "the ledger lines behind the reported figure");
});

test("nothing is owed on a policy never taken, or lapsed before a single payment", () => {
  assert.deepEqual(types(run({ policies: [policy({ status: "not_taken" })], expected: [expected()] })), []);
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed", monthsPaid: 0, inClawbackWindow: false })], expected: [expected()] })), []);
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed", monthsPaid: 3, inClawbackWindow: false })], expected: [expected()] })), ["missing"], "paid, then lapsed: still owed");
});

test("first-year commission: renewals after the first year are not counted against it", () => {
  const yearOne = Array.from({ length: 12 }, (_, i) => entry("earned", 7250, { transactionDate: `2026-${String(i + 1).padStart(2, "0")}-15` }));
  const renewal = entry("earned", 3000, { transactionDate: "2027-09-15" });
  const at = { policies: [policy({ monthsPaid: 24 })], expected: [expected({ triggerOn: "2026-01-01", expectedAdvanceCents: null })] };
  assert.deepEqual(types(run({ ...at, entries: [...yearOne, renewal] })), [], "87,000 in year one; the renewal is not an over-payment");
  assert.deepEqual(types(run({ ...at, entries: yearOne.slice(1) })), ["short_paid"]);
});

test("a line a reprocess reversed does not count as paid", () => {
  const paid = entry("advance", 65250);
  assert.deepEqual(types(run({ expected: [expected()], entries: [paid, entry("reversal", -65250, { correctsType: "advance", reversesEntryId: paid.id })] })), ["missing"]);
});

test("mis-rated: a line at another rate, or on another premium beyond tolerance", () => {
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("advance", 65250, { rateBp: 13000 })] })), ["mis_rated"]);
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("advance", 65250, { rateBp: 14500, commissionablePremiumCents: 60050 })] })), [], "same rate, premium within tolerance");
  assert.deepEqual(types(run({ expected: [expected()], entries: [entry("advance", 65250, { commissionablePremiumCents: 54000 })] })), ["mis_rated"]);
});

test("the rate-dependent three stay silent without a rate card", () => {
  const noRate = expected({ confidence: "no_rate_card", expectedAmountCents: null, expectedAdvanceCents: null, scheduleId: null, rateBp: null, premiumCents: null });
  assert.deepEqual(types(run({ expected: [noRate], entries: [entry("advance", 1, { rateBp: 1 })] })), []);
});

test("duplicate chargeback: two of the same size inside one lapse; not two different, not a year apart", () => {
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed" })], entries: [entry("advance", 55295), entry("chargeback", -43006, { transactionDate: "2026-09-01" }), entry("chargeback", -43006, { transactionDate: "2026-09-29" })] })), ["duplicate_chargeback"]);
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed" })], entries: [entry("advance", 55295), entry("chargeback", -43006, { transactionDate: "2025-08-01" }), entry("chargeback", -43006, { transactionDate: "2026-09-29" })] })), []);
  // A chargeback a reprocess reversed and re-recorded is one chargeback, not two.
  const first = entry("chargeback", -43006, { transactionDate: "2026-09-01" });
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed" })], entries: [entry("advance", 55295), first, entry("reversal", 43006, { correctsType: "chargeback", reversesEntryId: first.id, transactionDate: "2026-09-01" }), entry("chargeback", -43006, { transactionDate: "2026-09-01" })] })), []);
});

test("unexpected chargeback: on an active policy only, and it names all three causes without blaming the carrier", () => {
  const found = run({ entries: [entry("advance", 55295), entry("chargeback", -43006)] });
  assert.deepEqual(types(found), ["unexpected_chargeback"]);
  assert.deepEqual(found[0].evidence.causes, ["the policy file is out of date", "a carrier error", "the chargeback belongs to another policy"]);
  assert.match(found[0].explanation, /only one is the carrier's mistake/);
  assert.doesNotMatch(found[0].explanation, /the carrier is wrong|carrier error\./i);
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed", inClawbackWindow: false })], entries: [entry("advance", 55295), entry("chargeback", -43006)] })), []);
});

test("missing chargeback: lapsed in the window with an advance standing — a warning, not a claim", () => {
  const coming = run({ policies: [policy({ status: "lapsed", lapsedOn: "2026-09-20" })], entries: [entry("advance", 55295)] });
  assert.deepEqual(types(coming), ["missing_chargeback"]);
  assert.equal(coming[0].severity, "info");
  assert.equal(coming[0].expected_amount_cents, -43007, "7/9 of $552.95 still unearned after 2 months");
  assert.match(coming[0].explanation, /it is coming.*Don't count on that money/);
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed" })], entries: [entry("advance", 55295), entry("chargeback", -43006)] })), [], "already taken");
  assert.deepEqual(types(run({ policies: [policy({ status: "lapsed", inClawbackWindow: false })], entries: [entry("advance", 55295)] })), [], "outside the window");
});

test("held building up: rising and under the minimum, worded as withheld, not missing", () => {
  const found = run({ statements: [stmt("2026-09-04", 0, { heldCents: 300, minimumPayoutCents: 2500 }), stmt("2026-09-11", 0, { heldCents: 700, minimumPayoutCents: 2500 })] });
  assert.deepEqual(types(found), ["held_building_up"]);
  assert.match(found[0].explanation, /withheld, not missing.*Nothing to chase/);
  assert.equal(found[0].policy_number, null);
  assert.deepEqual(types(run({ statements: [stmt("2026-09-04", 0, { heldCents: 700 }), stmt("2026-09-11", 0, { heldCents: 300 })] })), [], "falling: being paid out");
});

test("debit balance growing: negative and worse than last time; a debit being worked off is not flagged", () => {
  assert.deepEqual(types(run({ statements: [stmt("2026-09-04", -10000), stmt("2026-09-11", -12000)] })), ["debit_balance_growing"]);
  assert.deepEqual(types(run({ statements: [stmt("2026-09-04", -12000), stmt("2026-09-11", -10000)] })), []);
});

test("the summary separates owed, coming back and held; the migration keeps findings stable", () => {
  const s = moneySummary([
    { discrepancy_type: "missing", difference_cents: 87000, expected_amount_cents: 87000, reported_amount_cents: 0, status: "open" },
    { discrepancy_type: "missing", difference_cents: null, expected_amount_cents: null, reported_amount_cents: 0, status: "open" },
    { discrepancy_type: "over_paid", difference_cents: -4750, expected_amount_cents: 65250, reported_amount_cents: 70000, status: "open" },
    { discrepancy_type: "missing_chargeback", difference_cents: null, expected_amount_cents: -43007, reported_amount_cents: 0, status: "open" },
    { discrepancy_type: "held_building_up", difference_cents: null, expected_amount_cents: null, reported_amount_cents: 700, status: "open" },
    { discrepancy_type: "short_paid", difference_cents: 5250, expected_amount_cents: 65250, reported_amount_cents: 60000, status: "dismissed" },
  ]);
  assert.deepEqual([s.owedCents, s.comingBackCents, s.heldCents, s.unpricedMissing], [87000, 43007, 700, 1]);
  // Nine LA-4.15 kinds, and LA-7.6's "paid but not received".
  assert.equal(DISCREPANCY_TYPES.length, 10);
  assert.match(sql, /constraint commission_discrepancy_key unique \(tenant_id, carrier_id, discrepancy_type, subject_key, policy_year\)/);
  assert.match(sql, /'Resolved itself: the commission arrived\.'/);
  assert.match(sql, /A sent dispute letter never changes; draft a new one\./);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.commission_discrepancy from service_role, tenant_app/);
});

test("the letter: exact figures from the records, only the items worth disputing, a plain total", async () => {
  const { letterText, claimed } = await import("./disputeLetter.ts");
  const party = { agencyName: "Demo Agency", agencyAddress: "1 Main St, Austin TX", npn: "123", writingNumber: "W-77", carrierName: "Aetna", recipient: null, signer: { name: "Ray Demo", email: "ray@example.test", phone: null }, today: "2026-10-08" };
  const item = (over) => ({ id: "x", type: "short_paid", policyNumber: "P1", expectedCents: 65250, reportedCents: 60000, differenceCents: 5250, toleranceCents: 100, expectedSource: { rate_bp: 14500, commissionable_premium_cents: 60000, schedule_version: "2026-01-01" }, evidence: {}, lines: 1, ...over });
  const { body, totalCents } = letterText(party, [item(), item({ id: "y", type: "missing", policyNumber: "P2", expectedCents: 87000, reportedCents: 0, differenceCents: 87000, evidence: { trigger: "on_issue", trigger_on: "2026-08-01", overdue_from: "2026-08-22" } }), item({ id: "z", type: "held_building_up", policyNumber: null, differenceCents: null })]);
  assert.equal(totalCents, 92250);
  assert.match(body, /Re: Commission discrepancies - writing number W-77/);
  assert.match(body, /P1\s+Paid short\s+\$652\.50\s+\$600\.00\s+\$52\.50/);
  assert.match(body, /Expected at 145% of \$600\.00 \(commission schedule effective January 1, 2026\)\. Differences of \$1\.00 or less are treated as rounding\./);
  assert.match(body, /No commission line received by August 22, 2026; the policy issued on August 1, 2026\./);
  assert.match(body, /Total owed\s+\$922\.50/);
  assert.doesNotMatch(body, /Held, building up/, "held money is never argued");
  assert.match(body, /Aetna\nCommissions Department/, "no saved address: the carrier's commissions department");
  assert.equal(claimed({ type: "short_paid", differenceCents: -4750 }), 0, "an overpayment is never claimed");
  assert.equal(claimed({ type: "unexpected_chargeback", differenceCents: 43006 }), 0, "an unexpected chargeback asks; it claims nothing");
  const asked = letterText(party, [item(), item({ id: "u", type: "unexpected_chargeback", policyNumber: "P3", expectedCents: 0, reportedCents: -43006, differenceCents: 43006 })]);
  assert.equal(asked.totalCents, 5250, "the letter total leaves the unexpected chargeback out");
  assert.match(asked.body, /P3\s+Chargeback on an active policy/, "it is still on the letter, as a question");
});
test("duplicate chargeback means the same lapse taken twice, not equal monthly instalments", () => {
  const lapsed = { policies: [policy({ status: "lapsed", inClawbackWindow: true, lapsedOn: "2026-08-25" })] };
  // A $552.95 advance taken back in three equal instalments: one lapse, recovered over three months.
  const instalments = [entry("advance", 55295), ...["2026-09-01", "2026-10-01", "2026-11-01"].map((d) => entry("chargeback", -18432, { transactionDate: d }))];
  assert.deepEqual(types(run({ ...lapsed, entries: instalments })), [], "equal instalments that never exceed the advance");
  // With no advance on the ledger, equal chargebacks a month apart say nothing either.
  assert.deepEqual(types(run({ ...lapsed, entries: [entry("chargeback", -18432, { transactionDate: "2026-09-01" }), entry("chargeback", -18432, { transactionDate: "2026-10-01" })] })), []);
  // The same chargeback recorded twice on one day is one lapse taken twice, advance or not.
  const sameDay = run({ ...lapsed, entries: [entry("chargeback", -18432, { transactionDate: "2026-09-01" }), entry("chargeback", -18432, { transactionDate: "2026-09-01" })] });
  assert.deepEqual(types(sameDay), ["duplicate_chargeback"]);
  assert.equal(sameDay[0].difference_cents, 18432);
  // Taking back more than was advanced: owed is what was taken twice, never more than the second line.
  const over = run({ ...lapsed, entries: [entry("advance", 55295), entry("chargeback", -43006, { transactionDate: "2026-09-01" }), entry("chargeback", -43006, { transactionDate: "2026-09-29" })] });
  assert.deepEqual(types(over), ["duplicate_chargeback"]);
  assert.equal(over[0].difference_cents, 86012 - 55295, "the excess over the advance");
  assert.equal(moneySummary(over.map((f) => ({ ...f, status: "open" }))).owedCents, 30717, "the owed total follows the excess");
});

test("you appear to be owed: an unexpected chargeback is never counted", () => {
  const found = run({ entries: [entry("advance", 55295), entry("chargeback", -43006)] });
  assert.deepEqual(types(found), ["unexpected_chargeback"]);
  assert.equal(moneySummary(found.map((f) => ({ ...f, status: "open" }))).owedCents, 0);
});

test("each policy year is compared with that year's lines only", () => {
  const years = { policies: [policy({ monthsPaid: 3 })], expected: [expected({ triggerOn: "2026-01-10", overdueFrom: "2026-02-10" })] };
  // A payment that came in the second policy year does not pay the first.
  assert.deepEqual(types(run({ ...years, entries: [entry("earned", 7250, { transactionDate: "2027-02-01", statementDate: "2027-02-01" })] })), ["missing"]);
  assert.deepEqual(types(run({ ...years, entries: [entry("advance", 65250, { transactionDate: "2026-02-01", statementDate: "2026-02-01" })] })), []);
  // A year-2 figure is checked against year-2 lines: the year-1 advance does not hide a short year 2.
  const two = { policies: [policy({ monthsPaid: 26 })], expected: [expected({ policyYear: 2, triggerOn: "2025-01-10", overdueFrom: "2025-02-10", expectedAdvanceCents: null, expectedAmountCents: 20000 })] };
  const y1 = entry("advance", 65250, { transactionDate: "2025-02-01", statementDate: "2025-02-01" });
  assert.deepEqual(types(run({ ...two, entries: [y1] })), ["missing"], "nothing in year 2");
  const short = run({ ...two, entries: [y1, ...Array.from({ length: 12 }, (_, i) => entry("earned", 1000, { transactionDate: `2026-${String(i + 1).padStart(2, "0")}-20`, statementDate: null }))] });
  assert.deepEqual(types(short), ["short_paid"]);
  assert.equal(short[0].reported_amount_cents, 12000, "year 2's lines only (Jan 10 2026 – Jan 9 2027)");
  assert.match(short[0].explanation, /Policy year 2's commission should be/);
});
