import assert from "node:assert/strict";
import test from "node:test";

import { dayView, repeatsOn, setterVerdict } from "./dayView.ts";

const hours = [{ weekday: 3, startTime: "13:00", endTime: "17:00" }];

test("the day reads as the board draws it: blocked, open, booked, buffer", () => {
  const rows = dayView({
    hours, weekday: 3, length: 45, buffer: 15,
    blocks: [{ from: 780, to: 810, reason: "lunch" }],
    busy: [],
    appointments: [{ id: "a", minute: 840, duration: 45, label: "Dolores Ruiz · Yuma AZ · final expense", setter: "J. Ocampo" }],
    nowMinute: null,
  });
  assert.deepEqual(rows.map((row) => [row.minute, row.kind]), [
    [780, "blocked"], [840, "booked"], [885, "buffer"], [900, "open"], [960, "open"],
  ]);
  assert.equal(rows[0].label, "Blocked — lunch");
  assert.equal(rows[2].label, "Buffer — 15 min after every appointment");
});

test("only the first buffer explains itself; slots already gone are Past; linked-calendar time is named", () => {
  const rows = dayView({
    hours, weekday: 3, length: 30, buffer: 15, blocks: [], busy: [{ from: 900, to: 930 }],
    appointments: [{ id: "a", minute: 780, duration: 30, label: "A", setter: null }, { id: "b", minute: 945, duration: 30, label: "B", setter: null }],
    nowMinute: 830,
  });
  const buffers = rows.filter((row) => row.kind === "buffer");
  assert.equal(buffers.length, 2);
  assert.equal(buffers[1].label, "Buffer");
  assert.ok(rows.some((row) => row.kind === "past"));
  assert.ok(rows.some((row) => row.kind === "busy"));
});

test("a day with no working hours has no slots, only its appointments", () => {
  const rows = dayView({ hours, weekday: 0, length: 30, buffer: 0, blocks: [], busy: [], appointments: [{ id: "x", minute: 600, duration: 30, label: "X", setter: null }], nowMinute: null });
  assert.deepEqual(rows.map((row) => row.kind), ["booked"]);
});

test("repeating blocks recur on the right days", () => {
  assert.equal(repeatsOn("daily", 1, 6), true);
  assert.equal(repeatsOn("weekdays", 1, 6), false);
  assert.equal(repeatsOn("weekly", 3, 3), true);
  assert.equal(repeatsOn("none", 3, 3), false);
});

test("a setter's verdict needs ten closed-out appointments, and pending ones never count", () => {
  assert.equal(setterVerdict(31, 7), "solid");
  assert.equal(setterVerdict(14, 27), "noise");
  assert.equal(setterVerdict(12, 8), "watch");
  assert.equal(setterVerdict(3, 2), "too_few");
});
