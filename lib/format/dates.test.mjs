import assert from "node:assert/strict";
import test from "node:test";

import { clockTime, dateTime, dayMonth, dayMonthYear, weekdayDayMonth, zoneAbbreviation, zonedParts } from "./dates.ts";

const at = "2026-09-24T14:05:00Z"; // a Thursday

test("September is Sep, whatever this runtime's ICU prints for en-GB", () => {
  assert.equal(dayMonth(at), "24 Sep");
  assert.equal(dayMonthYear(at), "24 Sep 2026");
  assert.equal(dayMonthYear("2026-06-01T00:00:00Z"), "1 Jun 2026");
});

test("a bare calendar day is that day in every zone", () => {
  assert.equal(dayMonthYear("2026-09-24"), "24 Sep 2026");
  assert.equal(dayMonthYear("2026-09-24", "America/Los_Angeles"), "24 Sep 2026");
  assert.equal(dayMonthYear("2026-09-24", "Pacific/Kiritimati"), "24 Sep 2026");
  assert.equal(zonedParts("2026-09-24", "UTC").weekday, 4);
  assert.equal(weekdayDayMonth("2026-09-24", "America/Los_Angeles"), "Thu 24 Sep");
});

test("a moment reads as the wall clock of the zone asked for", () => {
  assert.equal(dateTime(at, "UTC"), "24 Sep, 14:05");
  assert.equal(dateTime(at, "America/New_York"), "24 Sep, 10:05");
  assert.equal(dateTime("2026-09-24T02:30:00Z", "America/Los_Angeles", { weekday: true }), "Wed 23 Sep, 19:30");
  assert.equal(weekdayDayMonth("2026-09-24T02:30:00Z", "America/Los_Angeles"), "Wed 23 Sep");
  assert.equal(weekdayDayMonth("2026-09-24T02:30:00Z"), "Thu 24 Sep");
  assert.equal(dateTime("2026-09-24T22:30:00Z", "Asia/Kolkata", { weekday: true, year: true }), "Fri 25 Sep 2026, 04:00");
});

test("the clock is 24-hour by default and 12-hour on request", () => {
  assert.equal(clockTime(at, "UTC"), "14:05");
  assert.equal(clockTime(at, "UTC", "12h"), "2:05 PM");
  assert.equal(clockTime("2026-09-24T00:07:00Z", "UTC"), "00:07");
  assert.equal(clockTime("2026-09-24T00:07:00Z", "UTC", "12h"), "12:07 AM");
  assert.equal(clockTime("2026-09-24T12:00:00Z", "UTC", "12h"), "12:00 PM");
});

test("New York's spring-forward gap and fall-back repeat read as the clock on the wall", () => {
  // 8 Mar 2026: 02:00 EST jumps to 03:00 EDT at 07:00 UTC.
  assert.equal(dateTime("2026-03-08T06:59:00Z", "America/New_York", { zoneLabel: true }), "8 Mar, 01:59 EST");
  assert.equal(dateTime("2026-03-08T07:00:00Z", "America/New_York", { zoneLabel: true }), "8 Mar, 03:00 EDT");
  // 1 Nov 2026: 01:00–01:59 happens twice, EDT then EST.
  assert.equal(dateTime("2026-11-01T05:30:00Z", "America/New_York", { zoneLabel: true }), "1 Nov, 01:30 EDT");
  assert.equal(dateTime("2026-11-01T06:30:00Z", "America/New_York", { zoneLabel: true }), "1 Nov, 01:30 EST");
});

test("a DST change can move the day, not just the hour", () => {
  // London goes to BST at 01:00 UTC on 29 Mar 2026; 23:30 UTC the night before is still 28 Mar there.
  assert.equal(dayMonth("2026-03-28T23:30:00Z", "Europe/London"), "28 Mar");
  assert.equal(dateTime("2026-03-29T01:30:00Z", "Europe/London", { zoneLabel: true }), "29 Mar, 02:30 GMT+1");
  // Sydney leaves daylight time on 5 Apr 2026: 13:30 UTC is 00:30 on the 5th before, 23:30 the 4th after.
  assert.equal(dateTime("2026-04-04T13:30:00Z", "Australia/Sydney"), "5 Apr, 00:30");
  assert.equal(dateTime("2026-04-05T13:30:00Z", "Australia/Sydney"), "5 Apr, 23:30");
});

test("UTC is labelled UTC, and a zone's label follows the moment", () => {
  assert.equal(dateTime(at, "UTC", { year: true, zoneLabel: true }), "24 Sep 2026, 14:05 UTC");
  assert.equal(zoneAbbreviation("2026-01-15T12:00:00Z", "America/Chicago"), "CST");
  assert.equal(zoneAbbreviation("2026-07-15T12:00:00Z", "America/Chicago"), "CDT");
});

test("missing, bad and unknown inputs never throw mid-render", () => {
  assert.equal(dayMonth(null), "—");
  assert.equal(dayMonthYear(undefined), "—");
  assert.equal(dayMonthYear("not a date"), "—");
  assert.equal(dateTime("", "UTC"), "—");
  assert.equal(dayMonthYear("2026-13-01"), "—");
  assert.equal(dayMonth(at, "Not/AZone"), "24 Sep", "an unknown zone falls back to UTC");
  assert.equal(dayMonth(new Date(at)), "24 Sep");
  assert.equal(dayMonth(Date.parse(at)), "24 Sep");
});
