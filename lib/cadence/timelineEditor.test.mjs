// Run with: npm test
//
// Settings › Dialing cadence, round 8 board A: the timeline editor. The screen edits CALLS on days;
// the table stores RULES ("rule N = the wait before dial N"). These pin the translation (draft.ts), the
// example lead the timeline draws (timeline.ts) and the words History and the save bar use (changes.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_CADENCE } from "./engine.ts";
import { effectiveLadder } from "./ladder.ts";
import {
  PRESETS,
  applyPreset,
  differingCalls,
  joinOutcome,
  matchPreset,
  materialize,
  patchCall,
  removeCall,
  shiftWait,
  splitInterval,
  splitOutcome,
} from "./draft.ts";
import { closedDay, simulateCadence, summarize, clockLabel, dayLabel } from "./timeline.ts";
import { describeChanges, readableInterval } from "./changes.ts";

const root = process.cwd();
const RULES = { window: { start: 9 * 60, end: 20 * 60 }, noSunday: true, noHolidays: true, holidays: { "2026-11-26": "Thanksgiving Day" } };
const steps = (rows, last = 7, outcome = null) => effectiveLadder(rows, [], { lastAttempt: last, outcome });

test("materialise writes the running ladder into rows 2..last, so a save can never have a gap", () => {
  const rows = materialize([], [], 7);
  assert.deepEqual(rows.map((row) => row.attemptNumber), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(rows.map((row) => row.delayInterval), DEFAULT_CADENCE.map((row) => row.delayInterval));
  // A campaign with no rules of its own starts from the agency (tenant) cadence it runs today.
  const tenant = [{ attemptNumber: 2, delayInterval: "3 hours", preferredSlot: null, dispositionScope: null }];
  const campaign = materialize([], tenant, 3);
  assert.equal(campaign.find((row) => row.attemptNumber === 2).delayInterval, "3 hours");
  assert.equal(campaign.find((row) => row.attemptNumber === 3).delayInterval, "1 day");
  // Max calls raised past seven: the new call gets the scheduler's own fallback, five days.
  assert.equal(materialize([], [], 8).at(-1).delayInterval, "5 days");
});

test("an outcome tab edits that outcome's own rule when it has one, otherwise the shared rule", () => {
  let rows = materialize([], [], 7);
  rows = patchCall(rows, 3, "voicemail", { delayInterval: "2 days" });
  assert.equal(rows.find((row) => row.attemptNumber === 3 && !row.dispositionScope).delayInterval, "2 days", "no own rule: the shared one changes");
  rows = splitOutcome(rows, 3, "voicemail");
  rows = patchCall(rows, 3, "voicemail", { delayInterval: "4 days" });
  assert.equal(rows.find((row) => row.attemptNumber === 3 && row.dispositionScope === "voicemail").delayInterval, "4 days");
  assert.equal(rows.find((row) => row.attemptNumber === 3 && !row.dispositionScope).delayInterval, "2 days", "the shared rule is untouched");
  assert.deepEqual(differingCalls(rows, "voicemail", 7), [3]);
  // The voicemail tab's ladder reads its own rule; no answer reads the shared one.
  assert.equal(steps(rows, 7, "voicemail").find((s) => s.attempt === 3).delayInterval, "4 days");
  assert.equal(steps(rows, 7, "no_answer").find((s) => s.attempt === 3).delayInterval, "2 days");
  rows = joinOutcome(rows, 3, "voicemail");
  assert.deepEqual(differingCalls(rows, "voicemail", 7), []);
});

test("removing a call moves every later call up one and keeps their waits", () => {
  const rows = removeCall(materialize([], [], 7), 3);
  assert.deepEqual(rows.map((row) => [row.attemptNumber, row.delayInterval]), [[2, "2 hours"], [3, "1 day"], [4, "2 days"], [5, "3 days"], [6, "5 days"]]);
});

test("dragging a dot by days changes only that call's wait, never to zero", () => {
  assert.equal(shiftWait("1 day", 1), "2 days");
  assert.equal(shiftWait("3 days", -1), "2 days");
  assert.equal(shiftWait("1 day", -1), "2 hours", "back to the same day: the built-in same-day retry");
  assert.equal(shiftWait("3 hours", 1), "1 day");
  assert.equal(shiftWait("3 hours", -1), "3 hours", "a same-day wait cannot move earlier than its day");
  assert.deepEqual(splitInterval("1 week"), { amount: 7, unit: "day" });
  assert.deepEqual(splitInterval("90 minutes"), { amount: 90, unit: "minute" });
});

test("presets fill the existing rule model; Balanced is exactly the Insurvas default", () => {
  const balanced = PRESETS.find((preset) => preset.key === "balanced");
  assert.equal(balanced.maxAttempts, 7);
  assert.equal(matchPreset(materialize([], [], 7), 7), "balanced");
  for (const preset of PRESETS) {
    const rows = applyPreset([], preset);
    assert.equal(matchPreset(rows, preset.maxAttempts), preset.key);
    const numbers = rows.map((row) => row.attemptNumber);
    assert.deepEqual(numbers, Array.from({ length: preset.maxAttempts - 1 }, (_, index) => index + 2), `${preset.key} has no gap and ends at its max`);
  }
  // An outcome's own rules survive a preset for the calls it still makes.
  const own = [{ attemptNumber: 3, delayInterval: "4 days", preferredSlot: null, dispositionScope: "voicemail" }, { attemptNumber: 9, delayInterval: "4 days", preferredSlot: null, dispositionScope: "busy" }];
  const gentle = applyPreset(own, PRESETS.find((preset) => preset.key === "gentle"));
  assert.ok(gentle.some((row) => row.dispositionScope === "voicemail"));
  assert.ok(!gentle.some((row) => row.dispositionScope === "busy"));
  assert.equal(matchPreset(gentle, 5), "gentle");
});

test("the example lead walks the default cadence, and Sundays and holidays move calls", () => {
  // Mon 16 Nov 2026, 9:40am: the board's own example.
  const sim = simulateCadence({ steps: steps([]), startDate: "2026-11-16", arrival: 9 * 60 + 40, rules: RULES });
  assert.equal(sim.calls.length, 7);
  assert.equal(sim.calls[0].at, 9 * 60 + 40);
  assert.equal(dayLabel("2026-11-16", 0), "Mon 16");
  assert.equal(clockLabel(9 * 60 + 40), "9:40am");
  // Each call is at least its wait after the one before (the wait is a floor).
  for (let index = 1; index < sim.calls.length; index += 1) assert.ok(sim.calls[index].at > sim.calls[index - 1].at);
  // Nothing lands on a closed day.
  for (const call of sim.calls) assert.equal(closedDay("2026-11-16", call.day, RULES), null, `call ${call.n} on a closed day`);
  assert.equal(closedDay("2026-11-16", 6, RULES), "Sunday");
  assert.equal(closedDay("2026-11-16", 10, RULES), "Thanksgiving Day");
  const words = summarize(sim);
  assert.equal(words.calls, 7);
  assert.match(words.headline, /^7 calls over \d+ days$/);
});

test("a call due on a no-call day is marked moved, with where the rule wanted it", () => {
  // Call 2 waits 6 days from Monday 9:40am: due Sunday, which takes no calls.
  const rows = [{ attemptNumber: 2, delayInterval: "6 days", preferredSlot: null, dispositionScope: null }];
  const sim = simulateCadence({ steps: steps(rows, 2), startDate: "2026-11-16", arrival: 580, rules: RULES });
  const moved = sim.calls[1];
  assert.equal(moved.moved, true);
  assert.equal(moved.movedBecause, "Sunday");
  assert.equal(moved.wanted.day, 6);
  assert.ok(moved.day > 6);
  // Without the Sunday rule nothing moves.
  const open = simulateCadence({ steps: steps(rows, 2), startDate: "2026-11-16", arrival: 580, rules: { ...RULES, noSunday: false } });
  assert.equal(open.calls[1].moved, false);
});

test("History and the save bar say what changed in words", () => {
  const before = materialize([], [], 7);
  const after = patchCall(patchCall([...before, { attemptNumber: 8, delayInterval: "1 day", preferredSlot: "afternoon", dispositionScope: null }], 5, null, { delayInterval: "3 days" }), 3, null, { preferredSlot: "evening" });
  const texts = describeChanges(before, after).map((change) => change.text);
  assert.deepEqual(texts, ["Call 3 in the evening (was any time)", "Call 5 waits 3 days (was 2 days)", "Added call 8: 1 day after call 7, in the afternoon (noon–3pm)"]);
  assert.deepEqual(describeChanges(before, before), []);
  // "24 hours" and "1 day" are the same wait.
  assert.deepEqual(describeChanges([{ attemptNumber: 2, delayInterval: "1 day" }], [{ attemptNumber: 2, delayInterval: "24 hours" }]), []);
  assert.equal(readableInterval("02:00:00"), "2 hours");
  assert.equal(readableInterval("1 day"), "1 day");
});

test("the screen is built on the shared pieces and draws no notice cards", () => {
  const screen = readFileSync(join(root, "components", "app", "cadence-settings.tsx"), "utf8");
  assert.doesNotMatch(screen, /<Callout\b/, "notices go in the status line (owner rule 2026-11-02)");
  assert.match(screen, /simulateCadence\(/, "the timeline draws the scheduler's example, not a guess");
  assert.match(screen, /OUTCOMES/, "the tabs are the real outcome codes");
  assert.doesNotMatch(screen, /hung_up|Hung up/, "there is no Hung up outcome");
});
