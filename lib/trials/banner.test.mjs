// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { trialBanner, calendarDaysUntil } from "./banner.ts";
import { REMINDER_OFFSET_DAYS } from "./reminders.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-08-30T12:00:00Z");
const endsIn = (days) => new Date(NOW.getTime() + days * DAY);

test("a tenant not on trial gets no banner", () => {
  assert.equal(trialBanner(null, NOW), null);
});

test("early in a trial the banner stays silent", () => {
  assert.equal(trialBanner(endsIn(10), NOW), null);
  assert.equal(trialBanner(endsIn(5), NOW), null);
});

test("the banner appears at the same moment the four-days email does", () => {
  const banner = trialBanner(endsIn(REMINDER_OFFSET_DAYS.four_days_left), NOW);
  assert.equal(banner?.tone, "info");
  assert.equal(banner?.daysRemaining, 4);
});

test("it turns urgent on the final day, matching the final-day email", () => {
  const banner = trialBanner(endsIn(REMINDER_OFFSET_DAYS.final_day), NOW);
  assert.equal(banner?.tone, "urgent");
  assert.match(banner.message, /ends tomorrow/);
});

test("the day count matches the date the message names", () => {
  // The original ceil() turned two days and thirty seconds into "3 days left" while the same
  // sentence named a date two days away. Counting calendar days keeps the two halves consistent.
  const twoDaysAndABit = new Date(NOW.getTime() + 2 * DAY + 30_000);
  const banner = trialBanner(twoDaysAndABit, NOW);
  assert.equal(banner?.daysRemaining, 2);
  assert.match(banner.message, /^2 days left/);
  assert.match(banner.message, /September 1/);
});

test("a trial ending later the same day says today, not tomorrow", () => {
  const banner = trialBanner(new Date(NOW.getTime() + 6 * 3_600_000), NOW);
  assert.equal(banner?.daysRemaining, 0);
  assert.equal(banner.tone, "urgent");
  assert.match(banner.message, /ends today/);
});

test("calendarDaysUntil counts dates, not elapsed time", () => {
  // Built from LOCAL date parts on purpose: the count has to agree with the date printed beside it,
  // and that date is rendered with toLocaleDateString. Ten minutes of elapsed time spanning
  // midnight is one day, and twenty-three hours inside one day is zero.
  const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);
  assert.equal(calendarDaysUntil(local(2026, 9, 1, 0, 5), local(2026, 8, 31, 23, 55)), 1);
  assert.equal(calendarDaysUntil(local(2026, 9, 1, 0, 5), local(2026, 8, 30, 23, 55)), 2);
  assert.equal(calendarDaysUntil(local(2026, 8, 31, 23, 0), local(2026, 8, 30, 1, 0)), 1);
  assert.equal(calendarDaysUntil(local(2026, 8, 30, 23, 0), local(2026, 8, 30, 1, 0)), 0);
});

test("an expired trial gets no banner — the subscription's status says what happened", () => {
  assert.equal(trialBanner(endsIn(-1), NOW), null);
  assert.equal(trialBanner(NOW, NOW), null);
});

test("the banner names the real charge date", () => {
  const banner = trialBanner(endsIn(3), NOW);
  assert.match(banner.message, /September 2/);
});
