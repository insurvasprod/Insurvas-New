// Bank deposits › Results (owner's Accounting doc, "The Bank Matchmaker", 2026-11-07).
// Run with: node --experimental-strip-types --test lib/accounting/bankResults.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { addDays, closestDeposit, lagWords, moneyState, paymentVerdict, policyState, resultsSummary, shortBy } from "./bankResultsCore.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const base = { paidCents: 200000, confirmedCents: 0, suggestedCents: 0, statementDate: "2026-11-01", windowDays: 3, toleranceCents: 0, today: "2026-11-07", bankThrough: "2026-11-06" };

test("did the money land: landed, to confirm, waiting, missing", () => {
  assert.equal(moneyState({ ...base, confirmedCents: 200000 }).state, "landed");
  assert.equal(moneyState({ ...base, confirmedCents: 199900, toleranceCents: 100 }).state, "landed", "within the agency's tolerance");
  assert.equal(moneyState({ ...base, suggestedCents: 200000 }).state, "to_confirm", "a suggestion is not money landed until a person confirms it");
  assert.deepEqual(moneyState(base), { state: "missing", dueBy: "2026-11-04", missingCents: 200000 });
  assert.equal(moneyState({ ...base, today: "2026-11-03" }).state, "waiting", "still inside the window");
  assert.equal(moneyState({ ...base, bankThrough: "2026-11-02" }).state, "waiting", "the bank file doesn't reach the due date yet: not an alarm");
  assert.equal(moneyState({ ...base, bankThrough: null }).state, "waiting", "no bank file at all: not an alarm");
  assert.deepEqual(moneyState({ ...base, confirmedCents: 120000 }), { state: "missing", dueBy: "2026-11-04", missingCents: 80000 }, "part landed: the rest is missing");
});

test("each policy against the promise", () => {
  const finding = (type) => ({ finding: { type, expectedCents: 50000, reportedCents: 40000, differenceCents: -10000 }, expected: { rateBp: 10000, amountCents: 50000 } });
  assert.equal(policyState(finding("short_paid")), "short");
  assert.equal(policyState(finding("mis_rated")), "short", "paid at the wrong rate (80% for 100%) is short");
  assert.equal(policyState(finding("over_paid")), "over");
  assert.equal(policyState({ finding: { type: "mis_rated", expectedCents: 37552, reportedCents: 112655, differenceCents: -75103 }, expected: null }), "over", "paid at 120% for a 40% promise is over, not bad math");
  assert.equal(policyState({ finding: null, expected: { rateBp: 10000, amountCents: 50000 } }), "ok");
  assert.equal(policyState({ finding: null, expected: null }), "no_promise");
  assert.equal(policyState({ finding: null, expected: { rateBp: null, amountCents: null } }), "no_promise", "no rate card is never shown as right");
  assert.equal(shortBy({ finding: { type: "mis_rated", expectedCents: 50000, reportedCents: 40000, differenceCents: 10000 }, expected: null }), 10000);
  assert.equal(shortBy({ finding: { type: "missing", expectedCents: 30104, reportedCents: 0, differenceCents: 29104 }, expected: null }), 29104, "the finding's own difference wins, as on the dispute letter");
  assert.equal(policyState({ finding: { type: "missing", expectedCents: 30104, reportedCents: null, differenceCents: null }, expected: null }), "short", "owed and paid nothing is bad math");
  assert.equal(shortBy({ finding: { type: "missing", expectedCents: 30104, reportedCents: null, differenceCents: null }, expected: null }), 30104);
});

test("one verdict per payment: missing money first, then bad math", () => {
  assert.equal(paymentVerdict("missing", ["short"]), "missing_money");
  assert.equal(paymentVerdict("landed", ["ok", "short"]), "bad_math");
  assert.equal(paymentVerdict("waiting", ["short"]), "bad_math", "bad math is known before the deposit is");
  assert.equal(paymentVerdict("to_confirm", ["ok"]), "to_confirm");
  assert.equal(paymentVerdict("waiting", ["ok"]), "waiting");
  assert.equal(paymentVerdict("landed", ["ok", "no_promise"]), "rate_missing");
  assert.equal(paymentVerdict("landed", ["ok", "over"]), "all_good");
  assert.equal(paymentVerdict("landed", []), "all_good");
});

test("the strip adds up", () => {
  const s = resultsSummary([
    { verdict: "all_good", paidCents: 219000, missingCents: 0, shortCents: 0 },
    { verdict: "missing_money", paidCents: 186000, missingCents: 186000, shortCents: 0 },
    { verdict: "bad_math", paidCents: 200000, missingCents: 0, shortCents: 10000 },
  ]);
  assert.deepEqual(s, { checked: 3, checkedCents: 605000, good: 1, goodCents: 219000, missing: 1, missingCents: 186000, badMath: 1, shortCents: 10000 });
});

test("dates and the closest deposit", () => {
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(lagWords("2026-11-01", "2026-11-01"), "same day");
  assert.equal(lagWords("2026-11-01", "2026-11-03"), "2 days after");
  const near = closestDeposit([{ postedOn: "2026-11-04", amountCents: 168000 }, { postedOn: "2026-11-05", amountCents: 50000 }, { postedOn: "2026-10-30", amountCents: 186000 }], "2026-11-03", 186000, 3);
  assert.deepEqual(near, { postedOn: "2026-11-04", amountCents: 168000 }, "only deposits on or after the carrier's date");
});

test("Results is the first tab; Not received lands on it", () => {
  const page = read("app/app/(shell)/bank/page.tsx");
  assert.match(page, /const VIEWS: PageView\[\] = \["results", "queue", "unexplained", "accounts"\]/);
  assert.match(page, /if \(q\.view === "not_received"\) redirect\("\/app\/bank\?view=results&show=missing_money"\)/);
  assert.match(read("lib/accounting/bankStore.ts"), /export async function paymentResults\(/);
});

test("a deposit is looked for up to 3 days after the carrier's date, by default (owner's Accounting doc)", () => {
  assert.match(read("lib/accounting/settingsCore.ts"), /bankWindowDays: 3,/);
  const sql = read("supabase/migrations/20261108100000_bank_window_three_days.sql");
  assert.match(sql, /alter column bank_window_days set default 3;/);
  assert.match(read("lib/accounting/steps.ts"), /label: "Team payouts", href: "\/app\/producer-payouts"/);
});
