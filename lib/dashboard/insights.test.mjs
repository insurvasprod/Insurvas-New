import assert from "node:assert/strict";
import test from "node:test";

import { hourHeatmap, hourLabel, leaderboard, outcomeMix, periodChange } from "./insights.ts";

const row = (attempted_at, disposition, agent_id = "a") => ({ attempted_at, disposition, agent_id });

test("the outcome mix adds up to the dials, and folds a long tail into Other", () => {
  const rows = [
    row("2026-09-24T15:00:00Z", "no_answer"), row("2026-09-24T15:05:00Z", "no_answer"),
    row("2026-09-24T15:10:00Z", "interested"), row("2026-09-24T15:15:00Z", null),
  ];
  const mix = outcomeMix(rows, { interested: "Interested" });
  assert.deepEqual(mix.map((item) => [item.label, item.count, item.contact]), [["No answer", 2, false], ["Interested", 1, true], ["Not recorded", 1, false]]);

  const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((key, index) => Array.from({ length: 8 - index }, () => row("2026-09-24T15:00:00Z", key))).flat();
  const folded = outcomeMix(many, {}, 5);
  assert.equal(folded.length, 6);
  assert.equal(folded[5].label, "Other (3)");
  assert.equal(folded.reduce((sum, item) => sum + item.count, 0), many.length);
});

test("the heatmap buckets by the agency's hour and finds the best hour", () => {
  const days = [{ key: "2026-09-23", weekday: "Wed", label: "23 Sep" }, { key: "2026-09-24", weekday: "Thu", label: "24 Sep" }];
  // 19:00Z is 2 PM in Chicago (CDT).
  const rows = [
    row("2026-09-24T19:00:00Z", "interested"), row("2026-09-24T19:10:00Z", "interested"), row("2026-09-24T19:20:00Z", "no_answer"),
    row("2026-09-23T14:00:00Z", "no_answer"), row("2026-09-23T14:10:00Z", "no_answer"), row("2026-09-23T14:20:00Z", "voicemail"),
    row("2026-09-20T19:00:00Z", "interested"), // outside the window
  ];
  const heat = hourHeatmap(rows, "America/Chicago", days);
  assert.equal(heat.hours[0], 8);
  assert.equal(heat.hours.at(-1), 20);
  const thu = heat.days[1].cells[14 - 8];
  assert.deepEqual(thu, { dials: 3, contacts: 2 });
  assert.equal(heat.days[0].cells[9 - 8].dials, 3);
  assert.equal(heat.best.hour, 14);
  assert.equal(Math.round(heat.best.rate), 67);
  assert.equal(heat.maxDials, 3);
});

test("an early dial widens the hours instead of disappearing", () => {
  const days = [{ key: "2026-09-24", weekday: "Thu", label: "24 Sep" }];
  const heat = hourHeatmap([row("2026-09-24T11:30:00Z", "no_answer")], "America/Chicago", days);
  assert.equal(heat.hours[0], 6);
  assert.equal(heat.best, null, "one dial is not enough to call an hour the best");
});

test("the leaderboard ranks by dials and names who it can", () => {
  const rows = [row("2026-09-24T15:00:00Z", "interested", "u1"), row("2026-09-24T15:00:00Z", "no_answer", "u2"), row("2026-09-24T15:00:00Z", "no_answer", "u2"), row("2026-09-24T15:00:00Z", "no_answer", null)];
  assert.deepEqual(leaderboard(rows, { u1: "Ray" }), [
    { userId: "u2", name: "Former member", dials: 2, contacts: 0 },
    { userId: "u1", name: "Ray", dials: 1, contacts: 1 },
  ]);
});

test("labels and changes", () => {
  assert.equal(hourLabel(0), "12 AM");
  assert.equal(hourLabel(14), "2 PM");
  assert.equal(periodChange(15, 10), 50);
  assert.equal(periodChange(5, 0), null);
});
