import test from "node:test";
import assert from "node:assert/strict";

import { changeWords, chartDays, isNightUtc, parseWorkspaceRange, rangeWindow, worthALook } from "./workspace.ts";
import { lockedAccounts, lockoutEntry, sortLockouts } from "../loginEvents/lockouts.ts";
import { activityQuery, csvCell, deviceLabel, loginEventsCsv, parseActivityLens, repeatedFailures, DEFAULT_ACTIVITY_FILTERS } from "../loginEvents/present.ts";

const NOW = Date.parse("2026-11-17T10:45:00Z");

test("the range parses from the address and falls back to today", () => {
  assert.equal(parseWorkspaceRange(undefined), "today");
  assert.equal(parseWorkspaceRange("7d"), "7d");
  assert.equal(parseWorkspaceRange(["30d"]), "30d");
  assert.equal(parseWorkspaceRange("year"), "today");
  assert.equal(chartDays("today"), 14);
  assert.equal(chartDays("30d"), 30);
});

test("today compares with the same time yesterday; 7 days with the 7 before", () => {
  const today = rangeWindow("today", NOW);
  assert.equal(new Date(today.since).toISOString(), "2026-11-17T00:00:00.000Z");
  assert.equal(new Date(today.previousSince).toISOString(), "2026-11-16T00:00:00.000Z");
  assert.equal(new Date(today.previousUntil).toISOString(), "2026-11-16T10:45:00.000Z");
  const week = rangeWindow("7d", NOW);
  assert.equal(week.since - week.previousSince, 7 * 86_400_000);
  assert.equal(week.previousUntil, week.since);
});

test("change words: a rise, a fall, no change", () => {
  assert.deepEqual(changeWords(14, 11, "vs same time yesterday"), { text: "▲ 3 vs same time yesterday", rise: true });
  assert.deepEqual(changeWords(9, 11, "vs the 7 days before"), { text: "▼ 2 vs the 7 days before", rise: false });
  assert.equal(changeWords(5, 5, "vs same time yesterday")?.text, "same as same time yesterday");
  assert.equal(changeWords(5, null, "x"), null);
});

test("night is 22:00 to 06:00 UTC", () => {
  assert.equal(isNightUtc("2026-11-17T02:14:00Z"), true);
  assert.equal(isNightUtc("2026-11-17T22:00:00Z"), true);
  assert.equal(isNightUtc("2026-11-17T06:00:00Z"), false);
  assert.equal(isNightUtc("2026-11-17T10:42:00Z"), false);
});

test("repeated failures group by address, need the minimum, and skip unknown addresses", () => {
  const fail = (ip, email, ts = "2026-11-17T10:40:00Z") => ({ ip, email, success: false, ts });
  const rows = repeatedFailures([
    fail("203.0.113.4", "ops@blair.test"),
    fail("203.0.113.4", "admin@blair.test"),
    fail("203.0.113.4", "OPS@blair.test", "2026-11-17T10:41:00Z"),
    fail("198.51.100.7", "a@b.test"),
    fail("198.51.100.7", "a@b.test"),
    fail(null, "x@y.test"), fail(null, "x@y.test"), fail(null, "x@y.test"),
    { ip: "203.0.113.4", email: "ok@blair.test", success: true, ts: "2026-11-17T10:42:00Z" },
  ]);
  assert.deepEqual(rows, [{ ip: "203.0.113.4", attempts: 3, accounts: 2, lastAt: "2026-11-17T10:41:00Z" }]);
});

test("worth a look: each source only when the role may see it, each opening its page filtered", () => {
  const failures = Array.from({ length: 6 }, (_, i) => ({ ip: "203.0.113.4", email: `u${i % 3}@b.test`, success: false, ts: "2026-11-17T10:40:00Z" }));
  const lock = lockoutEntry({ bucket_key: "login_lockout:login:user:ops%40blair.test:203.0.113.4", hits: 6, window_start: "2026-11-17T10:41:00Z" }, { threshold: 5, minutes: 219, now: NOW });
  const night = [{ id: "a1", ts: "2026-11-17T02:14:00Z", who: "QA", what: "Feature switched off", targetId: "t-1" }];

  const all = worthALook({ range: "7d", failures, lockouts: [lock], nightChanges: night });
  assert.deepEqual(all.map((item) => item.title), ["Repeated failures from one address", "Account locked", "Staff change outside office hours"]);
  assert.equal(all[0].href, "/admin/activity?lens=repeated&q=203.0.113.4&range=7d");
  assert.match(all[0].detail, /6 failed attempts on 3 accounts/);
  assert.equal(all[1].href, "/admin/monitoring/lockouts");
  assert.match(all[1].detail, /until 14:20 UTC/);
  assert.equal(all[2].href, "/admin/audit-log?target=t-1");
  assert.equal(all[2].verb, "FYI");

  const support = worthALook({ range: "today", failures, lockouts: null, nightChanges: [] });
  assert.deepEqual(support.map((item) => item.title), ["Repeated failures from one address"]);
  assert.equal(support[0].href, "/admin/activity?lens=repeated&q=203.0.113.4");
});

test("a lockout entry: plane, decoded parts, locked only at the threshold and inside the window", () => {
  const config = { threshold: 5, minutes: 15, now: NOW };
  const locked = lockoutEntry({ bucket_key: "login_lockout:login:admin:qa%40x.test:2001:db8::1", hits: 5, window_start: "2026-11-17T10:40:00Z" }, config);
  assert.equal(locked?.plane, "admin");
  assert.equal(locked?.email, "qa@x.test");
  assert.equal(locked?.ip, "2001:db8::1");
  assert.equal(locked?.unlocksAt, "2026-11-17T10:55:00.000Z");
  assert.equal(lockoutEntry({ bucket_key: "login_lockout:login:user:a:1.2.3.4", hits: 4, window_start: "2026-11-17T10:40:00Z" }, config)?.unlocksAt, null);
  assert.equal(lockoutEntry({ bucket_key: "login_lockout:login:user:a:1.2.3.4", hits: 9, window_start: "2026-11-17T10:00:00Z" }, config)?.unlocksAt, null);
  // The two-step code locks at min(5, threshold), as sign-in does.
  assert.ok(lockoutEntry({ bucket_key: "login_lockout:login:admin_2fa:a:1.2.3.4", hits: 5, window_start: "2026-11-17T10:40:00Z" }, { ...config, threshold: 10 })?.unlocksAt);
  assert.equal(lockoutEntry({ bucket_key: "rate:login:user:a:1", hits: 9, window_start: "2026-11-17T10:40:00Z" }, config), null);
});

test("lockouts sort locked first and count distinct accounts", () => {
  const config = { threshold: 5, minutes: 15, now: NOW };
  const make = (key, hits, start) => lockoutEntry({ bucket_key: `login_lockout:login:user:${key}`, hits, window_start: start }, config);
  const entries = sortLockouts([make("b:1", 2, "2026-11-17T10:44:00Z"), make("a:1", 5, "2026-11-17T10:42:00Z"), make("a:2", 6, "2026-11-17T10:35:00Z")]);
  assert.deepEqual(entries.map((entry) => entry.scopeKey.split(":").slice(3).join(":")), ["a:2", "a:1", "b:1"]);
  assert.equal(lockedAccounts(entries), 1);
});

test("login activity lens, address and CSV", () => {
  assert.equal(parseActivityLens(new URLSearchParams("lens=repeated")), "repeated");
  assert.equal(parseActivityLens(new URLSearchParams("outcome=failure")), "failed");
  assert.equal(parseActivityLens(new URLSearchParams("")), "all");
  assert.equal(activityQuery(DEFAULT_ACTIVITY_FILTERS), "");
  assert.equal(activityQuery({ ...DEFAULT_ACTIVITY_FILTERS, range: "30d", q: "1.2.3.4" }, { lens: "repeated", page: 2 }), "lens=repeated&range=30d&q=1.2.3.4&page=2");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(deviceLabel(null), null);
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  const csv = loginEventsCsv([{ ts: "2026-11-17T10:41:00Z", email: "ops@blair.test", actor_type: "user", success: false, failure_reason: "invalid_credentials", ip: "203.0.113.4", user_agent: null }]);
  assert.equal(csv.split("\r\n")[1], "2026-11-17T10:41:00Z,ops@blair.test,customer,Failed — bad credentials,203.0.113.4,,");
});
