import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeAdminsByRole, activeLockoutEmails, formatUtcDateTime, startOfUtcWeek } from "./figures.ts";

const NOW = Date.parse("2026-09-24T12:00:00Z"); // a Thursday

test("the week starts Monday 00:00 UTC, as date_trunc('week') does", () => {
  assert.equal(startOfUtcWeek(NOW).toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(startOfUtcWeek(Date.parse("2026-09-21T00:00:00Z")).toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(startOfUtcWeek(Date.parse("2026-09-27T23:59:59Z")).toISOString(), "2026-09-21T00:00:00.000Z");
});

test("lockouts count distinct emails, only while active and over the threshold", () => {
  const recent = new Date(NOW - 5 * 60_000).toISOString();
  const stale = new Date(NOW - 20 * 60_000).toISOString();
  const rows = [
    // One person, two networks: one account, not two.
    { bucket_key: "login_lockout:login:user:ana%40example.com:1.1.1.1", hits: 5, window_start: recent },
    { bucket_key: "login_lockout:login:user:ana%40example.com:2.2.2.2", hits: 6, window_start: recent },
    { bucket_key: "login_lockout:login:admin:ops%40insurvas.com:3.3.3.3", hits: 5, window_start: recent },
    // Under the threshold: failures, not a lockout.
    { bucket_key: "login_lockout:login:user:bo%40example.com:1.1.1.1", hits: 4, window_start: recent },
    // The window ran out.
    { bucket_key: "login_lockout:login:user:cy%40example.com:1.1.1.1", hits: 9, window_start: stale },
    // Not a login lockout at all.
    { bucket_key: "login_user_email:dee@example.com", hits: 50, window_start: recent },
  ];
  assert.equal(activeLockoutEmails(rows, 5, 15, NOW), 2);
  assert.equal(activeLockoutEmails([], 5, 15, NOW), 0);
});

test("the lockout rule matches the one sign-in and the Advanced page apply", () => {
  const route = readFileSync(new URL("../../app/api/admin/security/rate-limits/route.ts", import.meta.url), "utf8");
  assert.match(route, /row\.hits >= lockoutThreshold && expiresAt\.getTime\(\) > Date\.now\(\)/);
  assert.match(route, /like\("bucket_key", "login_lockout:%"\)/);
  const protection = readFileSync(new URL("../authProtection/index.ts", import.meta.url), "utf8");
  assert.match(protection, /`login_lockout:\$\{scope\}`/);
  // The key is built in ./factor since the second factor got its own buckets. For the password step
  // the plane is the actor type itself, so the keys this page scans are unchanged.
  const factor = readFileSync(new URL("../authProtection/factor.ts", import.meta.url), "utf8");
  assert.match(factor, /`login:\$\{plane\}:\$\{encodeURIComponent\(safePart\(email, 320\)\)\}:/);
  assert.match(factor, /factor === "totp" \? `\$\{actorType\}_2fa` : actorType/);
});

test("admin chips count active admins only, in a fixed order", () => {
  const rows = [
    { role: "support_agent", is_active: true },
    { role: "super_admin", is_active: true },
    { role: "support_agent", is_active: false },
    { role: "billing_admin", is_active: true },
    { role: "super_admin", is_active: true },
    { role: "platform_config", is_active: false },
  ];
  assert.deepEqual(activeAdminsByRole(rows), [
    { role: "super_admin", count: 2 },
    { role: "billing_admin", count: 1 },
    { role: "support_agent", count: 1 },
  ]);
});

test("sign-in time prints in UTC with the zone", () => {
  assert.equal(formatUtcDateTime("2026-09-22T08:40:55Z"), "22 Sep 2026 08:40:55 UTC");
  assert.equal(formatUtcDateTime("2026-01-05T23:04:09.123+02:00"), "5 Jan 2026 21:04:09 UTC");
  assert.equal(formatUtcDateTime(null), null);
  assert.equal(formatUtcDateTime("not a date"), null);
});
