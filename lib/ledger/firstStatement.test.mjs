import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceMonthsOf,
  extraColumns,
  guessCarrier,
  guessProduct,
  inferAdvance,
  matchProduct,
  productsNamed,
  inferRate,
  newPoliciesFrom,
  percentLabel,
  periodLabel,
  readFirstStatement,
  statementPeriodOf,
  wrongLines,
} from "./firstStatement.ts";

const CARRIERS = [
  { id: "c-americo", code: "AMERICO", name: "Americo" },
  { id: "c-aetna", code: "AET", name: "Aetna" },
  { id: "c-mutual", code: "MOO", name: "Mutual of Omaha" },
  { id: "c-amam", code: "AMAM", name: "American Amicable" },
];
const PRODUCTS = [{ code: "final_expense", name: "Final Expense" }, { code: "term", name: "Term Life" }];

let n = 0;
const line = (over = {}) => ({ lineNumber: ++n, policyNumber: `P${n}`, insuredName: `Client ${n}`, amountCents: 108_000, kind: "commission", lineDate: "2026-10-05", premiumCents: 108_000, rateBp: 10_000, error: null, ...over });

test("the carrier comes from a Carrier column, then the file name, then a remembered layout", () => {
  assert.deepEqual(guessCarrier({ fileName: "Americo_Oct_2026.csv", carriers: CARRIERS }), { carrierId: "c-americo", from: "file name" });
  assert.deepEqual(guessCarrier({ fileName: "statement.csv", carriers: CARRIERS, carrierColumn: ["Mutual of Omaha", "Mutual of Omaha"] }), { carrierId: "c-mutual", from: "carrier column" });
  assert.equal(guessCarrier({ fileName: "omaha-commissions.xlsx", carriers: CARRIERS }).carrierId, "c-mutual", "a distinctive word names it");
  assert.equal(guessCarrier({ fileName: "life-statement.csv", carriers: CARRIERS }).carrierId, null, "a generic word names nobody");
  const layouts = [{ carrierId: "c-aetna", headers: ["Pol No", "Comm Amt"] }];
  assert.deepEqual(guessCarrier({ fileName: "export.csv", carriers: CARRIERS, layouts, headers: ["Pol No", "Comm Amt", "Date"] }), { carrierId: "c-aetna", from: "layout" });
  assert.equal(guessCarrier({ fileName: "export.csv", carriers: CARRIERS, layouts: [...layouts, { carrierId: "c-americo", headers: ["Pol No"] }], headers: ["Pol No", "Comm Amt"] }).carrierId, null, "two layouts fit: nobody");
});

test("the period is the month the line dates sit in, else first to last date, else last month", () => {
  assert.deepEqual(statementPeriodOf([line({ lineDate: "2026-10-05" }), line({ lineDate: "2026-10-28" })], "2026-11-19"), { start: "2026-10-01", end: "2026-10-31", from: "line dates" });
  assert.deepEqual(statementPeriodOf([line({ lineDate: "2026-09-20" }), line({ lineDate: "2026-10-03" })], "2026-11-19"), { start: "2026-09-20", end: "2026-10-03", from: "line dates" });
  assert.deepEqual(statementPeriodOf([line({ lineDate: null })], "2026-01-10"), { start: "2025-12-01", end: "2025-12-31", from: "last month" });
  assert.equal(periodLabel("2026-10-01", "2026-10-31"), "October 2026");
  assert.equal(periodLabel("2026-09-20", "2026-10-03"), "20 Sep 2026 – 3 Oct 2026");
});

test("the rate is the Rate column on most lines, else paid ÷ premium, else 100%", () => {
  const lines = [...Array.from({ length: 9 }, () => line()), line({ rateBp: 8_000, amountCents: 86_400 })];
  assert.deepEqual(inferRate(lines), { rateBp: 10_000, lines: 9, of: 10, from: "rate column" });
  assert.deepEqual(inferRate([line({ rateBp: null, amountCents: 118_800 }), line({ rateBp: null, amountCents: 118_800 })]), { rateBp: 11_000, lines: 2, of: 2, from: "paid ÷ premium" });
  assert.equal(inferRate([line({ rateBp: null, premiumCents: null })]).from, "assumed");
  assert.equal(inferRate([]).rateBp, 10_000);
});

test("the advance is paid ÷ (annual premium × rate) on advance lines: 810 on 1,080 at 100% is 75%, nine months", () => {
  const advance = inferAdvance([line({ kind: "advance", amountCents: 81_000 }), line({ kind: "advance", amountCents: 81_000 }), line()], 10_000);
  assert.deepEqual(advance, { pctBp: 7_500, months: 9, lines: 2, of: 2 });
  assert.equal(inferAdvance([line({ kind: "advance", amountCents: 89_100, rateBp: 11_000 })], 11_000).pctBp, 7_500, "the line's own rate");
  assert.equal(inferAdvance([line()], 10_000), null, "no advance lines, no advance");
  assert.equal(advanceMonthsOf(10_000), 12);
  assert.equal(advanceMonthsOf(5_000), 6);
});

test("already wrong: a line at another rate, or advanced at another share", () => {
  const lines = [line(), line(), line({ rateBp: 8_000, insuredName: "Deborah Finch" }), line({ kind: "advance", amountCents: 81_000 }), line({ kind: "advance", amountCents: 81_000 }), line({ kind: "advance", amountCents: 54_000 })];
  const rate = inferRate(lines);
  const advance = inferAdvance(lines, rate.rateBp);
  const wrong = wrongLines(lines, rate.rateBp, advance);
  assert.equal(wrong.length, 2);
  assert.deepEqual(wrong.map((w) => [w.what, w.paidBp, w.expectedBp]), [["rate", 8_000, 10_000], ["advance", 5_000, 7_500]]);
  assert.equal(wrong[0].insuredName, "Deborah Finch");
  assert.deepEqual(wrongLines([line({ kind: "chargeback", amountCents: -100, rateBp: 5_000 })], 10_000, null), [], "a chargeback is not a rate");
});

test("new policies: numbers the book lacks, premium from the statement or worked back, first date as issue date", () => {
  const lines = [
    line({ policyNumber: "AM-100", insuredName: "Ann", lineDate: "2026-10-09" }),
    line({ policyNumber: "am100", insuredName: null, lineDate: "2026-10-02" }),
    line({ policyNumber: "AM-200", premiumCents: null, kind: "advance", amountCents: 81_000, lineDate: null }),
    line({ policyNumber: "HELD-1" }),
    line({ policyNumber: null }),
    line({ policyNumber: "BAD", error: "No amount on this line." }),
  ];
  const policies = newPoliciesFrom(lines, ["held-1"], { rateBp: 10_000, advance: { pctBp: 7_500, months: 9, lines: 1, of: 1 }, fallbackDate: "2026-10-01" });
  assert.deepEqual(policies.map((p) => p.policyNumber), ["AM-100", "AM-200"]);
  assert.deepEqual(policies[0], { policyNumber: "AM-100", insuredName: "Ann", annualPremiumCents: 108_000, premiumFrom: "statement", effectiveDate: "2026-10-02", lines: 2, product: null, lapsedOn: null });
  assert.equal(policies[1].annualPremiumCents, 108_000, "810 advanced at 75% of 100% is 1,080 a year");
  assert.equal(policies[1].premiumFrom, "worked out");
  assert.equal(policies[1].effectiveDate, "2026-10-01");
  assert.equal(policies[1].insuredName, "Client " + (n - 3));
});

test("the product comes from a Product column matched by code or name", () => {
  assert.equal(guessProduct([line({ product: "Final Expense" }), line({ product: "FE Final Expense Plus" }), line({ product: "term" })], PRODUCTS), "final_expense");
  assert.equal(guessProduct([line()], PRODUCTS), null);
  assert.deepEqual(extraColumns(["Policy No", "Carrier Name", "Plan Code"]), { carrier: "Carrier Name", product: "Plan Code" });
  assert.deepEqual(extraColumns(["Policy No"]), { carrier: null, product: null });
});

test("readFirstStatement puts the board's six cards together", () => {
  const lines = [...Array.from({ length: 9 }, (_, i) => line({ policyNumber: `AMR${i}`, kind: "advance", amountCents: 81_000 })), line({ policyNumber: "AMR9", rateBp: 8_000, kind: "advance", amountCents: 64_800, insuredName: "Deborah Finch" })];
  const found = readFirstStatement({ fileName: "Americo October.csv", headers: ["Policy", "Amount"], lines, carriers: CARRIERS, products: PRODUCTS, book: [], today: "2026-11-19" });
  assert.equal(found.carrier.carrierId, "c-americo");
  assert.equal(found.policies.length, 10);
  assert.equal(periodLabel(found.period.start, found.period.end), "October 2026");
  assert.deepEqual([found.rate.rateBp, found.rate.lines, found.rate.of], [10_000, 9, 10]);
  assert.deepEqual([found.advance.pctBp, found.advance.months], [7_500, 9]);
  assert.equal(found.wrong.length, 1);
  assert.equal(found.wrong[0].insuredName, "Deborah Finch");
  assert.equal(found.netCents, 9 * 81_000 + 64_800);
  assert.equal(percentLabel(7_500), "75%");
  assert.equal(percentLabel(8_250), "82.5%");
});

test("each policy keeps the product its own cell names, and every named product gets the rate", () => {
  const lines = [line({ policyNumber: "A1", product: "Final Expense" }), line({ policyNumber: "A2", product: "Term Life" }), line({ policyNumber: "A3", product: "Final Expense" })];
  assert.equal(matchProduct("Term Life", PRODUCTS), "term");
  assert.equal(matchProduct("", PRODUCTS), null);
  assert.deepEqual(productsNamed(lines, PRODUCTS), ["final_expense", "term"]);
  const added = newPoliciesFrom(lines, [], { rateBp: 10_000, advance: null, fallbackDate: "2026-10-01" });
  assert.deepEqual(added.map((p) => p.product), ["Final Expense", "Term Life", "Final Expense"]);
});

test("a policy the statement only charges back is added lapsed on that day; one it pays is not", () => {
  const added = newPoliciesFrom([
    line({ policyNumber: "CB1", kind: "chargeback", amountCents: -68_400, lineDate: "2026-10-20" }),
    line({ policyNumber: "OK1", kind: "advance", amountCents: 81_000, lineDate: "2026-10-02" }),
  ], [], { rateBp: 10_000, advance: { pctBp: 7_500, months: 9, lines: 1, of: 1 }, fallbackDate: "2026-10-01" });
  assert.equal(added.find((p) => p.policyNumber === "CB1").lapsedOn, "2026-10-20");
  assert.equal(added.find((p) => p.policyNumber === "OK1").lapsedOn, null);
});
