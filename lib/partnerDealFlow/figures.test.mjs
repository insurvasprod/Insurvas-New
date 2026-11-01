import test from "node:test";
import assert from "node:assert/strict";

import { dealFlowFigures } from "./figures.ts";

/**
 * A number on a card always looks like a fact, so these hold the arithmetic that decides what the
 * four cards above the table say. Each case is a way a figure stops describing the rows under it.
 */

const DAY = "2026-11-01";
const row = (over) => ({ stageType: "open", monthlyPremiumCents: null, submittedDay: DAY, outcome: null, ...over });

test("an empty day is four zeroes, not four blanks", () => {
  const figures = dealFlowFigures([], DAY);
  assert.deepEqual(figures, {
    worked: 0, won: 0, inProgress: 0, lost: 0,
    wonMonthlyCents: 0, wonAnnualisedCents: 0, wonUnpriced: 0,
    oldestInProgressDays: null, topLostReason: null,
  });
});

test("the counts add up to the rows on the table", () => {
  const rows = [
    row({ stageType: "won" }), row({ stageType: "won" }),
    row({ stageType: "open" }),
    row({ stageType: "lost" }), row({ stageType: "lost" }), row({ stageType: "lost" }),
  ];
  const figures = dealFlowFigures(rows, DAY);
  assert.equal(figures.worked, 6);
  assert.equal(figures.won + figures.inProgress + figures.lost, figures.worked, "every row is in exactly one card");
  assert.equal(figures.won, 2);
  assert.equal(figures.inProgress, 1);
  assert.equal(figures.lost, 3);
});

/* ── Money ────────────────────────────────────────────────────────────────────────────────────── */

test("only won deals contribute premium", () => {
  const rows = [
    row({ stageType: "won", monthlyPremiumCents: 10_000 }),
    row({ stageType: "open", monthlyPremiumCents: 99_900 }),
    row({ stageType: "lost", monthlyPremiumCents: 99_900 }),
  ];
  const figures = dealFlowFigures(rows, DAY);
  assert.equal(figures.wonMonthlyCents, 10_000, "a quoted premium on an open deal is not revenue");
});

test("annualised is twelve months of the monthly figure, and says so by being exactly that", () => {
  const figures = dealFlowFigures([row({ stageType: "won", monthlyPremiumCents: 12_345 })], DAY);
  assert.equal(figures.wonMonthlyCents, 12_345);
  assert.equal(figures.wonAnnualisedCents, 148_140);
});

test("a sale with no premium yet is still a sale, counted apart rather than as zero", () => {
  // Counting it as 0 would drag any average the card shows down and nobody would notice.
  const rows = [
    row({ stageType: "won", monthlyPremiumCents: 20_000 }),
    row({ stageType: "won", monthlyPremiumCents: null }),
    row({ stageType: "won", monthlyPremiumCents: 0 }),
  ];
  const figures = dealFlowFigures(rows, DAY);
  assert.equal(figures.won, 3, "all three are sales");
  assert.equal(figures.wonMonthlyCents, 20_000);
  assert.equal(figures.wonUnpriced, 2, "null and zero both mean 'not priced yet'");
});

/* ── Age ──────────────────────────────────────────────────────────────────────────────────────── */

test("age runs from the lead's submission to the day on screen", () => {
  // The agency's version measures over a date range; on one day that would always be nought. A
  // deal worked today on a lead sent five days ago is five days old, and that is the useful fact.
  const rows = [
    row({ stageType: "open", submittedDay: "2026-10-27" }),
    row({ stageType: "open", submittedDay: "2026-10-31" }),
  ];
  assert.equal(dealFlowFigures(rows, DAY).oldestInProgressDays, 5);
});

test("only still-open deals have an age", () => {
  const rows = [
    row({ stageType: "won", submittedDay: "2026-09-01" }),
    row({ stageType: "lost", submittedDay: "2026-09-01" }),
  ];
  assert.equal(dealFlowFigures(rows, DAY).oldestInProgressDays, null, "a closed deal is not waiting");
});

test("a deal submitted and worked the same day is nought days old, never blank", () => {
  assert.equal(dealFlowFigures([row({ submittedDay: DAY })], DAY).oldestInProgressDays, 0);
});

test("a submission dated after the day it was worked clamps at nought", () => {
  // Cannot happen from the app; can happen from a clock skew or a backfill. "-1 days" on a card
  // is worse than "today".
  assert.equal(dealFlowFigures([row({ submittedDay: "2026-11-05" })], DAY).oldestInProgressDays, 0);
});

/* ── Why deals were lost ──────────────────────────────────────────────────────────────────────── */

test("the top reason is taken from the lost rows only", () => {
  const rows = [
    row({ stageType: "won", outcome: "Application submitted" }),
    row({ stageType: "won", outcome: "Application submitted" }),
    row({ stageType: "won", outcome: "Application submitted" }),
    row({ stageType: "lost", outcome: "Not interested" }),
  ];
  assert.equal(dealFlowFigures(rows, DAY).topLostReason, "Not interested", "the commonest outcome overall is a won one");
});

test("the commonest lost reason wins", () => {
  const rows = [
    row({ stageType: "lost", outcome: "Unable to reach" }),
    row({ stageType: "lost", outcome: "Not interested" }),
    row({ stageType: "lost", outcome: "Not interested" }),
  ];
  assert.equal(dealFlowFigures(rows, DAY).topLostReason, "Not interested");
});

test("lost deals with no recorded reason do not become a reason", () => {
  const rows = [row({ stageType: "lost", outcome: null }), row({ stageType: "lost", outcome: null })];
  assert.equal(dealFlowFigures(rows, DAY).topLostReason, null);
  assert.equal(dealFlowFigures(rows, DAY).lost, 2, "they are still lost");
});
