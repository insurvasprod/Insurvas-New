import test from "node:test";
import assert from "node:assert/strict";

import { moneySplit, periodChange, standing } from "./dashboardCore.ts";

/**
 * The arithmetic behind the agency dashboard's cards and charts.
 *
 * Each case here is named for the wrong answer it prevents. A number on a card always looks like a
 * fact, and the ones below are the places where it would be a confident lie instead.
 */

/* ── Period change ───────────────────────────────────────────────────────────────────────────── */

test("an ordinary rise and fall", () => {
  assert.equal(periodChange(1_200, 1_000), 20);
  assert.equal(periodChange(800, 1_000), -20);
  assert.equal(periodChange(1_000, 1_000), 0, "no change is a real answer, and it is zero");
});

test("the change is rounded to one decimal, not to a long tail", () => {
  assert.equal(periodChange(1_117, 1_000), 11.7);
  assert.equal(periodChange(1_000, 3_000), -66.7);
});

test("no previous period means no pill, not a zero", () => {
  // The comparison is fetched after first paint. Until it lands there is nothing to say, and "0%"
  // would say the month is flat when it is simply unknown.
  assert.equal(periodChange(1_200, null), null);
  assert.equal(periodChange(1_200, undefined), null);
});

test("a figure that was not read has no change", () => {
  assert.equal(periodChange(null, 1_000), null);
  assert.equal(periodChange(null, null), null);
});

test("growth from zero is not a percentage", () => {
  // $0 last month and $900 this month is not "+100%" and not "+∞". It is a start, and no
  // percentage describes it. The card shows the figure and no pill.
  assert.equal(periodChange(900, 0), null);
  assert.equal(periodChange(0, 0), null, "nothing to nothing is not a confident 0%");
});

test("a change that crosses zero is not a percentage", () => {
  // An override of −$400 becoming +$900 is not "+325%". This is the case most likely to be
  // printed wrongly, and it is the one an owner would most rely on.
  assert.equal(periodChange(900, -400), null);
  assert.equal(periodChange(-400, 900), null);
});

test("two negatives compare as a signed move, so the pill points the right way", () => {
  // The sign is the one an owner reads, not the one the magnitude suggests. An override of −$500
  // becoming −$250 is the hole halving — the figure went **up** by half of what it was, and with
  // `goodWhen: "up"` the pill is green. Reporting that as "−50%" because the gap shrank would
  // colour an improvement red, which is the opposite of useful.
  assert.equal(periodChange(-250, -500), 50, "the hole halved: an improvement, so a rise");
  assert.equal(periodChange(-750, -500), -50, "the hole deepened: a fall");
});

/* ── The standing ────────────────────────────────────────────────────────────────────────────── */

const producer = (name, issued) => ({
  producerUserId: `u-${name}`, name, submitted: issued * 2, issued,
  placement: "—", m4: { text: "—", building: true }, m13: { text: "—", building: true },
  advanceAtRiskCents: 0, chargebackCents: 0, leadSpendCents: 0, balanceCents: 0,
});
const byIssued = (row) => row.issued;

test("the standing is ordered by the metric, highest first", () => {
  const rows = standing([producer("Low", 3), producer("High", 9), producer("Mid", 5)], byIssued);
  assert.deepEqual(rows.map((row) => row.name), ["High", "Mid", "Low"]);
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3]);
});

test("ties share a rank, and the next rank skips", () => {
  // Telling two equal producers that one of them is second is a distinction the data does not
  // support. Two firsts, then a third — the way every league table does it.
  const rows = standing([producer("Ann", 9), producer("Bob", 9), producer("Cat", 4)], byIssued);
  assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3]);
});

test("the order is stable, so a refresh does not shuffle the table", () => {
  const first = standing([producer("Bob", 5), producer("Ann", 5)], byIssued);
  const again = standing([producer("Ann", 5), producer("Bob", 5)], byIssued);
  assert.deepEqual(first.map((row) => row.name), again.map((row) => row.name));
  assert.deepEqual(first.map((row) => row.name), ["Ann", "Bob"], "ties fall back to the name");
});

test("a producer who wrote nothing is ranked last, not hidden", () => {
  // They hold a seat and they are on the agency's payroll. Dropping them is the more misleading
  // view, and it is the view that makes a quiet producer invisible to the person who should act.
  const rows = standing([producer("Busy", 7), producer("Idle", 0)], byIssued);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].name, "Idle");
  assert.equal(rows[1].rank, 2);
});

test("an empty agency is an empty standing, not a row of zeros", () => {
  assert.deepEqual(standing([], byIssued), []);
});

test("the source list is not reordered underneath the caller", () => {
  const rows = [producer("Low", 1), producer("High", 9)];
  standing(rows, byIssued);
  assert.equal(rows[0].name, "Low", "the table's own order is the caller's to keep");
});

/* ── Where the money went ────────────────────────────────────────────────────────────────────── */

test("the three parts come back in a fixed order", () => {
  const split = moneySplit({ overrideCents: 300_00, payableOutCents: 900_00, leadSpendCents: 600_00 });
  assert.deepEqual(split, [
    { label: "Override", value: 300_00 },
    { label: "Owed", value: 900_00 },
    { label: "Acquisition", value: 600_00 },
  ]);
});

test("nothing to divide is null, not a grey rectangle of zeros", () => {
  assert.equal(moneySplit({ overrideCents: 0, payableOutCents: 0, leadSpendCents: 0 }), null);
  assert.equal(moneySplit({ overrideCents: null, payableOutCents: null, leadSpendCents: 0 }), null);
});

test("a figure that was not read is left out, never drawn as a zero slice", () => {
  // The payable ledger is not live yet. "Owed $0.00" would tell an owner they owe their
  // producers nothing — the one thing on this page they must not be told wrongly. The bar draws
  // the two parts it actually knows.
  const split = moneySplit({ overrideCents: 300_00, payableOutCents: null, leadSpendCents: 600_00 });
  assert.deepEqual(split, [
    { label: "Override", value: 300_00 },
    { label: "Acquisition", value: 600_00 },
  ]);
});

test("an unread override drops out of the bar too", () => {
  const split = moneySplit({ overrideCents: null, payableOutCents: 900_00, leadSpendCents: 600_00 });
  assert.deepEqual(split?.map((part) => part.label), ["Owed", "Acquisition"]);
});

test("a negative override does not eat the other slices", () => {
  // A share bar cannot draw a negative slice; it would silently resize the others. A loss-making
  // month shows as a zero override — it WAS read, and it is nought or less — while the card above
  // still says −$400.
  const split = moneySplit({ overrideCents: -400_00, payableOutCents: 900_00, leadSpendCents: 600_00 });
  assert.deepEqual(split?.map((part) => part.value), [0, 900_00, 600_00]);
});
