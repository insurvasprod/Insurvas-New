import assert from "node:assert/strict";
import test from "node:test";
import { endOfToday as endOfTodayForDiary } from "./todayMath.ts";

test("today's diary runs to the agency's next midnight, not to now", () => {
  // 14:30 in New York on 29 Sep 2026 (EDT, UTC-4): the day ends at 04:00Z on the 30th.
  assert.equal(endOfTodayForDiary(Date.parse("2026-09-29T18:30:00Z"), "America/New_York"), "2026-09-30T04:00:00.000Z");
  // Across the November change (EDT -> EST): the day of 1 Nov ends at 05:00Z on the 2nd.
  assert.equal(endOfTodayForDiary(Date.parse("2026-11-01T12:00:00Z"), "America/New_York"), "2026-11-02T05:00:00.000Z");
  // Manila has no DST: 23:30 local on the 29th ends at 16:00Z that day.
  assert.equal(endOfTodayForDiary(Date.parse("2026-09-29T15:30:00Z"), "Asia/Manila"), "2026-09-29T16:00:00.000Z");
});

import { contactRate, countdown, dayOnDay, greeting, lastDays, longDate } from "./todayMath.ts";

const NOW = Date.parse("2026-09-24T18:30:00Z"); // 13:30 in Chicago, 11:30 in Phoenix

test("fourteen agency-local days, oldest first, the last one ending now", () => {
  const days = lastDays(NOW, "America/Chicago");
  assert.equal(days.length, 14);
  assert.equal(days[13].key, "2026-09-24");
  assert.equal(days[13].isToday, true);
  assert.equal(days[13].end, new Date(NOW).toISOString());
  assert.equal(days[13].start, "2026-09-24T05:00:00.000Z"); // midnight CDT
  assert.equal(days[0].key, "2026-09-11");
  // Contiguous: each day ends where the next begins.
  for (let i = 0; i < 12; i += 1) assert.equal(days[i].end, days[i + 1].start);
});

test("a DST change inside the window still gives whole local days", () => {
  const days = lastDays(Date.parse("2026-11-03T18:00:00Z"), "America/New_York");
  const fallBack = days.find((day) => day.key === "2026-11-01");
  assert.ok(fallBack);
  assert.equal((Date.parse(fallBack.end) - Date.parse(fallBack.start)) / 3_600_000, 25);
});

test("greeting and date follow the agency's clock, not UTC", () => {
  assert.equal(greeting(NOW, "America/Chicago"), "Good afternoon");
  assert.equal(greeting(NOW, "America/Phoenix"), "Good morning");
  assert.equal(longDate(NOW, "America/Chicago"), "Thursday 24 September");
});

test("no dials is no rate, not 0%", () => {
  assert.equal(contactRate(0, 0), null);
  assert.equal(contactRate(8, 5), 62.5);
});

test("day on day says which way, and says nothing without a yesterday", () => {
  assert.deepEqual(dayOnDay(12, 9), { text: "+3 on yesterday", tone: "good" });
  assert.deepEqual(dayOnDay(4, 9), { text: "5 fewer than yesterday", tone: "warning" });
  assert.deepEqual(dayOnDay(5, 5), { text: "same as yesterday", tone: "neutral" });
  assert.equal(dayOnDay(5, null), null);
});

test("countdown ticks in seconds under an hour and admits lateness", () => {
  assert.deepEqual(countdown(NOW + 724_000, NOW), { text: "in 12m 04s", late: false });
  assert.deepEqual(countdown(NOW + 2 * 3_600_000 + 5 * 60_000, NOW), { text: "in 2h 05m", late: false });
  assert.deepEqual(countdown(NOW - 3 * 60_000, NOW), { text: "3 min late", late: true });
});
