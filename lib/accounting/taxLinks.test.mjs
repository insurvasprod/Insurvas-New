// Tax summaries, round 7 (docs/la4/mockups-r7/accounting.html §6 · A): chips, the payee stepper, quarters.
// Run with: node --experimental-strip-types --test lib/accounting/taxLinks.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { categoriesByQuarter, nextMissing, nextStepWords, payeeHref, stepperList, taxQuarters, whoOf, whoRows } from "./taxLinks.ts";

const r = (id, missing = [], exempt = null) => ({ payeeType: "producer", payeeId: id, missing, exempt });
const list = { rows: [r("a"), r("b", ["W-9"]), r("c"), r("d", ["W-9", "tax ID"]), r("e", ["W-9"], "corporation")], under: [r("u1"), r("u2")] };

test("each chip lists its own payees; under the threshold is a chip too", () => {
  assert.deepEqual(whoRows(list, "all").map((x) => x.payeeId), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(whoRows(list, "missing").map((x) => x.payeeId), ["b", "d"]);
  assert.deepEqual(whoRows(list, "ready").map((x) => x.payeeId), ["a", "c", "e"], "an exempt payee is not missing anything");
  assert.deepEqual(whoRows(list, "under").map((x) => x.payeeId), ["u1", "u2"]);
  assert.equal(whoOf("nonsense"), "all");
});

test("Next step is words, never a button", () => {
  assert.equal(nextStepWords(r("x")), "Ready for January");
  assert.equal(nextStepWords(r("x", ["W-9"])), "Add the W-9");
  assert.equal(nextStepWords(r("x", ["W-9", "legal name"])), "Add the details");
  assert.equal(nextStepWords(r("x", [], "foreign")), "No 1099 needed");
  assert.equal(nextStepWords(r("x"), true), "No 1099 needed");
});

test("a payee's address keeps the list it came from and the tab", () => {
  assert.equal(payeeHref(r("b"), 2026), "/app/tax/payee/producer/b?year=2026");
  assert.equal(payeeHref(r("b"), 2026, { from: "missing", tab: "payments" }), "/app/tax/payee/producer/b?year=2026&from=missing&tab=payments");
});

test("‹ › walk the chip it was opened from, else the list that holds it", () => {
  assert.deepEqual(stepperList(list, "missing", "producer/d").rows.map((x) => x.payeeId), ["b", "d"]);
  assert.equal(stepperList(list, "missing", "producer/a").who, "all", "a ready payee opened with from=missing walks All");
  assert.equal(stepperList(list, "all", "producer/u2").who, "under");
});

test("Next missing is the next one after this payee, wrapping round, never itself", () => {
  assert.equal(nextMissing(list, "producer/b").payeeId, "d");
  assert.equal(nextMissing(list, "producer/d").payeeId, "b");
  assert.equal(nextMissing(list, "producer/a").payeeId, "b");
  assert.equal(nextMissing({ rows: [r("b", ["W-9"])], under: [] }, "producer/b"), null);
});

test("the quarters of a year: the current one is so far, later ones have not happened", () => {
  const q = taxQuarters(2026, "2026-11-11");
  assert.deepEqual(q.map((x) => [x.from, x.to]), [["2026-01-01", "2026-04-01"], ["2026-04-01", "2026-07-01"], ["2026-07-01", "2026-10-01"], ["2026-10-01", "2027-01-01"]]);
  assert.deepEqual(q.map((x) => x.label), ["Q1", "Q2", "Q3", "Q4 so far"]);
  assert.deepEqual(taxQuarters(2026, "2026-05-02").map((x) => x.state), ["closed", "so_far", "future", "future"]);
  assert.deepEqual(taxQuarters(2025, "2026-11-11").map((x) => x.label), ["Q1", "Q2", "Q3", "Q4"]);
  assert.equal(taxQuarters(2026, "2026-04-01")[1].state, "so_far", "the first day of a quarter is in it");
});

test("categories by quarter sum to the year, in the given order; a quarter not started is a dash", () => {
  const rows = categoriesByQuarter([
    [{ taxCategory: "gross_receipts", amountCents: 1000 }, { taxCategory: "advertising", amountCents: -300 }, { taxCategory: "gross_receipts", amountCents: 50 }],
    [{ taxCategory: "advertising", amountCents: -200 }],
    null,
    null,
  ], ["gross_receipts", "advertising", "software"]);
  assert.deepEqual(rows, [
    { category: "gross_receipts", quarters: [1050, 0, null, null], yearCents: 1050 },
    { category: "advertising", quarters: [-300, -200, null, null], yearCents: -500 },
  ]);
  assert.deepEqual(categoriesByQuarter([[], [], [], []], ["software"]), []);
});
