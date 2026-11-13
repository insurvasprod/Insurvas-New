// Settings › Inbound settings round 8: the ladder you drag and step, never type.
import { test } from "node:test";
import assert from "node:assert/strict";

import { chipTimes, durationLabel, ladderChanges, ladderScale, placeRung, rungLimits, stepRung, stoppedSentence } from "./scale.ts";

const board = { warn: 45, escalate: 90, partner: 180, expire: 300 };

test("durations read as the board writes them", () => {
  assert.equal(durationLabel(45), "45 s");
  assert.equal(durationLabel(90), "1 min 30 s");
  assert.equal(durationLabel(180), "3 min");
  assert.equal(durationLabel(14400), "4 h");
  assert.equal(durationLabel(5400), "1 h 30 min");
  assert.equal(durationLabel(172800), "2 d");
});

test("the board's ladder sits on a straight 0–6 min line; a 45 s to 4 h ladder goes logarithmic", () => {
  const straight = ladderScale(board);
  assert.equal(straight.kind, "linear");
  assert.equal(straight.max, 360);
  assert.equal(Math.round(straight.at(300) * 10000) / 100, 83.33);
  assert.deepEqual(straight.ticks, [0, 60, 120, 180, 240, 300, 360]);
  const wide = ladderScale({ warn: 45, escalate: 120, partner: 300, expire: 14400 });
  assert.equal(wide.kind, "log");
  const points = [45, 120, 300, 14400].map(wide.at);
  for (let i = 1; i < points.length; i += 1) assert.ok(points[i] - points[i - 1] > 0.07, "every rung has room");
  assert.ok(Math.abs(wide.seconds(wide.at(300)) - 300) < 0.001, "the drag inverse returns the value");
});

test("− and + move in 15-second steps early on and stop at the neighbours", () => {
  assert.equal(stepRung(board, "warn", 1), 60);
  assert.equal(stepRung(board, "warn", -1), 30);
  assert.equal(stepRung({ ...board, warn: 75 }, "warn", 1), 75, "held 15 s before Escalate");
  assert.equal(stepRung({ ...board, expire: 600 }, "expire", 1), 660, "a minute at a time past five minutes");
  assert.deepEqual(rungLimits(board, "escalate"), { min: 60, max: 165 });
});

test("a dragged rung snaps, and says which neighbour stopped it", () => {
  assert.deepEqual(placeRung(board, "escalate", 121), { value: 120, stopped: null });
  assert.deepEqual(placeRung(board, "escalate", 200), { value: 165, stopped: "partner" });
  assert.equal(stoppedSentence(board, "escalate", "partner"), "Escalate has to come at least 15 s before Partner notice (3 min).");
  assert.deepEqual(placeRung(board, "warn", 3), { value: 15, stopped: null });
});

test("chips offer round times near the rung, and grey the ones past a neighbour", () => {
  const chips = chipTimes({ ...board, escalate: 120 }, "escalate");
  assert.deepEqual(chips.map((chip) => chip.seconds), [60, 90, 120, 150, 180]);
  assert.deepEqual(chips.map((chip) => chip.allowed), [true, true, true, true, false]);
  assert.deepEqual(ladderChanges(board, { ...board, escalate: 120 }), [{ rung: "escalate", from: 90, to: 120 }]);
});
