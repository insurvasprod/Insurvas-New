// Run with: node --experimental-strip-types --test lib/trials/boardModel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calendarDaysLeft,
  earliest,
  endsInPhrase,
  monthOutcome,
  percentLabel,
  secondEarliest,
  separation,
  signalsAt,
  trialEndedAt,
  trialFullUtc,
  trialShortDate,
} from "./boardModel.ts";

const NOW = new Date("2026-09-24T12:00:00Z");
const iso = (s) => new Date(s).toISOString();

test("days left counts calendar dates in UTC and never goes below zero", () => {
  assert.equal(calendarDaysLeft("2026-09-24T23:59:00Z", NOW), 0);
  assert.equal(calendarDaysLeft("2026-09-25T00:01:00Z", NOW), 1);
  assert.equal(calendarDaysLeft("2026-09-27T16:50:29Z", NOW), 3);
  assert.equal(calendarDaysLeft("2026-09-20T00:00:00Z", NOW), 0);
});

test("the team signal is the moment a second member was invited", () => {
  const invites = ["2026-09-10T00:00:00Z", null, "2026-09-01T00:00:00Z", "2026-09-12T00:00:00Z"];
  assert.equal(earliest(invites), "2026-09-01T00:00:00Z");
  assert.equal(secondEarliest(invites), "2026-09-10T00:00:00Z");
  assert.equal(secondEarliest(["2026-09-01T00:00:00Z"]), null);
});

test("signals are judged at a moment, not by what happened later", () => {
  const moments = { leads: "2026-09-05T00:00:00Z", team: "2026-09-20T00:00:00Z", carrier: null };
  assert.deepEqual(signalsAt(moments, new Date("2026-09-10T00:00:00Z")), { leads: true, team: false, carrier: false });
  assert.deepEqual(signalsAt(moments, NOW), { leads: true, team: true, carrier: false });
});

test("a conversion is dated by the first payment, else by a trial end that has passed", () => {
  const base = { status: "active", started_at: iso("2026-09-01"), trial_ends_at: iso("2026-09-15"), cancelled_at: null };
  assert.equal(trialEndedAt({ ...base, first_paid_at: iso("2026-09-10") }, NOW)?.toISOString(), iso("2026-09-10"));
  assert.equal(trialEndedAt({ ...base, first_paid_at: null }, NOW)?.toISOString(), iso("2026-09-15"));
  assert.equal(trialEndedAt({ ...base, trial_ends_at: iso("2026-10-01"), first_paid_at: null }, NOW), null);
});

test("a lapse is dated by its cancellation, else by the trial end or now, whichever is first", () => {
  const base = { status: "cancelled", started_at: iso("2026-09-01"), trial_ends_at: iso("2026-09-15"), first_paid_at: null };
  assert.equal(trialEndedAt({ ...base, cancelled_at: iso("2026-09-03") }, NOW)?.toISOString(), iso("2026-09-03"));
  assert.equal(trialEndedAt({ ...base, cancelled_at: null }, NOW)?.toISOString(), iso("2026-09-15"));
  assert.equal(
    trialEndedAt({ ...base, trial_ends_at: iso("2026-10-01"), cancelled_at: null }, NOW)?.toISOString(),
    NOW.toISOString(),
  );
  assert.equal(trialEndedAt({ ...base, status: "trialing", cancelled_at: null }, NOW), null);
});

test("the month outcome counts only trials that ended this UTC month", () => {
  const out = monthOutcome(
    [
      { status: "active", started_at: iso("2026-09-01"), trial_ends_at: iso("2026-09-15"), cancelled_at: null, first_paid_at: iso("2026-09-15") },
      { status: "active", started_at: iso("2026-08-01"), trial_ends_at: iso("2026-08-15"), cancelled_at: null, first_paid_at: iso("2026-08-15") },
      { status: "cancelled", started_at: iso("2026-09-01"), trial_ends_at: iso("2026-09-15"), cancelled_at: iso("2026-09-02"), first_paid_at: null },
      { status: "active", started_at: iso("2026-09-20"), trial_ends_at: iso("2026-10-04"), cancelled_at: null, first_paid_at: null },
      { status: "trialing", started_at: iso("2026-09-20"), trial_ends_at: iso("2026-10-04"), cancelled_at: null, first_paid_at: null },
    ],
    NOW,
  );
  assert.deepEqual(out, { converted: 1, lapsed: 1, undated: 1 });
});

test("separation compares both signals against neither, inside the six-month window", () => {
  const trial = (status, signals, started = "2026-09-01", ends = "2026-09-15") => ({
    tenant_id: "t",
    status,
    started_at: iso(started),
    trial_ends_at: iso(ends),
    cancelled_at: null,
    first_paid_at: null,
    signals,
    owner_signed_in: status === "active",
  });
  const both = { leads: iso("2026-09-02"), team: iso("2026-09-03"), carrier: null };
  const none = { leads: null, team: null, carrier: null };
  // Reached leads only after the trial had ended: counts as neither.
  const late = { leads: iso("2026-09-20"), team: null, carrier: null };

  const sep = separation(
    [
      trial("active", both),
      trial("active", both),
      trial("cancelled", both),
      trial("cancelled", none),
      trial("cancelled", late),
      trial("active", none),
      trial("trialing", both),
      trial("active", both, "2025-01-01", "2025-01-15"),
    ],
    NOW,
  );
  assert.equal(sep.cohort, 6);
  assert.deepEqual(sep.both, { n: 3, converted: 2 });
  assert.deepEqual(sep.neither, { n: 3, converted: 1 });
  assert.deepEqual(sep.ownerSignedIn, { n: 3, converted: 3 });
  assert.equal(sep.averageDaysToConvert, 14);
});

test("labels", () => {
  assert.equal(percentLabel(null), "—");
  assert.equal(percentLabel(0.705), "71%");
  assert.equal(endsInPhrase(0), "ends today");
  assert.equal(endsInPhrase(1), "ends in 1 day");
  assert.equal(endsInPhrase(4), "ends in 4 days");
  assert.equal(endsInPhrase(0, true), "is past its end date");
  assert.equal(trialShortDate("2026-09-01T10:00:00Z", NOW), "1 Sep");
  assert.equal(trialShortDate("2025-09-01T10:00:00Z", NOW), "1 Sep 2025");
  assert.equal(trialFullUtc("2026-09-22T08:40:55Z"), "22 Sep 2026 08:40:55 UTC");
});

test("a recorded trial outcome wins over inference (20260925502000)", () => {
  // Converted on 3 Sep, cancelled since: it converted, and it ended on 3 Sep, not at cancellation.
  const convertedThenCancelled = { status: "cancelled", started_at: iso("2026-08-20"), trial_ends_at: iso("2026-09-03"), cancelled_at: iso("2026-09-20"), first_paid_at: null, trial_outcome: "converted", trial_outcome_at: iso("2026-09-03T10:00:00Z") };
  assert.equal(trialEndedAt(convertedThenCancelled, NOW).toISOString(), iso("2026-09-03T10:00:00Z"));
  assert.deepEqual(monthOutcome([convertedThenCancelled], NOW), { converted: 1, lapsed: 0, undated: 0 });

  // Without the recorded columns the same row reads as a lapse, dated by its cancellation.
  const inferred = { ...convertedThenCancelled, trial_outcome: undefined, trial_outcome_at: undefined };
  assert.deepEqual(monthOutcome([inferred], NOW), { converted: 0, lapsed: 1, undated: 0 });
});
