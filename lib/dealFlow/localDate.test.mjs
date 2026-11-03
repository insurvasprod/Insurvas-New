// Run with: npm test
//
// LA-1.7 acceptance criterion 5: "The deal-flow date is correct for an agent working late in their
// own timezone."
//
// `scripts/verify-intake-pipeline.mjs` covers this against a `Pacific/Honolulu` partner, comparing
// the stored `local_date` with a date it computes itself. That is a real check, and it can only
// discriminate while Honolulu and UTC are on different dates — 00:00–10:00 UTC. For the other
// fourteen hours of the day the two agree, and a plain UTC implementation would pass it.
//
// (The 2026-09-22 run happened to land at 08:28 UTC, inside the window, so it did discriminate. That
// is luck, not coverage.)
//
// These run at fixed instants, so "working late" is exercised every time.
import { test } from "node:test";
import assert from "node:assert/strict";

import { intakeLocalDate } from "./localDate.ts";

test("a closer working late files under their own date, not UTC's", () => {
  // 22:30 in Honolulu on the 21st is already the 22nd in UTC. The lead belongs to the 21st.
  const lateInHonolulu = new Date("2026-09-22T08:30:00Z");
  assert.equal(intakeLocalDate("Pacific/Honolulu", lateInHonolulu), "2026-09-21");
  assert.equal(intakeLocalDate("UTC", lateInHonolulu), "2026-09-22", "the UTC date really has rolled over");
});

test("a closer working early files under their own date, ahead of UTC", () => {
  // The mirror case: 08:00 in Sydney on the 22nd is still the 21st in UTC.
  const earlyInSydney = new Date("2026-09-21T22:00:00Z");
  assert.equal(intakeLocalDate("Australia/Sydney", earlyInSydney), "2026-09-22");
  assert.equal(intakeLocalDate("UTC", earlyInSydney), "2026-09-21");
});

test("the format is the YYYY-MM-DD the date column expects", () => {
  assert.match(intakeLocalDate("America/New_York", new Date("2026-01-05T17:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
  // Zero-padded, not 2026-1-5.
  assert.equal(intakeLocalDate("America/New_York", new Date("2026-01-05T17:00:00Z")), "2026-01-05");
});

test("a daylight-saving boundary does not shift the date", () => {
  // US DST ended 2026-11-01 at 02:00 local. 05:30 UTC is 01:30 EDT on the 1st, before the shift;
  // 07:30 UTC is 02:30 EST, after it. Both are still the 1st.
  assert.equal(intakeLocalDate("America/New_York", new Date("2026-11-01T05:30:00Z")), "2026-11-01");
  assert.equal(intakeLocalDate("America/New_York", new Date("2026-11-01T07:30:00Z")), "2026-11-01");
  // And 03:30 UTC on the 2nd is 22:30 on the 1st, still the agent's 1st.
  assert.equal(intakeLocalDate("America/New_York", new Date("2026-11-02T03:30:00Z")), "2026-11-01");
});

test("every partner timezone in use resolves rather than throwing", () => {
  // A bad timezone string makes Intl throw, which would fail the intake write rather than the
  // deal-flow row — the one write LA-1.7 says must never be put at risk by a best-effort step.
  for (const zone of ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "Australia/Sydney"]) {
    assert.match(intakeLocalDate(zone, new Date("2026-06-15T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/, zone);
  }
});
