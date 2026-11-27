import { billChip, billFacts, isAgencyAdvance, methodLabel, payKind, chargebackLine, dayWeek, draftPay, earnedLine, kindsLine, myPaySummary, ordinal, parseDay, parseDollars, payDay, paymentChip, shortMoney, statementCounts, statementGroups, suggestCategory, teamDraft, teamPayoutBody, teamWhy, todoChip, todoOpens, wholeMoney } from "../logic";
import type { MyPay, PayEntry, PreviewPerson, StatementLine } from "../types";

/** The Money screens' rules, read the way the web reads the same answers. */

const entry = (over: Partial<PayEntry>): PayEntry => ({ id: Math.random().toString(36), entryType: "split_advance", basis: "reported", policyNumber: "P1", carrierName: "AMAM", clientName: "Earl Johnson", amountCents: 10000, occurredOn: "2026-11-03", reason: null, ...over });

test("My pay: this month is earned less what came back, on the payout basis; the rise is against last month", () => {
  const data: MyPay = {
    balances: [],
    entries: [
      entry({ amountCents: 690400, policyNumber: "A1" }),
      entry({ entryType: "split_earned", amountCents: 112050, policyNumber: "A2" }),
      entry({ entryType: "split_chargeback", amountCents: -61200, policyNumber: "A3" }),
      entry({ entryType: "split_paid", amountCents: -500000 }),
      // The other basis is never added in (no double count).
      entry({ basis: "received", amountCents: 999999 }),
      entry({ occurredOn: "2026-10-12", amountCents: 620450 }),
    ],
    runs: [
      { id: "r1", periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "paid", netCents: 620450, withheldCents: 0, paidOn: "2026-11-05" },
      { id: "r0", periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "draft", netCents: 1, withheldCents: 0, paidOn: null },
    ],
  };
  const s = myPaySummary(data, "2026-11-25");
  expect(s.expectedCents).toBe(690400 + 112050 - 61200);
  expect(s.deltaCents).toBe(690400 + 112050 - 61200 - 620450);
  expect(s.advances).toEqual({ cents: 690400, policies: 1 });
  expect(s.chargebacks).toEqual({ cents: -61200, policies: 1 });
  expect(s.bars.map((b) => b.label)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
  expect(s.statements.map((r) => r.id)).toEqual(["r1"]);
  expect(s.paysIn).toBe("December");
});

test("a statement groups its lines as the board does, colour only for what came back", () => {
  const line = (over: Partial<StatementLine>): StatementLine => ({ id: Math.random().toString(36), client: "Dolores King", carrier: "Mutual of Omaha", policy: "P1", premiumCents: null, premiumMode: null, levelBps: null, grossCents: 50130, chargebackCents: null, netCents: 50130, basis: "reported", label: "Share of an advance", ...over });
  const lines = [line({}), line({ policy: "P2", label: "Share of earned commission" }), line({ policy: "P3", grossCents: null, chargebackCents: -37260, netCents: -37260, label: "Share of a chargeback" })];
  expect(statementGroups(lines).map((g) => [g.title, g.lines.length])).toEqual([["Advances", 1], ["Back to the carrier", 1], ["As earned", 1]]);
  expect(statementCounts(lines)).toEqual({ policies: 3, chargedBack: 1 });
});

const person = (over: Partial<PreviewPerson>): PreviewPerson => ({ producerUserId: "u1", displayName: "Ava Kim", status: "active", balanceBeforeCents: 0, earnedCents: 0, chargebackCents: 0, periodCents: 492000, balanceCents: 492000, alreadyRun: false, planModel: "big_split", salaryCents: 0, bonusCents: 0, saveFeeCents: 0, absorbedCount: 0, ...over });

test("team payouts draft as the web does: payable people only, the settings' choice for anyone who owes", () => {
  const drafts = teamDraft([
    person({}),
    person({ producerUserId: "u2", displayName: "Tom Baker", balanceBeforeCents: -30000, periodCents: 154000, balanceCents: 124000 }),
    person({ producerUserId: "u3", displayName: "Owner", planModel: "solo_owner" }),
    person({ producerUserId: "u4", displayName: "Done", alreadyRun: true }),
  ], { negativePolicy: "carry_forward", recoveryPctBp: 2000 });
  expect(drafts.map((d) => [d.person.displayName, d.mode, d.payCents])).toEqual([["Ava Kim", "pay_full", 492000], ["Tom Baker", "withhold", 124000]]);
  expect(draftPay({ beforeCents: -30000, periodCents: 154000 }, "recover", 2000)).toEqual({ payCents: 148000, takenCents: 6000, forgivenCents: 0 });
  const body = teamPayoutBody("2026-10", drafts, { method: "Bank transfer", paidOn: "2026-11-25" }, 2000);
  expect(body).toMatchObject({ from: "2026-10-01", to: "2026-10-31", paidOn: "2026-11-25", method: "Bank transfer" });
  expect(body.decisions[1]).toEqual({ producerUserId: "u2", mode: "withhold", pctBp: null, reason: "Took it all back: owed from before comes off first", method: "Bank transfer", reference: null, paidOn: "2026-11-25" });
});

test("a To do row opens its phone screen, or the computer", () => {
  expect(todoOpens({ key: "bill-b1", group: "bills", href: "/app/vendor-bills/b1" })).toEqual({ kind: "bill", id: "b1" });
  expect(todoOpens({ key: "pay-s1", group: "bank", href: "/app/bank/payments/s1" })).toEqual({ kind: "payment", id: "s1" });
  expect(todoOpens({ key: "dep-d1", group: "bank", href: "/app/bank?view=deposits" })).toEqual({ kind: "computer", path: "/app/bank?view=deposits" });
  expect(todoOpens({ key: "payout-drafts", group: "payouts", href: "/app/payouts" })).toEqual({ kind: "partners" });
  expect(todoOpens({ key: "exp-e1", group: "expenses", href: "/app/expenses/e1" })).toEqual({ kind: "expense", id: "e1" });
  expect(todoChip({ chip: { label: "short", tone: "danger", amount: true }, amountCents: 340441 })).toBe("$3,404.41 short");
});

test("a bill's chip says the difference past tolerance; a deposit's says short or missing", () => {
  const summary = { invoicedCents: 266000, ourCents: 246085, flagged: true };
  expect(billChip({ status: "received", comparison: { summary } })).toEqual({ tone: "bad", label: "$199.15 over" });
  expect(billChip({ status: "received", comparison: { summary: { ...summary, flagged: false } } })).toEqual({ tone: "ok", label: "Matches" });
  expect(billFacts({ lines: [{ quantity: 412, unitPriceCents: 2800 }], comparison: { rows: [{ countable: true, invoicedQuantity: 412, recorded: 412, creditedCount: 0 }] } })).toEqual({ billed: "412 × $28.00", arrived: "412", returns: "0" });
  expect(paymentChip({ verdict: "bad_math", shortCents: 21400, missingCents: 0 })).toEqual({ tone: "warn", label: "$214.00 short" });
  expect(paymentChip({ verdict: "bad_math", shortCents: 21400, missingCents: 0 }, true)).toEqual({ tone: "warn", label: "$214 short" });
  expect(paymentChip({ verdict: "all_good", shortCents: 0, missingCents: 0 }).label).toBe("Matched");
});

test("pay issue kinds, money words, dates and the category suggestion", () => {
  expect(kindsLine({ short_paid: 9, missing: 2 })).toBe("2 never paid, 9 paid short");
  expect(kindsLine({ short_paid: 9 })).toBe("9 paid short");
  expect(shortMoney(1824000)).toBe("$18,240");
  expect(shortMoney(-61200)).toBe("−$612");
  expect(parseDollars("$1,155.12")).toBe(115512);
  expect(parseDollars("abc")).toBeNull();
  expect(parseDay("23 Nov 2026")).toBe("2026-11-23");
  expect(parseDay("11/23/2026")).toBe("2026-11-23");
  expect(parseDay("soon")).toBeNull();
  const earlier = [
    { vendorName: "Staples", category: "other", incurredOn: "2026-09-01", status: "confirmed" },
    { vendorName: "staples ", category: "office", incurredOn: "2026-10-01", status: "confirmed" },
    { vendorName: "Staples", category: "software", incurredOn: "2026-11-01", status: "void" },
  ];
  expect(suggestCategory(earlier, "Staples")).toBe("office");
  expect(suggestCategory(earlier, "Dialer Co")).toBeNull();
});

test("whole dollars, the pay day, ordinals and a due date as the boards write them", () => {
  expect(wholeMoney(1912549)).toBe("$19,125");
  expect(wholeMoney(1912551)).toBe("$19,126");
  expect(wholeMoney(-2141000)).toBe("−$21,410");
  const paid = (start: string, on: string) => ({ status: "paid", periodStart: start, paidOn: on });
  expect(payDay([paid("2026-10-01", "2026-11-05"), paid("2026-09-01", "2026-10-05")])).toBe(5);
  expect(payDay([paid("2026-10-01", "2026-11-05"), paid("2026-09-01", "2026-10-07")])).toBeNull();
  expect(payDay([paid("2026-10-01", "2026-11-05")])).toBeNull();
  expect([1, 2, 3, 5, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "5th", "11th", "12th", "13th", "21st", "22nd"]);
  expect(dayWeek("2026-11-27")).toBe("Fri 27 Nov");
});

test("My pay's lines name the advance length and the month a policy came back in, only when the facts settle it", () => {
  const facts = { advanceMonthsByCarrier: { c1: 9, c2: 12 }, policyMonthByEntry: { b1: 4, b2: 4, b3: 6 } };
  expect(earnedLine([entry({ carrierId: "c1" })], facts)).toBe("Renewals and months 10–12");
  expect(earnedLine([entry({ carrierId: "c1" }), entry({ carrierId: "c2" })], facts)).toBe("Renewals and earned months");
  expect(chargebackLine([entry({ id: "b1", policyNumber: "X1" }), entry({ id: "b2", policyNumber: "X2" })], facts)).toBe("2 policies lapsed in month 4");
  expect(chargebackLine([entry({ id: "b1", policyNumber: "X1" }), entry({ id: "b3", policyNumber: "X2" })], facts)).toBe("2 policies lapsed in months 4–6");
  expect(chargebackLine([entry({ id: "zz", policyNumber: "X1" })], facts)).toBe("1 policy came back");
  expect(chargebackLine([], facts)).toBe("Nothing came back");
});

test("a team payout row as drawn: share of the advance and the month's policies", () => {
  expect(teamWhy({ planModel: "big_split", chargebackCents: 0 }, { shareBps: 8000, policies: 14, chargebacks: 0, applications: 0 }, "pay_full")).toBe("80% of advance · 14 policies");
  expect(teamWhy({ planModel: "big_split", chargebackCents: -100 }, { shareBps: 7000, policies: 0, chargebacks: 1, applications: 0 }, "pay_full")).toBe("70% · 1 chargeback");
  expect(teamWhy({ planModel: "salary_bonus", chargebackCents: 0 }, { shareBps: null, policies: 0, chargebacks: 0, applications: 25 }, "pay_full")).toBe("Salary + bonus · 25 applications");
  expect(teamWhy({ planModel: "big_split", chargebackCents: 0 }, undefined, "withhold")).toBe("Big split · owes the agency");
});

test("advance_paid is the agency's advance (G7), never a commission advance on My pay (G1)", () => {
  expect(isAgencyAdvance("advance_paid")).toBe(true);
  expect(payKind("advance_paid")).toBe("agencyAdvance");
  expect(payKind("split_advance")).toBe("advance");
  const data: MyPay = { balances: [], runs: [], facts: null, entries: [entry({ amountCents: 50000 }), entry({ entryType: "advance_paid", amountCents: -20000 })] } as unknown as MyPay;
  const s = myPaySummary(data, "2026-11-20");
  expect(s.advances.cents).toBe(50000);
  expect(s.shareCents).toBe(50000);
  expect(s.expectedCents).toBe(50000);
});

test("G2 · the payment method shows as stored, a code reads as words", () => {
  expect(methodLabel("Zelle")).toBe("Zelle");
  expect(methodLabel("Direct deposit")).toBe("Direct deposit");
  expect(methodLabel("bank_transfer")).toBe("Bank transfer");
  expect(methodLabel("ach")).toBe("ACH");
  expect(methodLabel("")).toBeNull();
});
