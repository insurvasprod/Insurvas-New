import assert from "node:assert/strict";
import test from "node:test";

import { customerClock, faceAmountCents, faceLabel, productLabel, startsInLabel } from "./appointmentFacts.ts";

test("the face amount comes from the lead, in whichever unit the field carries", () => {
  assert.equal(faceAmountCents({ coverage_wanted: 1_500_000 }), 1_500_000);
  assert.equal(faceAmountCents({ face_amount_cents: "2500000" }), 2_500_000);
  assert.equal(faceAmountCents({ face_amount: "$15,000" }), 1_500_000);
  assert.equal(faceAmountCents({ coverage_amount: 250000 }), 25_000_000);
  assert.equal(faceAmountCents({ state: "TX" }), null);
  assert.equal(faceAmountCents({ face_amount: "unknown" }), null);
  assert.equal(faceAmountCents(null), null);
});

test("face amounts read the way an agent says them", () => {
  assert.equal(faceLabel(1_500_000), "$15k face");
  assert.equal(faceLabel(25_000_000), "$250k face");
  assert.equal(faceLabel(150_000_000), "$1.5M face");
  assert.equal(faceLabel(850_000), "$8,500 face");
  assert.equal(faceLabel(null), null);
});

test("product lines are named, not keyed", () => {
  assert.equal(productLabel("final_expense"), "Final expense");
  assert.equal(productLabel(""), null);
  assert.equal(productLabel(null), null);
});

test("a countdown only for the next few hours, never for the past", () => {
  const now = Date.UTC(2026, 8, 22, 18, 0);
  assert.equal(startsInLabel(now + 24 * 60_000, now), "in 24 min");
  assert.equal(startsInLabel(now + 65 * 60_000, now), "in 1 h 5 min");
  assert.equal(startsInLabel(now + 120 * 60_000, now), "in 2 h");
  assert.equal(startsInLabel(now - 60_000, now), null);
  assert.equal(startsInLabel(now + 4 * 3_600_000, now), null);
});

test("the customer's own clock is said only when it differs from the agent's", () => {
  const iso = "2026-09-22T19:00:00.000Z";
  assert.equal(customerClock(iso, "America/Los_Angeles", "America/New_York"), "12:00 pm their time · PT");
  assert.equal(customerClock(iso, "America/New_York", "America/New_York"), null);
  assert.equal(customerClock(iso, null, "America/New_York"), null);
});
