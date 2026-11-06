// Run with: node --experimental-strip-types --test lib/dashboard/views/accounting.test.mjs
//
// The dashboard's Accounting view (owner 2026-11-06): the pure shaping between the P&L, bank, bills, payout
// and producer reads and the cards. Integer cents throughout; nothing invented for a month with no rows.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  localToday, monthStart, monthLabel, shortDate, wholeDollars, monthlyInOut, whereMoneyWent, receivedShare,
  producerBalances, owedToProducers, recentMoney, pnlMonthHref,
} from "./accounting.ts";

test("today is the agency's day, and months step across a year end", () => {
  const now = Date.parse("2026-11-01T03:00:00Z");
  assert.equal(localToday(now, "America/New_York"), "2026-10-31");
  assert.equal(localToday(now, "Not/AZone"), "2026-11-01");
  assert.equal(monthStart("2026-11-06"), "2026-11-01");
  assert.equal(monthStart("2026-11-06", 2), "2027-01-01");
  assert.equal(monthStart("2026-01-15", -1), "2025-12-01");
  assert.equal(monthLabel("2026-11-01", true), "November 2026");
  assert.equal(monthLabel("2026-11-01"), "Nov");
  assert.equal(shortDate("2026-11-04"), "Nov 4");
  assert.equal(shortDate(null), undefined);
});

test("whole dollars round half up in integers and keep the sign", () => {
  assert.equal(wholeDollars(1234550), "$12,346");
  assert.equal(wholeDollars(1234549), "$12,345");
  assert.equal(wholeDollars(-25000), "-$250");
  assert.equal(wholeDollars(-40), "$0");
  assert.equal(wholeDollars(0), "$0");
});

test("the monthly trend fills every month and turns costs into money out", () => {
  const months = ["2026-09-01", "2026-10-01", "2026-11-01"];
  const rows = [
    { month: "2026-09-01", section: "in", amountCents: 500000 },
    { month: "2026-09-01", section: "in", amountCents: -20000 },
    { month: "2026-09-01", section: "acquisition", amountCents: -100000 },
    { month: "2026-09-01", section: "overhead", amountCents: -30000 },
    { month: "2026-09-01", section: "splits", amountCents: -150000 },
    { month: "2026-11-01", section: "in", amountCents: -5000 },
    { month: "2026-08-01", section: "in", amountCents: 999 },
    { month: "2026-11-01", section: "held", amountCents: 70000 },
  ];
  assert.deepEqual(monthlyInOut(rows, months), [
    { month: "2026-09-01", label: "Sep", inCents: 480000, outCents: 280000 },
    { month: "2026-10-01", label: "Oct", inCents: 0, outCents: 0 },
    { month: "2026-11-01", label: "Nov", inCents: 0, outCents: 0 },
  ]);
});

test("where the money went splits lead spend from other costs and keeps a loss as a loss", () => {
  const s = {
    inCents: 1000000, splitsCents: -400000, acquisitionCents: -350000, overheadCents: -100000, netProfitCents: 150000,
    acquisition: [{ entryType: "lead_cost", amountCents: -300000 }, { entryType: "lead_cost", amountCents: -20000 }, { entryType: "expense", amountCents: -30000 }],
  };
  assert.deepEqual(whereMoneyWent(s).map((b) => [b.key, b.label, b.cents, b.tone]), [
    ["in", "Commission in", 1000000, "good"],
    ["producers", "Paid to producers", 400000, "info"],
    ["leads", "Lead spend", 320000, "warning"],
    ["other", "Other costs", 130000, "neutral"],
    ["profit", "Profit", 150000, "good"],
  ]);
  const loss = whereMoneyWent({ ...s, netProfitCents: -5000 }).at(-1);
  assert.deepEqual([loss.label, loss.cents, loss.tone], ["Loss", -5000, "danger"]);
});

test("received of reported is a whole percent, and nothing when there is no bank data or nothing reported", () => {
  assert.equal(receivedShare(300000, 200000), 66);
  assert.equal(receivedShare(300000, 330000), 110);
  assert.equal(receivedShare(300000, null), null);
  assert.equal(receivedShare(0, 100), null);
  assert.equal(receivedShare(-500, 100), null);
});

test("producer balances: largest either way first, owed and owes back apart, zero balances out", () => {
  const rows = [
    { producerUserId: "a", balanceCents: 12000 },
    { producerUserId: "b", balanceCents: -50000 },
    { producerUserId: "c", balanceCents: 0 },
    { producerUserId: "d", balanceCents: 30000 },
  ];
  const names = new Map([["a", "Ana"], ["b", "Bo"]]);
  assert.deepEqual(producerBalances(rows, names), [
    { userId: "b", name: "Bo", owedCents: 0, owesBackCents: 50000 },
    { userId: "d", name: "Producer", owedCents: 30000, owesBackCents: 0 },
    { userId: "a", name: "Ana", owedCents: 12000, owesBackCents: 0 },
  ]);
  assert.equal(producerBalances(rows, names, 1).length, 1);
  assert.equal(owedToProducers(rows), 42000);
});

test("recent money: newest first, void left out, each to its own record, nothing from a closed page", () => {
  const hrefs = { bank: "/app/bank", bills: "/app/vendor-bills", payouts: "/app/payouts", producerPayouts: "/app/producer-payouts" };
  const input = {
    deposits: [
      { id: "t1", postedOn: "2026-11-05", amountCents: 120000, description: "CARRIER ACH", status: "unmatched" },
      { id: "t2", postedOn: "2026-11-01", amountCents: 80000, description: "", status: "matched" },
    ],
    bills: [
      { id: "i1", sourceName: "LeadCo", invoiceNumber: "INV-9", invoiceDate: "2026-11-03", totalCents: 45000, status: "received", paidOn: null },
      { id: "i2", sourceName: "Gone", invoiceNumber: "INV-1", invoiceDate: "2026-11-06", totalCents: 1, status: "void", paidOn: null },
    ],
    partnerRuns: [{ id: "p1", partnerName: "Pub", periodEnd: "2026-10-31", status: "draft", netCents: 9000, paidOn: null, publishedAt: null }],
    producerRuns: [{ id: "r1", producerUserId: "a", periodEnd: "2026-10-31", status: "paid", netCents: 30000, paidOn: "2026-11-04" }],
    names: new Map([["a", "Ana"]]),
    hrefs,
  };
  const items = recentMoney(input);
  assert.deepEqual(items.map((i) => [i.key, i.href, i.cents, i.tone]), [
    ["deposit-t1", "/app/bank", 120000, "warning"],
    ["run-r1", "/app/producer-statements/r1", -30000, "neutral"],
    ["bill-i1", "/app/vendor-bills/i1", -45000, "warning"],
    ["deposit-t2", "/app/bank", 80000, "good"],
    ["prun-p1", "/app/payouts/p1", -9000, "warning"],
  ]);
  assert.equal(items[0].title, "Deposit to match");
  assert.equal(items[3].detail, "Bank deposit");
  assert.equal(items[1].title, "Pay to Ana");
  assert.equal(recentMoney(input, 2).length, 2);
  const closed = recentMoney({ ...input, hrefs: { ...hrefs, bank: null, producerPayouts: null } });
  assert.ok(closed.every((i) => i.kind !== "deposit" && i.kind !== "producerRun"));
});

test("a month's P&L address carries the period and the basis", () => {
  assert.equal(pnlMonthHref("/app/pnl", "2026-11-01", "cash"), "/app/pnl?kind=month&basis=cash&anchor=2026-11-01");
});
