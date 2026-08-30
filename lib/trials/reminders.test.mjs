// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { dueReminders, dueAtFor, reminderBody, REMINDER_OFFSET_DAYS } from "./reminders.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-08-30T12:00:00Z");
const endsIn = (days) => new Date(NOW.getTime() + days * DAY);

const FACTS = {
  name: "Marcus",
  businessName: "Hill Insurance",
  planName: "Plan B",
  priceLabel: "$249.00 / month",
  daysRemaining: 4,
  trialEndsAt: endsIn(4),
  hasLoggedIn: true,
};

test("a trial with 5 days left is due nothing yet", () => {
  assert.deepEqual(dueReminders(endsIn(5), [], NOW), []);
});

test("a trial with 4 days left is due the four-days note", () => {
  const due = dueReminders(endsIn(4), [], NOW);

  assert.equal(due.length, 1);
  assert.equal(due[0].kind, "four_days_left");
});

test("a trial with 1 day left is due both, if neither was sent", () => {
  // A job that missed a day catches up rather than skipping someone silently.
  const due = dueReminders(endsIn(1), [], NOW).map((d) => d.kind);

  assert.deepEqual(due.sort(), ["final_day", "four_days_left"]);
});

test("a reminder already sent is never sent again", () => {
  const due = dueReminders(endsIn(1), ["four_days_left"], NOW).map((d) => d.kind);

  assert.deepEqual(due, ["final_day"]);
});

test("a trial that has already ended is due nothing", () => {
  // Telling someone they have 4 days left after their trial ended would be false.
  assert.deepEqual(dueReminders(endsIn(-1), [], NOW), []);
});

test("extending a trial moves every reminder, not just the next one", () => {
  // The criterion, expressed structurally: due dates are derived from the END, so moving the end
  // moves them all. There is no code that has to remember to shift them.
  const before = endsIn(2);
  const after = new Date(before.getTime() + 7 * DAY);

  for (const kind of ["four_days_left", "final_day"]) {
    const moved = dueAtFor(after, kind).getTime() - dueAtFor(before, kind).getTime();
    assert.equal(moved, 7 * DAY, `${kind} did not move with the trial end`);
  }

  // And a trial extended out of range stops being due anything it has not already had.
  assert.deepEqual(dueReminders(after, [], NOW), []);
});

test("offsets are days before the end, not days since the start", () => {
  assert.equal(REMINDER_OFFSET_DAYS.four_days_left, 4);
  assert.equal(REMINDER_OFFSET_DAYS.final_day, 1);
});

test("reminder text carries the customer's real figures, not placeholders", () => {
  const { subject, text } = reminderBody("four_days_left", FACTS);

  assert.match(text, /Hill Insurance/);
  assert.match(text, /Plan B/);
  assert.match(text, /\$249\.00/);
  assert.match(subject, /4 days left/);
  // The thing that would betray a template.
  assert.doesNotMatch(text + subject, /\{\{|\$\{|PLACEHOLDER|TODO/);
});

test("someone who has never signed in gets a different message", () => {
  const engaged = reminderBody("four_days_left", FACTS);
  const dormant = reminderBody("four_days_left", { ...FACTS, hasLoggedIn: false });

  assert.notEqual(engaged.subject, dormant.subject);
  assert.match(dormant.text, /haven't seen you sign in/i);
});

test("the final-day message says the card will be charged", () => {
  const { text } = reminderBody("final_day", FACTS);

  assert.match(text, /charged \$249\.00/);
  assert.match(text, /cancel before/i);
});
