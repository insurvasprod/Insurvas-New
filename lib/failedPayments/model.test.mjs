import test from "node:test";
import assert from "node:assert/strict";

import { episodesFrom, failureReason, ladderFor, nextWords, recoveryFigures } from "./model.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ev = (type, at, extra = {}) => ({ tenantId: "t1", type, at, nextAttemptAt: null, reason: null, ...extra });

test("the ladder reads the provider's own attempts since the last success", () => {
  const events = [
    ev("payment.succeeded", "2026-10-14T09:00:00Z"),
    ev("payment.failed", "2026-11-14T09:00:00Z", { reason: "Card declined" }),
    ev("payment.failed", "2026-11-16T09:00:00Z", { nextAttemptAt: "2026-11-18T09:00:00Z" }),
  ];
  const ladder = ladderFor(events, NOW);
  assert.equal(ladder.failedAt, "2026-11-14T09:00:00Z");
  assert.deepEqual(ladder.triedAgainOn, ["2026-11-16T09:00:00Z"]);
  assert.equal(ladder.nextRetryAt, "2026-11-18T09:00:00.000Z");
  assert.equal(ladder.readOnlyAt, "2026-11-19T09:00:00.000Z");
  assert.equal(ladder.reason, "Card declined");
  assert.deepEqual(ladder.steps.map((s) => [s.label, s.state]), [["Failed", "done"], ["Retried", "done"], ["Next retry", "next"], ["Read-only", "later"]]);
  assert.equal(nextWords(ladder, NOW), "Retry Nov 18");
});

test("a retry named after the cut-off will not happen", () => {
  const ladder = ladderFor([ev("payment.failed", "2026-11-14T09:00:00Z", { nextAttemptAt: "2026-11-25T09:00:00Z" })], NOW);
  assert.equal(ladder.nextRetryAt, null);
  assert.equal(nextWords(ladder, NOW), "Read-only Nov 19");
});

test("no failure on record and no past-due invoice: no ladder", () => {
  assert.deepEqual(ladderFor([], NOW).steps, []);
  const pastDue = ladderFor([ev("invoice.past_due", "2026-11-15T00:00:00Z")], NOW);
  assert.equal(pastDue.failedAt, "2026-11-15T00:00:00Z");
});

test("episodes close as recovered on a success, lost when the subscription ended, else stay open", () => {
  const events = [
    ev("payment.failed", "2026-11-01T00:00:00Z"),
    ev("payment.failed", "2026-11-02T00:00:00Z", { reason: "Insufficient funds" }),
    ev("payment.succeeded", "2026-11-03T00:00:00Z"),
    ev("payment.failed", "2026-11-10T00:00:00Z", { tenantId: "t2" }),
    ev("payment.failed", "2026-11-15T00:00:00Z", { tenantId: "t3" }),
  ];
  const episodes = episodesFrom(events, new Map([["t2", "2026-11-15T00:00:00Z"]]));
  const by = Object.fromEntries(episodes.map((e) => [e.tenantId, e]));
  assert.equal(by.t1.outcome, "recovered");
  assert.equal(by.t1.reason, "Insufficient funds");
  assert.equal(by.t2.outcome, "lost");
  assert.equal(by.t3.outcome, "open");
  const figures = recoveryFigures(episodes, NOW);
  assert.deepEqual(figures, { recovered30: 1, lost30: 1, recoveredPrior30: 0, rate90: 0.5 });
});

test("no closed episode: no rate, never 0%", () => {
  assert.equal(recoveryFigures([], NOW).rate90, null);
});

test("the reason comes from the payload, if it says one", () => {
  assert.equal(failureReason({ data: { failure_message: " Your card was declined. " } }), "Your card was declined.");
  assert.equal(failureReason({ data: {} }), null);
  assert.equal(failureReason(null), null);
});
