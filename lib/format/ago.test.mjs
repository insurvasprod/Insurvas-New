import assert from "node:assert/strict";
import test from "node:test";

import { agoLabel } from "./ago.ts";

const now = Date.UTC(2026, 8, 24, 12, 0, 0);

test("a fresh moment reads just now, never zero seconds", () => {
  assert.equal(agoLabel(now, now), "just now");
  assert.equal(agoLabel(now - 4_000, now), "just now");
});

test("counts up in whole units, singular where it is one", () => {
  assert.equal(agoLabel(now - 18_000, now), "18 seconds ago");
  assert.equal(agoLabel(now - 60_000, now), "1 minute ago");
  assert.equal(agoLabel(now - 150_000, now), "2 minutes ago");
  assert.equal(agoLabel(now - 3_600_000, now), "1 hour ago");
  assert.equal(agoLabel(now - 3 * 86_400_000, now), "3 days ago");
});

test("a clock that runs behind the stamp does not go negative", () => {
  assert.equal(agoLabel(now + 30_000, now), "just now");
});

import { activityLabel, dayMonth, dayMonthTime, expiresInLabel } from "./ago.ts";

test("dates read as the team board draws them, with a year only when it differs", () => {
  const now = new Date(2026, 8, 24, 12, 0);
  assert.equal(dayMonth(new Date(2026, 7, 2), now), "2 Aug");
  assert.equal(dayMonth(new Date(2025, 8, 30), now), "30 Sep 2025");
  assert.equal(dayMonthTime(new Date(2026, 8, 24, 9, 5), now), "24 Sep 09:05");
});

test("last activity counts minutes, hours and days, then turns into a date", () => {
  const at = new Date(2026, 8, 24, 12, 0).getTime();
  assert.equal(activityLabel(at - 30_000, at), "just now");
  assert.equal(activityLabel(at - 12 * 60_000, at), "12 min ago");
  assert.equal(activityLabel(at - 60 * 60_000, at), "1 hr ago");
  assert.equal(activityLabel(at - 2 * 86_400_000, at), "2 days ago");
  assert.equal(activityLabel(new Date(2026, 7, 2, 10).getTime(), at), "2 Aug");
});

test("an invitation's time left, and one that has run out", () => {
  const at = Date.UTC(2026, 8, 24, 12);
  assert.equal(expiresInLabel(at + 2 * 86_400_000 + 3_600_000, at), "expires in 2 days");
  assert.equal(expiresInLabel(at + 5 * 3_600_000, at), "expires in 5 hours");
  assert.equal(expiresInLabel(at + 20 * 60_000, at), "expires within the hour");
  assert.equal(expiresInLabel(at - 1, at), "expired");
});
