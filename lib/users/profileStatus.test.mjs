// Run with: npm test
//
// Settings › My profile: the status line on each tab card. It must never say "done" while a read is
// still out, and it names the one state that is missing rather than a count of one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { HISTORY_STATUS, aboutStatus, alertsStatus, clockLabel, historyStatus, missingLicenceStates, signinStatus } from "./profileStatus.ts";

const facts = (over = {}) => ({ phone: "(312) 555-0142", licensedStates: ["TX", "FL", "GA"], licenceNumbers: { TX: "1", FL: "2", GA: "3" }, licenceNumbersReady: true, ...over });
const names = { TX: "Texas", GA: "Georgia" };

test("About you names the one missing state, counts several, then checks the phone", () => {
  assert.deepEqual(aboutStatus(null), { text: "Checking…", tone: "calm" });
  assert.deepEqual(aboutStatus(facts({ licenceNumbers: { TX: "1", FL: "2", GA: " " } }), (c) => names[c] ?? c), { text: "Georgia number not filled in", tone: "warn" });
  assert.deepEqual(aboutStatus(facts({ licenceNumbers: { TX: "1" } })), { text: "2 licence numbers not filled in", tone: "warn" });
  assert.deepEqual(aboutStatus(facts({ phone: null })), { text: "No phone number yet", tone: "calm" });
  assert.deepEqual(aboutStatus(facts()), { text: "All filled in", tone: "good" });
});

test("numbers that cannot be stored or read are never reported as missing", () => {
  assert.deepEqual(missingLicenceStates(facts({ licenceNumbersReady: false, licenceNumbers: {} })), []);
  assert.deepEqual(missingLicenceStates(facts({ licensedStates: null, licenceNumbers: {} })), []);
});

test("Signing in follows two-step sign-in, and asks only when the role needs it", () => {
  assert.equal(signinStatus(null).text, "Checking…");
  assert.deepEqual(signinStatus("unavailable"), { text: "Two-step sign-in not ready yet", tone: "calm" });
  assert.deepEqual(signinStatus({ enabled: true, required: true }), { text: "Two-step sign-in is on", tone: "good" });
  assert.deepEqual(signinStatus({ enabled: false, required: true }), { text: "Turn on two-step sign-in", tone: "warn" });
  assert.deepEqual(signinStatus({ enabled: false, required: false }), { text: "Two-step sign-in is off", tone: "calm" });
});

test("Alerts counts the alerts you can switch that reach you on any channel, and shows quiet hours", () => {
  const on = { delivery: { in_app: true, email: false, push: false } };
  const off = { delivery: { in_app: false, email: false, push: false } };
  const locked = { protected: true, delivery: { in_app: true, email: true, push: true } };
  assert.deepEqual(alertsStatus({ events: [on, on, off], quiet: { enabled: true, start: "21:00", end: "07:30" } }), { text: "2 of 3 on · quiet 9 PM – 7:30 AM", tone: "calm" });
  assert.deepEqual(alertsStatus({ events: [on, locked], quiet: { enabled: false, start: "21:00", end: "07:00" } }), { text: "1 of 1 on", tone: "calm" });
  // An "Always on" alert does not hide that every one you can switch is off.
  assert.deepEqual(alertsStatus({ events: [off, locked], quiet: { enabled: false, start: "21:00", end: "07:00" } }), { text: "Every alert is off", tone: "warn" });
  assert.equal(clockLabel("00:00"), "12 AM");
  assert.equal(clockLabel("12:15"), "12:15 PM");
});

test("History warns about a recent run of wrong passwords, names the newest, and is calm otherwise", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const day = (iso) => iso.slice(5, 10);
  const run = (at, count) => ({ type: "failed_logins", at, detail: { from: at, count } });
  assert.deepEqual(historyStatus(null, now, day), HISTORY_STATUS);
  assert.deepEqual(historyStatus([{ type: "password_changed", at: "2026-10-26T10:00:00Z" }], now, day), HISTORY_STATUS);
  assert.deepEqual(historyStatus([run("2026-10-03T23:05:00Z", 5), run("2026-10-20T08:00:00Z", 3)], now, day), { text: "3 wrong passwords on 10-20", tone: "warn" });
  // Older than 30 days: still in the list, no longer on the card.
  assert.deepEqual(historyStatus([run("2026-09-01T10:00:00Z", 9)], now, day), HISTORY_STATUS);
  assert.deepEqual(historyStatus([{ type: "failed_logins", at: "2026-10-25T10:00:00Z" }], now, day), { text: "wrong passwords on 10-25", tone: "warn" });
});
