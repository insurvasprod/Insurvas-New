// Run with: npm test
//
// Slot rotation is the thing this task exists for, so most of these are about it. The intervals are
// easy and were already roughly right; the slot diversity was promised in two places and built in
// none, and a test suite that only checked the delays would have shipped that gap again.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SLOTS,
  slotForLocalTime,
  nextSlot,
  parseInterval,
  scheduleNextAttempt,
  attemptsWithin,
  DEFAULT_CADENCE,
  DEFAULT_CEILING,
} from "./engine.ts";

const NOW = new Date("2026-06-10T15:00:00Z");

// ── slots from the clock ─────────────────────────────────────────────────────

test("the weekday hours map onto the five weekday slots", () => {
  assert.equal(slotForLocalTime(8, 3), "early_morning");
  assert.equal(slotForLocalTime(9, 3), "early_morning");
  assert.equal(slotForLocalTime(10, 3), "late_morning");
  assert.equal(slotForLocalTime(13, 3), "afternoon");
  assert.equal(slotForLocalTime(16, 3), "early_evening");
  assert.equal(slotForLocalTime(20, 3), "late_evening");
});

test("a weekend hour is the weekend slot, whatever the hour says", () => {
  // Saturday at 10am is not "late morning" for rotation purposes — it is a Saturday, and that is
  // the hypothesis being tested.
  assert.equal(slotForLocalTime(10, 6), "weekend");
  assert.equal(slotForLocalTime(19, 0), "weekend");
});

// ── rotation: the promise nobody kept ────────────────────────────────────────

test("a lead is never retried into a slot it has already failed in", () => {
  const tried = ["early_morning"];
  const { slot } = nextSlot({ triedSlots: tried });
  assert.notEqual(slot, "early_morning");
});

test("four attempts produce four different slots, not the same one four times", () => {
  const tried = [];
  for (let i = 0; i < 4; i += 1) {
    const { slot } = nextSlot({ triedSlots: tried });
    assert.ok(!tried.includes(slot), `attempt ${i + 1} repeated ${slot}`);
    tried.push(slot);
  }
  assert.equal(new Set(tried).size, 4);
});

test("a preferred slot is honoured only while it is unused", () => {
  assert.equal(nextSlot({ triedSlots: [], preferred: "weekend" }).slot, "weekend");
  assert.equal(nextSlot({ triedSlots: [], preferred: "weekend" }).reason, "preferred_unused");

  // Already failed there: the stored preference must not override the evidence.
  const after = nextSlot({ triedSlots: ["weekend"], preferred: "weekend" });
  assert.notEqual(after.slot, "weekend");
});

test("once every slot is used, rotation falls back rather than refusing to call", () => {
  const { slot, reason } = nextSlot({ triedSlots: [...SLOTS] });
  assert.ok(SLOTS.includes(slot));
  assert.equal(reason, "least_recent");
});

test("a narrow window cannot produce a slot it does not reach", () => {
  // A 9-17 tenant window never reaches late_evening. Suggesting it would schedule a call that
  // LA-2.4 would then refuse — the two engines must not disagree.
  const available = ["early_morning", "late_morning", "afternoon", "early_evening"];
  for (let i = 0; i < 8; i += 1) {
    const { slot } = nextSlot({ triedSlots: SLOTS.slice(0, i), availableSlots: available });
    assert.ok(available.includes(slot), `${slot} is outside the available set`);
  }
});

test("a preferred slot outside the window is ignored rather than scheduled", () => {
  const available = ["early_morning", "late_morning"];
  const { slot } = nextSlot({ triedSlots: [], preferred: "weekend", availableSlots: available });
  assert.ok(available.includes(slot));
});

// ── interval validation ──────────────────────────────────────────────────────

test("a valid interval parses to milliseconds", () => {
  assert.deepEqual(parseInterval("2 hours"), { ok: true, ms: 7_200_000 });
  assert.deepEqual(parseInterval("1 day"), { ok: true, ms: 86_400_000 });
  assert.deepEqual(parseInterval("30 minutes"), { ok: true, ms: 1_800_000 });
  assert.equal(parseInterval("1 week").ms, 604_800_000);
});

test("banana is rejected at entry rather than sent to Postgres", () => {
  // The current field accepts any string and sends it as an interval. This is that bug's test.
  const result = parseInterval("banana");
  assert.equal(result.ok, false);
  assert.match(result.error, /not a valid delay/);
});

test("empty, zero and negative delays are refused", () => {
  assert.equal(parseInterval("").ok, false);
  assert.equal(parseInterval("   ").ok, false);
  assert.equal(parseInterval("0 hours").ok, false);
  assert.equal(parseInterval("-2 hours").ok, false);
  assert.equal(parseInterval(null).ok, false);
  assert.equal(parseInterval(7).ok, false);
});

test("a Postgres interval we cannot read at a glance is refused too", () => {
  // Postgres would accept this. A cadence nobody can read is a cadence nobody notices is wrong.
  assert.equal(parseInterval("1 mon 3 days 04:05:06").ok, false);
});

// ── scheduling ───────────────────────────────────────────────────────────────

test("the first retry is two hours out, in a fresh slot", () => {
  const next = scheduleNextAttempt({ attemptsMade: 1, triedSlots: ["early_morning"], now: NOW });
  assert.equal(next.exhausted, false);
  assert.equal(next.dueAt.getTime() - NOW.getTime(), 86_400_000); // attempt 2 -> +1 day
  assert.notEqual(next.slot, "early_morning");
});

test("each scheduled attempt lands in a slot the lead has not failed in", () => {
  const tried = [];
  let made = 0;
  for (let i = 0; i < 4; i += 1) {
    const next = scheduleNextAttempt({ attemptsMade: made, triedSlots: tried, now: NOW });
    assert.equal(next.exhausted, false);
    assert.ok(!tried.includes(next.slot), `attempt ${next.attemptNumber} repeated ${next.slot}`);
    tried.push(next.slot);
    made += 1;
  }
});

test("hitting the ceiling returns exhausted, not a date far in the future", () => {
  const next = scheduleNextAttempt({ attemptsMade: DEFAULT_CEILING, triedSlots: [], now: NOW });
  assert.equal(next.exhausted, true);
  assert.equal(next.dueAt, null);
  assert.match(next.reason, /nurture/);
});

test("the seventh dial happens: six made is not the ceiling (20260924230300)", () => {
  // The SQL used `attempts_made >= ceiling - 1`, so the sixth dial was the last while the board,
  // the constant and this engine all said seven.
  const next = scheduleNextAttempt({ attemptsMade: DEFAULT_CEILING - 1, triedSlots: [], now: NOW });
  assert.equal(next.exhausted, false);
  assert.equal(next.attemptNumber, DEFAULT_CEILING);
});

test("a day-part preference is never passed to rotation as if it were a slot", () => {
  const cadence = [{ attemptNumber: 2, delayInterval: "4 hours", preferredSlot: "opposite_half", dispositionScope: null }];
  const next = scheduleNextAttempt({ attemptsMade: 1, triedSlots: [], cadence, now: NOW });
  assert.ok(SLOTS.includes(next.slot), `rotation proposed ${next.slot}, which is not a slot`);
});

test("a disposition-specific row beats the catch-all for the same attempt", () => {
  const cadence = [
    { attemptNumber: 1, delayInterval: "2 hours", dispositionScope: null },
    { attemptNumber: 1, delayInterval: "15 minutes", dispositionScope: "voicemail" },
  ];
  const generic = scheduleNextAttempt({ attemptsMade: 0, triedSlots: [], cadence, now: NOW });
  const voicemail = scheduleNextAttempt({ attemptsMade: 0, triedSlots: [], cadence, lastDisposition: "voicemail", now: NOW });
  assert.equal(generic.dueAt.getTime() - NOW.getTime(), 7_200_000);
  assert.equal(voicemail.dueAt.getTime() - NOW.getTime(), 900_000);
});

test("an invalid cadence row is reported rather than scheduled", () => {
  const cadence = [{ attemptNumber: 1, delayInterval: "banana", dispositionScope: null }];
  const next = scheduleNextAttempt({ attemptsMade: 0, triedSlots: [], cadence, now: NOW });
  assert.equal(next.dueAt, null);
  assert.match(next.reason, /not a valid delay/);
});

test("a custom cadence takes effect immediately — no deploy, no cached table", () => {
  const cadence = [{ attemptNumber: 1, delayInterval: "45 minutes", dispositionScope: null }];
  const next = scheduleNextAttempt({ attemptsMade: 0, triedSlots: [], cadence, now: NOW });
  assert.equal(next.dueAt.getTime() - NOW.getTime(), 2_700_000);
});

// ── the criterion that the task's own table does not satisfy ─────────────────

test("the default cadence is front-loaded, but lands FOUR of seven in 72 hours, not five", () => {
  // Criterion 6 asks for five of seven within 72 hours. The default table in the same document
  // gives +2h, +1d, +1d, +2d, +3d, +5d — cumulatively 0, 2h, 26h, 50h, 98h, 170h, 290h. Four
  // attempts fall inside 72 hours, and the fifth lands at 98h.
  //
  // Asserted as it actually is rather than adjusted to make the criterion pass: the table and the
  // criterion are both in the specification and they disagree, and quietly changing the table to
  // satisfy the checkbox would hide that from whoever has to decide.
  assert.equal(attemptsWithin(72), 4);
  assert.equal(attemptsWithin(72, DEFAULT_CADENCE), 4);

  // It IS front-loaded, which is the substance of the criterion: four of seven inside three days,
  // against the current production default of +4h/+1d/+3d.
  assert.equal(attemptsWithin(24), 2);
  assert.ok(attemptsWithin(72) > attemptsWithin(24));
});

test("a cadence that does satisfy the criterion is expressible, if that is the decision", () => {
  const tighter = [
    { attemptNumber: 1, delayInterval: "2 hours" },
    { attemptNumber: 2, delayInterval: "5 hours" },
    { attemptNumber: 3, delayInterval: "1 day" },
    { attemptNumber: 4, delayInterval: "1 day" },
    { attemptNumber: 5, delayInterval: "3 days" },
    { attemptNumber: 6, delayInterval: "5 days" },
  ];
  assert.equal(attemptsWithin(72, tighter), 5);
});
