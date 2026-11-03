import assert from "node:assert/strict";
import test from "node:test";

import {
  TOTP_LOCKOUT_MAX,
  lockoutRetrySeconds,
  lockoutThresholdFor,
  protectionPlane,
  rateLimitClaims,
  scopeKeyFor,
} from "./factor.ts";

const OFFICE_IP = "203.0.113.7";
const ATTEMPTS = 5; // security.login_attempts default
const WINDOW = 15 * 60;

/** The claim_rate_limit keys one attempt touches, as checkLoginAllowed builds them. */
const bucketKeys = (factor, email, ip = OFFICE_IP) =>
  rateLimitClaims("admin", factor, email, ip, ATTEMPTS, WINDOW).map(({ rule, subject }) => `${rule.name}:${subject}`);

/**
 * Both limits as rate_limits runs them: each attempt claims its buckets (claim_rate_limit refuses
 * the claim that goes past `max`), and each wrong code adds a hit to its email + IP lockout row.
 */
function officeRun(attempts) {
  const hits = new Map();
  const lockouts = new Map();
  const threshold = lockoutThresholdFor("totp", 10);
  const now = Date.parse("2026-09-25T10:00:00.000Z");
  return attempts.map(({ email, correct }) => {
    const scope = scopeKeyFor("admin", email, OFFICE_IP, "totp");
    const row = lockouts.get(scope) ?? null;
    if (lockoutRetrySeconds(row, threshold, 30 * 60, now) > 0) return "locked";
    for (const key of bucketKeys("totp", email)) {
      const next = (hits.get(key) ?? 0) + 1;
      hits.set(key, next);
      if (next > ATTEMPTS) return "rate-limited";
    }
    if (correct) {
      lockouts.delete(scope);
      return "signed-in";
    }
    lockouts.set(scope, { hits: (row?.hits ?? 0) + 1, window_start: "2026-09-25T10:00:00.000Z" });
    return "wrong";
  });
}

const LOCKOUT_SECONDS = 30 * 60; // security.lockout_minutes default
const WINDOW_START = "2026-09-25T10:00:00.000Z";
const T0 = Date.parse(WINDOW_START);

/**
 * The lockout as checkLoginAllowed + recordLoginFailure run it against rate_limits: each wrong
 * code adds one hit to the key's row (claim_rate_limit increments unconditionally), and each
 * attempt first asks whether the row locks the key.
 */
function simulateCodeAttempts(results, configuredThreshold = 10) {
  const threshold = lockoutThresholdFor("totp", configuredThreshold);
  let row = null;
  const outcomes = [];
  for (const [i, correct] of results.entries()) {
    const now = T0 + i * 1000;
    if (lockoutRetrySeconds(row, threshold, LOCKOUT_SECONDS, now) > 0) {
      outcomes.push("locked");
      continue;
    }
    if (correct) {
      outcomes.push("signed-in");
      row = null; // clearLoginFailures("admin", email, request, "totp")
    } else {
      outcomes.push("wrong");
      row = { hits: (row?.hits ?? 0) + 1, window_start: WINDOW_START };
    }
  }
  return outcomes;
}

test("the password step keeps the keys it had before the second factor was protected", () => {
  assert.equal(protectionPlane("admin", "password"), "admin");
  assert.equal(protectionPlane("user", "password"), "user");
});

test("second-factor codes count in their own plane, so a correct password cannot clear them", () => {
  assert.equal(protectionPlane("admin", "totp"), "admin_2fa");
  assert.notEqual(protectionPlane("admin", "totp"), protectionPlane("admin", "password"));
});

test("the second factor locks after at most five wrong codes", () => {
  assert.equal(TOTP_LOCKOUT_MAX, 5);
  // Default security.lockout_threshold is 10; the code step is capped at 5.
  assert.equal(lockoutThresholdFor("totp", 10), 5);
  assert.equal(lockoutThresholdFor("totp", 50), 5);
  // A stricter setting tightens the code step too.
  assert.equal(lockoutThresholdFor("totp", 3), 3);
  // The password step is exactly the setting.
  assert.equal(lockoutThresholdFor("password", 10), 10);
  assert.equal(lockoutThresholdFor("password", 3), 3);
});

test("five wrong codes lock the email + IP; the sixth attempt is refused even with the right code", () => {
  assert.deepEqual(simulateCodeAttempts([false, false, false, false, false, true]), [
    "wrong", "wrong", "wrong", "wrong", "wrong", "locked",
  ]);
});

test("four wrong codes do not lock, and a correct code clears the count", () => {
  assert.deepEqual(simulateCodeAttempts([false, false, false, false, true, false, false, false, false, true]), [
    "wrong", "wrong", "wrong", "wrong", "signed-in", "wrong", "wrong", "wrong", "wrong", "signed-in",
  ]);
});

test("the lockout lifts when security.lockout_minutes has passed since its window began", () => {
  const row = { hits: 5, window_start: WINDOW_START };
  assert.equal(lockoutRetrySeconds(row, 5, LOCKOUT_SECONDS, T0 + 60_000), LOCKOUT_SECONDS - 60);
  assert.equal(lockoutRetrySeconds(row, 5, LOCKOUT_SECONDS, T0 + LOCKOUT_SECONDS * 1000), 0);
  assert.equal(lockoutRetrySeconds({ hits: 4, window_start: WINDOW_START }, 5, LOCKOUT_SECONDS, T0), 0);
  assert.equal(lockoutRetrySeconds(null, 5, LOCKOUT_SECONDS, T0), 0);
});

test("second-factor codes are limited per staff email + IP, never per IP alone", () => {
  assert.deepEqual(bucketKeys("totp", "a@insurvas.com"), ["login_admin_2fa_email_ip:a@insurvas.com:203.0.113.7"]);
  assert.ok(bucketKeys("totp", "a@insurvas.com").every((key) => key.includes("a@insurvas.com")));
  // Two colleagues on one office IP share no second-factor bucket.
  const a = new Set(bucketKeys("totp", "a@insurvas.com"));
  assert.ok(bucketKeys("totp", "b@insurvas.com").every((key) => !a.has(key)));
  assert.notEqual(scopeKeyFor("admin", "a@insurvas.com", OFFICE_IP, "totp"), scopeKeyFor("admin", "b@insurvas.com", OFFICE_IP, "totp"));
});

test("the password step keeps its per-email and per-IP buckets, unchanged", () => {
  assert.deepEqual(bucketKeys("password", "a@insurvas.com"), [
    "login_admin_email:a@insurvas.com",
    "login_admin_ip:203.0.113.7",
  ]);
  assert.equal(scopeKeyFor("admin", "A@Insurvas.com ", OFFICE_IP), "login:admin:a%40insurvas.com:203.0.113.7");
});

test("a second staff email on the same IP is not blocked by the first one's failures", () => {
  const first = Array.from({ length: 6 }, () => ({ email: "a@insurvas.com", correct: false }));
  const outcomes = officeRun([...first, { email: "b@insurvas.com", correct: true }]);
  assert.deepEqual(outcomes.slice(0, 6), ["wrong", "wrong", "wrong", "wrong", "wrong", "locked"]);
  assert.equal(outcomes[6], "signed-in");
});

test("six colleagues on one office IP all get in with correct codes", () => {
  const staff = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ email: `${name}@insurvas.com`, correct: true }));
  assert.deepEqual(officeRun(staff), staff.map(() => "signed-in"));
});

test("the password step still allows the configured threshold (10 by default)", () => {
  const threshold = lockoutThresholdFor("password", 10);
  assert.equal(lockoutRetrySeconds({ hits: 5, window_start: WINDOW_START }, threshold, LOCKOUT_SECONDS, T0), 0);
  assert.ok(lockoutRetrySeconds({ hits: 10, window_start: WINDOW_START }, threshold, LOCKOUT_SECONDS, T0) > 0);
});
