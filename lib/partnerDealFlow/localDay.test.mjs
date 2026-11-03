import test from "node:test";
import assert from "node:assert/strict";

import { dayLabel, daysBetweenDays, isFutureDay, isValidDay, resolveDay, todayIn } from "./localDay.ts";

/**
 * `deal_flow.local_date` is a local date. A page whose whole subject is one day has to read that
 * boundary the same way the write did — get it wrong and, for part of every day, it shows the
 * wrong deals under the right heading. These run at fixed instants so they discriminate at every
 * hour, not only while the machine's own zone disagrees with UTC.
 */

// 2026-11-01T06:30:00Z. Honolulu (UTC-10) is still on 31 October; Sydney (UTC+11) is on 1 November
// and will reach 2 November before Honolulu reaches 1 November.
const AT = new Date("2026-11-01T06:30:00Z");

/* ── The boundary ─────────────────────────────────────────────────────────────────────────────── */

test("today is the partner's day, not the server's", () => {
  assert.equal(todayIn("UTC", AT), "2026-11-01");
  assert.equal(todayIn("Pacific/Honolulu", AT), "2026-10-31", "ten hours behind, still yesterday");
  assert.equal(todayIn("Australia/Sydney", AT), "2026-11-01");
});

test("the day rolls at the partner's midnight, not at UTC's", () => {
  // 13:30 in Honolulu on the 31st; UTC has been on the 1st for most of a day.
  const lateUtc = new Date("2026-11-01T23:30:00Z");
  assert.equal(todayIn("UTC", lateUtc), "2026-11-01");
  assert.equal(todayIn("Pacific/Honolulu", lateUtc), "2026-11-01", "13:30 local, same date");
  assert.equal(todayIn("Australia/Sydney", lateUtc), "2026-11-02", "already tomorrow");
});

test("there is no deal flow for tomorrow, in whichever zone the partner is", () => {
  assert.equal(isFutureDay("2026-11-02", "UTC", AT), true);
  assert.equal(isFutureDay("2026-11-01", "UTC", AT), false, "today is not the future");
  assert.equal(isFutureDay("2026-10-31", "UTC", AT), false);
  // The same date is the future in one zone and not in another. This is the off-by-one.
  assert.equal(isFutureDay("2026-11-01", "Pacific/Honolulu", AT), true, "Honolulu has not reached it");
  assert.equal(isFutureDay("2026-11-01", "Australia/Sydney", AT), false, "Sydney is on it");
});

/* ── Days as values ───────────────────────────────────────────────────────────────────────────── */

test("a day is a real calendar day", () => {
  assert.equal(isValidDay("2026-11-01"), true);
  assert.equal(isValidDay("2028-02-29"), true, "2028 is a leap year");
});

test("a day that does not exist is not a day", () => {
  // 2026-02-29 is the one worth naming: it parses, rolls to 03-01, and only the round trip
  // catches it. A regex alone would let it through and the page would show an empty 1 March.
  for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-11-31", "2026-1-1", "01-11-2026", "", "today", null, undefined, 20261101]) {
    assert.equal(isValidDay(bad), false, String(bad));
  }
});

test("days apart is calendar arithmetic, including across a daylight-saving change", () => {
  assert.equal(daysBetweenDays("2026-11-01", "2026-11-01"), 0);
  assert.equal(daysBetweenDays("2026-10-25", "2026-11-01"), 7);
  // Both sides are already local dates in one zone, so a clock change in that zone cannot make
  // this 6.958 days and round to 7 by luck.
  assert.equal(daysBetweenDays("2026-10-31", "2026-11-02"), 2);
  assert.equal(daysBetweenDays("2026-11-02", "2026-10-31"), -2, "backwards is negative, not an error");
});

test("a day reads as a day, and is never shifted by the formatting", () => {
  // The stepper and the empty state. Formatted at UTC midnight in UTC: anything else would show
  // "Sun 1 Nov" to a reader west of Greenwich, which is the whole bug this module exists for.
  assert.equal(dayLabel("2026-11-02"), "Mon 2 Nov");
  assert.equal(dayLabel("2026-11-02", true), "Monday 2 November");
  assert.equal(dayLabel("2026-01-01"), "Thu 1 Jan");
  assert.equal(dayLabel("2026-12-31", true), "Thursday 31 December");
});

/* ── What the page is handed ──────────────────────────────────────────────────────────────────── */

test("no day asked for means today, where the partner is", () => {
  assert.equal(resolveDay(undefined, "UTC", AT), "2026-11-01");
  assert.equal(resolveDay(null, "Pacific/Honolulu", AT), "2026-10-31");
});

test("a day asked for is honoured when it is real and not in the future", () => {
  assert.equal(resolveDay("2026-10-20", "UTC", AT), "2026-10-20");
  assert.equal(resolveDay("2026-11-01", "UTC", AT), "2026-11-01", "today itself");
});

test("a stale or hand-edited day lands on today rather than erroring", () => {
  // The Pipeline treats a stale focus id the same way: ignored, not an error.
  for (const bad of ["2026-02-30", "not-a-day", "", "2026-11-02"]) {
    assert.equal(resolveDay(bad, "UTC", AT), "2026-11-01", String(bad));
  }
});

test("a future day is future by the partner's clock", () => {
  // 2026-11-01 exists for Sydney and not yet for Honolulu, from the same instant.
  assert.equal(resolveDay("2026-11-01", "Australia/Sydney", AT), "2026-11-01");
  assert.equal(resolveDay("2026-11-01", "Pacific/Honolulu", AT), "2026-10-31", "falls back to their today");
});
