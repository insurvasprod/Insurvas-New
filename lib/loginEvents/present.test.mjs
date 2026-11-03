import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ACTIVITY_FILTERS,
  countLine,
  ilikeContains,
  loginEventTime,
  loginOutcomeLabel,
  parseActivityFilters,
  popoverFilterCount,
  rangeStart,
  summariseUserAgent,
  weekOverWeek,
} from "./present.ts";
import { LOGIN_FAILURE_REASONS, loginFailureLabel } from "./constants.ts";

const params = (query) => new URLSearchParams(query);

test("filters parse from the query string and fall back to the defaults", () => {
  assert.deepEqual(parseActivityFilters(params("")), DEFAULT_ACTIVITY_FILTERS);
  assert.deepEqual(parseActivityFilters(params("outcome=failure&actor=admin&range=7d&q=%20ana%20")), {
    outcome: "failure",
    actor: "admin",
    range: "7d",
    q: "ana",
  });
  assert.deepEqual(parseActivityFilters(params("outcome=nope&actor=root&range=year")), DEFAULT_ACTIVITY_FILTERS);
  assert.equal(parseActivityFilters(params(`q=${"x".repeat(500)}`)).q.length, 100);
});

test("the Filters badge counts only the popover's settings that differ from the default", () => {
  assert.equal(popoverFilterCount(DEFAULT_ACTIVITY_FILTERS), 0);
  assert.equal(popoverFilterCount({ ...DEFAULT_ACTIVITY_FILTERS, outcome: "failure", q: "x" }), 0);
  assert.equal(popoverFilterCount({ ...DEFAULT_ACTIVITY_FILTERS, actor: "admin", range: "all" }), 2);
});

test("today is the UTC day; 7 days is rolling; all time has no start", () => {
  const now = Date.parse("2026-09-24T08:30:00Z");
  assert.equal(rangeStart("today", now)?.toISOString(), "2026-09-24T00:00:00.000Z");
  assert.equal(rangeStart("7d", now)?.toISOString(), "2026-09-17T08:30:00.000Z");
  assert.equal(rangeStart("all", now), null);
});

test("the count line follows the range", () => {
  assert.equal(countLine(412, 412, "today"), "412 of 412 attempts today");
  assert.equal(countLine(3, 1204, "7d"), "3 of 1,204 attempts in the last 7 days");
  assert.equal(countLine(1, 1, "all"), "1 of 1 attempt recorded");
});

test("search terms are literal inside ilike and safe inside a quoted or= value", () => {
  assert.equal(ilikeContains("ana"), "%ana%");
  assert.equal(ilikeContains("a_b%"), "%a\\\\_b\\\\%%");
  assert.equal(ilikeContains('x"y'), '%x\\"y%');
});

test("outcome pill wording", () => {
  assert.equal(loginOutcomeLabel({ success: true, failure_reason: null, actor_type: "user" }), "Success");
  assert.equal(loginOutcomeLabel({ success: true, failure_reason: null, actor_type: "admin" }), "Success · admin");
  assert.equal(loginOutcomeLabel({ success: false, failure_reason: "locked_out", actor_type: "user" }), "Failed — locked");
  assert.equal(loginOutcomeLabel({ success: false, failure_reason: "rate_limited", actor_type: "admin" }), "Failed — rate limited");
  // An unknown email and a wrong password are indistinguishable, so never "bad password".
  assert.equal(loginOutcomeLabel({ success: false, failure_reason: "invalid_credentials", actor_type: "user" }), "Failed — bad credentials");
  assert.equal(loginOutcomeLabel({ success: false, failure_reason: null, actor_type: "user" }), "Failed");
  assert.equal(loginOutcomeLabel({ success: false, failure_reason: "some_new_reason", actor_type: "user" }), "Failed — some new reason");
});

test("blocked attempts have long labels too", () => {
  assert.ok(LOGIN_FAILURE_REASONS.locked_out);
  assert.ok(LOGIN_FAILURE_REASONS.rate_limited);
  assert.equal(loginFailureLabel("locked_out"), "Locked out after repeated failures");
});

test("times print in UTC with the zone named", () => {
  assert.equal(loginEventTime("2026-09-22T08:44:12.345Z"), "22 Sep 2026 08:44:12 UTC");
  assert.equal(loginEventTime("not a date"), "—");
});

test("user agents summarise to browser and system", () => {
  const cases = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "Chrome 140 · Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15", "Safari 19 · macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "Edge 140 · Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox 131 · Linux"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1", "Chrome 140 · iOS"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", "Chrome 140 · Android"],
    ["curl/8.7.1", "curl/8.7.1"],
  ];
  for (const [ua, expected] of cases) assert.equal(summariseUserAgent(ua), expected, ua);
  assert.equal(summariseUserAgent(null), null);
  assert.equal(summariseUserAgent("   "), null);
});

test("week-over-week compares like with like and refuses to divide by zero", () => {
  assert.equal(weekOverWeek(3188, 3008), "+6% vs same time last week");
  assert.equal(weekOverWeek(90, 100), "−10% vs same time last week");
  assert.equal(weekOverWeek(100, 100), "±0% vs same time last week");
  assert.equal(weekOverWeek(5, 0), null);
  assert.equal(weekOverWeek(5, null), null);
});
