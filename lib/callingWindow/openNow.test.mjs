// Run with: npm test
//
// The phone Home's "Calling window open in N states · closes 9:00 pm ET" (mobile board B1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { openNow } from "./openNow.ts";

const base = { stateRules: [], tenant: null, options: { noSunday: false, noFederalHolidays: false, campaignOverrides: true }, federalHolidays: [], dialingStates: ["FL", "TX", "CA"] };
// Tuesday 24 Nov 2026, 3:00 pm Eastern (20:00 UTC).
const afternoon = new Date("2026-11-24T20:00:00Z");

test("counts the worked states open now and says when the last one closes, in Eastern", () => {
  const now = openNow(base, afternoon);
  assert.equal(now.openStates, 3);
  assert.equal(now.states, 3);
  // California closes at 9:00 pm Pacific = midnight Eastern.
  assert.equal(now.closesAt, "12:00 am ET");
  assert.equal(now.opensAt, null);
});

test("the agency's window narrows every state", () => {
  const now = openNow({ ...base, tenant: { startHour: 9, endHour: 20, startMinute: 540, endMinute: 1200 } }, afternoon);
  assert.equal(now.closesAt, "11:00 pm ET");
});

test("a Sunday switch closes every state, and early morning says when the first opens", () => {
  const sunday = new Date("2026-11-29T18:00:00Z");
  assert.equal(openNow({ ...base, options: { ...base.options, noSunday: true } }, sunday).openStates, 0);
  const early = new Date("2026-11-24T11:30:00Z"); // 6:30 am Eastern
  const now = openNow(base, early);
  assert.equal(now.openStates, 0);
  assert.equal(now.closesAt, null);
  assert.equal(now.opensAt, "8:00 am ET");
});

test("a week grid day off closes the day; a state rule narrows its own state", () => {
  const week = Array.from({ length: 7 }, () => ({ start: 480, end: 1260 }));
  week[2] = null;
  assert.equal(openNow(base, afternoon, week).openStates, 0);
  const rule = { state: "CA", startHour: 8, endHour: 12, noSunday: false, noHolidays: false };
  assert.equal(openNow({ ...base, stateRules: [rule] }, afternoon).openStates, 2);
});

test("with no worked states, every state with a known zone is counted", () => {
  assert.ok(openNow({ ...base, dialingStates: null }, afternoon).states >= 50);
});
