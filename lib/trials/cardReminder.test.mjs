import test from "node:test";
import assert from "node:assert/strict";

import { cardReminderEmail, endDateWords } from "./cardReminder.ts";

const facts = { ownerName: "Rowan", businessName: "Rowan Test Insurance", planName: "Agency", trialEndsAt: "2026-11-19T15:00:00Z", daysLeft: 2, billingUrl: "https://app.insurvas.com/app/settings#billing" };

test("the reminder names the business, the plan, the end date and the way to add a card", () => {
  const email = cardReminderEmail(facts);
  assert.equal(email.subject, "Add a card to keep Rowan Test Insurance on Insurvas after November 19");
  assert.match(email.text, /^Hi Rowan,/);
  assert.match(email.text, /Agency trial for Rowan Test Insurance ends in 2 days, on November 19/);
  assert.match(email.text, /Add a card: https:\/\/app\.insurvas\.com\/app\/settings#billing/);
  assert.match(email.text, /Nothing is charged before the trial ends/);
});

test("the last day says so, and a missing name is not a blank", () => {
  const email = cardReminderEmail({ ...facts, ownerName: null, daysLeft: 1 });
  assert.equal(email.subject, "Your Insurvas trial ends tomorrow: add a card to keep going");
  assert.match(email.text, /^Hi there,/);
  assert.match(cardReminderEmail({ ...facts, daysLeft: 0 }).text, /ends today/);
});

test("dates are UTC and never 'Invalid Date'", () => {
  assert.equal(endDateWords("2026-12-01T00:30:00Z"), "December 1");
  assert.equal(endDateWords("nope"), "the end of your trial");
});
