// Bank deposits › Results (owner's Accounting doc, "The Bank Matchmaker", 2026-11-07).
// Run with: node --experimental-strip-types --test lib/accounting/bankResults.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { addDays, closestDeposit, depositFilterOf, depositNextStep, inPaymentFilter, lagWords, legacyBankAddress, manualAmountProblem, moneyState, orderPayments, paymentHref, paymentNextStep, paymentsFrom, paymentVerdict, policyState, readableDay, readPaymentsFrom, resultsSummary, shortBy, shortDay } from "./bankResultsCore.ts";

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

test("round 7 (1·B): Payments · Deposits · Accounts, and every old address still lands", () => {
  const page = read("app/app/(shell)/bank/page.tsx");
  assert.match(page, /const TABS: BankTab\[\] = \["payments", "deposits", "accounts"\]/);
  assert.match(page, /const moved = legacyBankAddress\(q\);\n\s+if \(moved\) redirect\(moved\);/);
  assert.equal(legacyBankAddress({ view: "results", period: "30", show: "bad_math" }), "/app/bank?view=payments&period=30&show=bad_math");
  assert.equal(legacyBankAddress({ view: "queue" }), "/app/bank?view=deposits&show=to_match");
  assert.equal(legacyBankAddress({ view: "unexplained" }), "/app/bank?view=deposits&show=to_match");
  assert.equal(legacyBankAddress({ view: "not_received" }), "/app/bank?view=payments&show=missing_money");
  assert.equal(legacyBankAddress({ view: "deposits" }), null);
  // To do links straight to a deposit's Match dialog.
  assert.match(page, /openId=\{q\.match\}/);
  assert.match(read("lib/accounting/bankStore.ts"), /export async function paymentResults\(/);
});

test("round 7: words, order and the walk between payments", () => {
  assert.equal(readableDay("2026-09-05"), "Sep 5, 2026");
  assert.equal(shortDay("2026-10-22"), "Oct 22");
  const rows = [
    { id: "a", verdict: "all_good", statementDate: "2026-10-15" },
    { id: "b", verdict: "bad_math", statementDate: "2026-09-01" },
    { id: "c", verdict: "missing_money", statementDate: "2026-10-01" },
    { id: "d", verdict: "bad_math", statementDate: "2026-09-15" },
  ];
  assert.deepEqual(orderPayments(rows).map((r) => r.id), ["c", "d", "b", "a"], "worst first, newest first within");
  assert.equal(inPaymentFilter("to_confirm", "waiting"), true);
  assert.equal(inPaymentFilter("rate_missing", "waiting"), false);
  assert.equal(paymentNextStep({ verdict: "missing_money", carrierName: "Americo", dueBy: "2026-10-22", shortPolicies: 0 }), "Ask Americo where it went");
  assert.equal(paymentNextStep({ verdict: "bad_math", carrierName: "Aflac", dueBy: "2026-09-22", shortPolicies: 8 }), "Review 8 short policies");
  assert.equal(paymentNextStep({ verdict: "all_good", carrierName: "x", dueBy: "2026-09-22", shortPolicies: 0 }), null);
  assert.deepEqual(readPaymentsFrom(paymentsFrom("30", "bad_math")), { period: "30", filter: "bad_math" });
  assert.deepEqual(readPaymentsFrom(undefined), { period: "90", filter: "all" });
  assert.equal(paymentHref("s1", "period=90"), "/app/bank/payments/s1?from=period%3D90");
});

test("round 7: a deposit's state and next step; a manual match never exceeds the deposit", () => {
  assert.equal(depositFilterOf("suggested"), "to_match");
  assert.equal(depositFilterOf("partially_matched"), "to_match");
  assert.equal(depositFilterOf("matched"), "matched");
  assert.equal(depositFilterOf("ignored"), "ignored");
  assert.equal(depositNextStep({ status: "suggested", pending: 1 }), "Confirm the match");
  assert.equal(depositNextStep({ status: "unmatched", pending: 0 }), "Match it, or mark it not carrier money");
  assert.equal(depositNextStep({ status: "matched", pending: 0 }), null);
  assert.equal(manualAmountProblem(30000, 25000), "More than the deposit ($250.00).");
  assert.equal(manualAmountProblem(25000, 25000), null);
  assert.equal(manualAmountProblem(null, 25000), "Enter the amount.");
});

test("round 7: nothing decided in a Deposits row; the payment page is the title alone", () => {
  const board = read("components/app/accounting/bank-board.tsx");
  const deposits = board.slice(board.indexOf("export function DepositsBoard"), board.indexOf("/** \"Date"));
  assert.doesNotMatch(deposits, /<Button\b/, "a Deposits row holds no button: it opens the Match dialog");
  const match = read("components/app/accounting/bank-match.tsx");
  for (const words of ["Decline the suggestion", "Match by hand", "It isn&apos;t carrier money", "Confirm and next ›", "Set it aside", "Unlink this deposit?"]) assert.ok(match.includes(words), words);
  const payment = read("app/app/(shell)/bank/payments/[id]/page.tsx");
  assert.doesNotMatch(payment, /\n\s+facts=\{/, "no facts line");
  assert.match(payment, /title=\{`\$\{p\.carrierName\} · \$\{readableDay\(p\.statementDate\)\} statement`\}/);
  assert.match(payment, /<RecordStepper previous=\{previous\} next=\{next\} noun="payment" \/>/);
  assert.doesNotMatch(read("app/app/(shell)/bank/check/page.tsx"), />Cancel</, "Check a payment has nothing to cancel");
});

test("a deposit is looked for up to 3 days after the carrier's date, by default (owner's Accounting doc)", () => {
  assert.match(read("lib/accounting/settingsCore.ts"), /bankWindowDays: 3,/);
  const sql = read("supabase/migrations/20261108100000_bank_window_three_days.sql");
  assert.match(sql, /alter column bank_window_days set default 3;/);
  assert.match(read("lib/accounting/steps.ts"), /label: "Team payouts", href: "\/app\/producer-payouts"/);
});
