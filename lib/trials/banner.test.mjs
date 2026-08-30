// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { trialBanner } from "./banner.ts";
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

test("part of a day still counts as a whole day, so the charge date is never overstated as sooner", () => {
  // 30 hours left is "2 days", not 1 — rounding down would tell the customer the wrong date.
  const banner = trialBanner(new Date(NOW.getTime() + 30 * 3_600_000), NOW);
  assert.equal(banner?.daysRemaining, 2);
});

test("an expired trial gets no banner — the subscription's status says what happened", () => {
  assert.equal(trialBanner(endsIn(-1), NOW), null);
  assert.equal(trialBanner(NOW, NOW), null);
});

test("the banner names the real charge date", () => {
  const banner = trialBanner(endsIn(3), NOW);
  assert.match(banner.message, /September 2/);
});
