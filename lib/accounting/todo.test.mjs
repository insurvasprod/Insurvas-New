// Accounting › To do (round 7, owner 2026-11-10: docs/la4/mockups-r7/accounting.html 0·1).
// Run with: node --experimental-strip-types --test lib/accounting/todo.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { atStakeCents, billItems, depositItems, expenseItems, isTodoGroup, orderTodo, paymentItems, payoutItems, taxItems, todoCounts } from "./todoCore.ts";

const money = (c) => `$${(c / 100).toFixed(2)}`;

test("a carrier payment with bad math or missing money is a row that opens its payment page", () => {
  const rows = paymentItems([
    { id: "p1", carrierName: "Aflac", statementDate: "2026-09-01", statementLabel: "1 Sep 2026", verdict: "bad_math", shortCents: 340441, missingCents: 0, shortPolicies: 8, dueBy: "2026-09-22", dueByLabel: "22 Sep" },
    { id: "p2", carrierName: "Americo", statementDate: "2026-10-01", statementLabel: "1 Oct 2026", verdict: "missing_money", shortCents: 0, missingCents: 121200, shortPolicies: 0, dueBy: "2026-10-22", dueByLabel: "22 Oct" },
    { id: "p3", carrierName: "Mutual of Omaha", statementDate: "2026-10-01", statementLabel: "1 Oct 2026", verdict: "all_good", shortCents: 0, missingCents: 0, shortPolicies: 0, dueBy: "2026-10-22", dueByLabel: "22 Oct" },
  ]);
  assert.equal(rows.length, 2, "all good payments wait on nobody");
  assert.equal(rows[0].what, "Bad math · Aflac");
  assert.equal(rows[0].next, "Review 8 short policies");
  assert.equal(rows[0].href, "/app/bank/payments/p1");
  assert.equal(rows[1].next, "Ask Americo where it went");
  assert.equal(rows[1].since, "2026-10-22", "missing money waits from the day it was due");
});

test("a deposit opens its Match dialog; a suggestion reads Confirm, nothing explains reads Match it", () => {
  const rows = depositItems([
    { id: "t1", postedOn: "2026-11-06", amountCents: 81240, descriptionRaw: "AMERITAS LIFE COMM PMT", status: "suggested", suggestedFor: "Ameritas 31 Oct" },
    { id: "t2", postedOn: "2026-10-28", amountCents: 25000, descriptionRaw: "ZELLE FROM J SMITH", status: "unmatched", suggestedFor: null },
  ]);
  assert.equal(rows[0].next, "Confirm the match");
  assert.equal(rows[0].href, "/app/bank?view=deposits&match=t1");
  assert.equal(rows[1].what, "Deposit nothing explains");
});

test("bills: received to approve, approved to pay, disputed waits on the vendor (not yours)", () => {
  const rows = billItems([
    { id: "b1", sourceName: "Summit", invoiceNumber: "SLL-2609", invoiceDate: "2026-10-04", dueDate: null, dueLabel: null, totalCents: 45000, status: "received", flagged: false, differenceCents: null, periodLabel: "1 Sep – 30 Sep 2026" },
    { id: "b2", sourceName: "Bayview", invoiceNumber: "BVD-0930", invoiceDate: "2026-10-03", dueDate: null, dueLabel: null, totalCents: 266000, status: "disputed", flagged: false, differenceCents: null, periodLabel: null },
    { id: "b3", sourceName: "Crestview", invoiceNumber: "CVL-10442", invoiceDate: "2026-10-02", dueDate: "2026-11-15", dueLabel: "15 Nov", totalCents: 183000, status: "approved", flagged: true, differenceCents: 27000, periodLabel: null },
    { id: "b4", sourceName: "Old", invoiceNumber: "X", invoiceDate: "2026-08-01", dueDate: null, dueLabel: null, totalCents: 100, status: "paid", flagged: false, differenceCents: null, periodLabel: null },
  ], money);
  assert.equal(rows.length, 3, "a paid bill waits on nobody");
  assert.equal(rows[0].next, "Check it, then approve");
  assert.equal(rows[1].yours, false);
  assert.match(rows[2].detail, /billed \$270\.00 more than you got/);
  assert.equal(rows[2].sinceLabel, "due 15 Nov");
});

test("expenses, payout drafts (one row for all) and 1099 details", () => {
  const exp = expenseItems([{ id: "e1", name: "CloseRight CRM", bucketLabel: "Subscriptions", monthLabel: "Nov 2026", amountCents: 34900, incurredOn: "2026-11-01" }]);
  assert.equal(exp[0].href, "/app/expenses/e1");
  assert.deepEqual(payoutItems([]), []);
  const pay = payoutItems([{ netCents: 10000, createdOn: "2026-10-31" }, { netCents: 5000, createdOn: "2026-10-15" }]);
  assert.equal(pay.length, 1);
  assert.equal(pay[0].detail, "2 drafts");
  assert.equal(pay[0].since, "2026-10-15");
  const tax = taxItems([
    { payeeType: "producer", payeeId: "u1", nameOnForm: "Marisol Vance", missing: ["W-9"], paidCents: 82497 },
    { payeeType: "vendor", payeeId: "v1", nameOnForm: "Oakridge", missing: ["W-9", "tax ID", "legal name"], paidCents: 60000 },
    { payeeType: "partner", payeeId: "p1", nameOnForm: "Apex", missing: [], paidCents: 185500 },
  ], 2026);
  assert.equal(tax.length, 2);
  assert.equal(tax[0].href, "/app/tax/payee/producer/u1?year=2026&tab=w9");
  assert.equal(tax[1].next, "Add the details");
});

test("oldest first, undated last; counts per group; the amount at stake", () => {
  const items = orderTodo([
    ...taxItems([{ payeeType: "producer", payeeId: "u1", nameOnForm: "M", missing: ["W-9"], paidCents: 100 }], 2026),
    ...expenseItems([{ id: "e1", name: "CRM", bucketLabel: "Subscriptions", monthLabel: "Nov 2026", amountCents: 34900, incurredOn: "2026-11-01" }]),
    ...depositItems([{ id: "t2", postedOn: "2026-10-28", amountCents: -25000, descriptionRaw: "Z", status: "unmatched", suggestedFor: null }]),
  ]);
  assert.deepEqual(items.map((i) => i.group), ["bank", "expenses", "tax"]);
  assert.deepEqual(todoCounts(items), { all: 3, bank: 1, bills: 0, expenses: 1, payouts: 0, tax: 1 });
  assert.equal(atStakeCents(items), 100 + 34900 + 25000);
  assert.equal(isTodoGroup("bank"), true);
  assert.equal(isTodoGroup("pnl"), false);
});
