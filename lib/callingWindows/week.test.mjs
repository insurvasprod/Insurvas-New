// Settings › Calling windows round 8: the week grid's arithmetic, and the migration that enforces it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  dayRows,
  daysLabel,
  drawnDay,
  envelope,
  fitsWithoutDays,
  longDate,
  moveEdge,
  rangeLabel,
  ruleLine,
  stateCut,
  weekChanges,
  weekCut,
  weekFrom,
} from "./week.ts";

const h = (hour) => hour * 60;
const day = (start, end) => ({ start: h(start), end: h(end) });

test("the stored base window is the envelope, and only the days that differ get a row", () => {
  const week = [null, day(9, 21), day(9, 21), day(9, 21), day(9, 21), day(9, 20), day(10, 18)];
  const base = envelope(week);
  assert.deepEqual(base, day(9, 21));
  assert.deepEqual(dayRows(week, base), [
    { weekday: 0, closed: true, start: null, end: null },
    { weekday: 5, closed: false, start: h(9), end: h(20) },
    { weekday: 6, closed: false, start: h(10), end: h(18) },
  ]);
  // Narrowing the base by each row gives each day back: the round trip the dial check makes.
  assert.deepEqual(weekFrom(base, dayRows(week, base)), week);
  assert.equal(envelope([null, null, null, null, null, null, null]), null);
});

test("a week fits the old storage only when every open day matches and Sunday is off by the switch", () => {
  const same = [day(9, 20), day(9, 20), day(9, 20), day(9, 20), day(9, 20), day(9, 20), day(9, 20)];
  assert.equal(fitsWithoutDays(same, false), true);
  assert.equal(fitsWithoutDays([null, ...same.slice(1)], true), true);
  assert.equal(fitsWithoutDays([null, ...same.slice(1)], false), false);
  assert.equal(fitsWithoutDays([...same.slice(0, 6), day(10, 18)], false), false);
});

test("dragging snaps to quarter hours and never leaves federal hours or an empty day", () => {
  assert.deepEqual(moveEdge(day(10, 18), "end", h(19) + 17), { start: h(10), end: h(19) + 15 });
  assert.deepEqual(moveEdge(day(10, 18), "end", h(23)), { start: h(10), end: h(21) });
  assert.deepEqual(moveEdge(day(10, 18), "start", h(6)), { start: h(8), end: h(18) });
  assert.deepEqual(moveEdge(day(10, 18), "start", h(19)), { start: h(18) - 30, end: h(18) });
  assert.deepEqual(drawnDay(h(16), h(12) + 5), { start: h(12), end: h(16) });
  assert.deepEqual(drawnDay(h(7), h(7) + 5), { start: h(8), end: h(8) + 30 });
});

test("a state's rule is drawn as the part of each day it cuts", () => {
  const florida = { state: "FL", startHour: 8, endHour: 20, noSunday: false, noHolidays: true };
  assert.deepEqual(stateCut(day(9, 21), florida, 1), { before: null, after: h(20), closed: false, minutes: 60 });
  assert.deepEqual(stateCut(day(9, 20), florida, 5), { before: null, after: null, closed: false, minutes: 0 });
  const louisiana = { state: "LA", startHour: 8, endHour: 21, noSunday: true, noHolidays: true };
  assert.equal(stateCut(day(10, 18), louisiana, 0).closed, true);
  const week = [null, day(9, 21), day(9, 21), day(9, 21), day(9, 21), day(9, 20), day(10, 18)];
  assert.equal(weekCut(week, true, florida), 60);
  assert.equal(ruleLine(florida), "8 am – 8 pm");
  assert.equal(ruleLine(louisiana), "No Sundays");
  assert.equal(ruleLine({ state: "TX", startHour: 8, endHour: 21, noSunday: false, noHolidays: true, startMinute: 480, endMinute: 1260, sundayStartMinute: 720, sundayEndMinute: 1260 }), "Sundays from noon");
});

test("labels read the way the board writes them", () => {
  assert.equal(rangeLabel(day(9, 17)), "9 am – 5 pm");
  assert.equal(rangeLabel(day(16, 20)), "4–8 pm");
  assert.equal(daysLabel([false, true, true, true, true, true, false]), "Mon–Fri");
  assert.equal(daysLabel([false, true, false, true, false, true, false]), "Mon, Wed, Fri");
  assert.equal(daysLabel([true, true, true, true, true, true, true]), "Every day");
  assert.equal(longDate("2026-11-26"), "Thu Nov 26, 2026");
});

test("the status line names each unsaved change", () => {
  const week = [null, day(9, 21), day(9, 21), day(9, 21), day(9, 21), day(9, 20), day(10, 18)];
  const before = { week, noSunday: true, noFederalHolidays: true, campaignOverrides: true, daysOff: [], allowed: [] };
  const after = { ...before, week: [...week.slice(0, 6), { start: h(10), end: h(19) + 15 }], noFederalHolidays: false };
  assert.deepEqual(weekChanges(before, after), ["Saturday ends later", "No federal holidays turned off"]);
  const earlier = { ...before, week: week.map((d) => (d ? { ...d, end: d.end - 60 } : d)) };
  assert.deepEqual(weekChanges(before, earlier), ["Mon–Sat end earlier"]);
});

test("the migration enforces the week and the days off in the dial check and its explainer, and guards the body it replaces", () => {
  const sql = readFileSync("supabase/migrations/20261112300000_calling_inbound_r8.sql", "utf8");
  const paste = readFileSync("supabase/deploy/2026-11-12-calling-inbound.sql", "utf8");
  assert.ok(paste.includes(sql.trim().split("\n").slice(-20).join("\n")), "the paste carries the migration");
  assert.match(sql, /create table if not exists public\.tenant_calling_window_days/);
  assert.match(sql, /create table if not exists public\.tenant_calling_days_off/);
  // Both functions read both tables, and the guard refuses a body that has moved on.
  assert.equal((sql.match(/from public\.tenant_calling_window_days d/g) ?? []).length, 2);
  assert.equal((sql.match(/from public\.tenant_calling_days_off o/g) ?? []).length, 2);
  assert.match(sql, /\[20261103100000\] No hours of its own/);
  assert.match(sql, /not the 20261103100000 body/);
  assert.match(sql, /tenant_dial_window disagrees with tenant_can_dial_now/);
  // Narrowing only: a day's row and an afternoon off can only cut the window.
  assert.match(sql, /v_start := greatest\(v_start, v_day\.start_minute\)/);
  assert.match(sql, /v_end := least\(v_end, v_off\.from_minute\)/);
  assert.match(sql, /revoke all on public\.tenant_calling_window_days from anon, authenticated, public/);
});
