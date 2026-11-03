/**
 * The Lead posting board's four rejections: "No consent text", "Missing consent IP", "Unparseable
 * date of birth", "State not licensed". The pure rules, and that the post path, the log and the
 * settings screen all use the same four codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { consentIpOf, consentTextOf, LEGACY_LOG_CODE, normaliseIp, parseUsDateOfBirth, VALIDATION_REASON_CODES } from "./validation.ts";
import { REJECTION_LABELS } from "./types.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const today = new Date("2026-09-24T12:00:00Z");

test("consent text is required and kept verbatim", () => {
  assert.equal(consentTextOf({}), null);
  assert.equal(consentTextOf({ consent_text: "   " }), null);
  assert.equal(consentTextOf({ consent_text: 42 }), null);
  assert.equal(consentTextOf({ consent_text: " I agree to be called. " }), " I agree to be called. ");
});

test("the consent IP is an address, from consent_ip or the older ip", () => {
  assert.equal(consentIpOf({ consent_ip: "203.0.113.9" }), "203.0.113.9");
  assert.equal(consentIpOf({ ip: "203.0.113.9" }), "203.0.113.9");
  assert.equal(consentIpOf({ consent_ip: "not an ip", ip: "203.0.113.9" }), null, "a bad consent_ip is not rescued by ip");
  assert.equal(consentIpOf({}), null);
  assert.equal(normaliseIp("256.1.1.1"), null);
  assert.equal(normaliseIp("2001:DB8::1"), "2001:db8::1");
  assert.equal(normaliseIp("::ffff:203.0.113.9"), "::ffff:203.0.113.9");
  assert.equal(normaliseIp("2001:db8::1::2"), null);
  assert.equal(normaliseIp("1:2:3:4:5:6:7:8"), "1:2:3:4:5:6:7:8");
  assert.equal(normaliseIp("1:2:3:4:5:6:7"), null);
});

test("a date of birth is read month-first, and refused only when sent and unreadable", () => {
  assert.deepEqual(parseUsDateOfBirth(undefined, today), { status: "absent" });
  assert.deepEqual(parseUsDateOfBirth("", today), { status: "absent" });
  assert.deepEqual(parseUsDateOfBirth("03/04/1956", today), { status: "ok", iso: "1956-03-04" });
  assert.deepEqual(parseUsDateOfBirth("3-4-1956", today), { status: "ok", iso: "1956-03-04" });
  assert.deepEqual(parseUsDateOfBirth("03041956", today), { status: "ok", iso: "1956-03-04" });
  assert.deepEqual(parseUsDateOfBirth("1956-03-04", today), { status: "ok", iso: "1956-03-04" });
  assert.deepEqual(parseUsDateOfBirth("1956-03-04T00:00:00Z", today), { status: "ok", iso: "1956-03-04" });
  assert.deepEqual(parseUsDateOfBirth("02/30/1956", today), { status: "invalid" });
  assert.deepEqual(parseUsDateOfBirth("13/01/1956", today), { status: "invalid" }, "day-first is not guessed");
  assert.deepEqual(parseUsDateOfBirth("03/04/56", today), { status: "invalid" }, "a two-digit year is not guessed");
  assert.deepEqual(parseUsDateOfBirth("01/01/2030", today), { status: "invalid" });
  assert.deepEqual(parseUsDateOfBirth("01/01/1850", today), { status: "invalid" });
  assert.deepEqual(parseUsDateOfBirth("sometime in May", today), { status: "invalid" });
  assert.deepEqual(parseUsDateOfBirth("02/29/1956", today), { status: "ok", iso: "1956-02-29" });
});

test("every new code has the board's label, a legacy fallback, and a place in the log's vocabulary", () => {
  assert.equal(REJECTION_LABELS.missing_consent_text, "No consent text");
  assert.equal(REJECTION_LABELS.missing_consent_ip, "Missing consent IP");
  assert.equal(REJECTION_LABELS.invalid_date_of_birth, "Unparseable date of birth");
  assert.equal(REJECTION_LABELS.state_not_licensed, "State not licensed");
  const migrations = readdirSync(join(process.cwd(), "supabase", "migrations")).sort();
  const latest = migrations.filter((name) => /tenant_lead_post_log_reason_code_check/.test(read("supabase", "migrations", name))).pop();
  assert.ok(latest, "a migration must widen the reason_code check");
  const body = read("supabase", "migrations", latest);
  for (const code of VALIDATION_REASON_CODES) {
    assert.ok(LEGACY_LOG_CODE[code], `${code} needs a fallback for the log before the migration`);
    assert.match(body, new RegExp(`'${code}'`), `the log's check constraint does not allow ${code}`);
  }
});

test("the post path refuses with each code, and checks the agency's licence for the state", () => {
  const service = read("lib", "leadPost", "service.ts");
  for (const code of VALIDATION_REASON_CODES) assert.match(service, new RegExp(`reasonCode: "${code}"`), `the post path never answers ${code}`);
  assert.match(service, /from\("licenses"\)[\s\S]{0,200}\.eq\("state", state\)/);
  assert.match(service, /expires_at < today/, "an expired licence is not a licence");
  assert.match(service, /error\?\.code === "23514" && legacy/, "the log row survives before the migration");
});

test("the per-workspace URL refuses a key from another workspace", () => {
  const route = read("app", "api", "post", "[workspace]", "route.ts");
  assert.match(route, /handleLeadPost\(request, bearerKey\(request\), \{ workspaceId/);
  const service = read("lib", "leadPost", "service.ts");
  assert.match(service, /input\.workspaceId && input\.workspaceId !== keyRow\.tenant_id/);
  // The older URLs stay for vendors already posting to them.
  assert.match(read("app", "api", "leads", "post", "route.ts"), /handleLeadPost\(request, bearerKey\(request\)\)/);
  assert.match(read("app", "api", "leads", "post", "[key]", "route.ts"), /handleLeadPost\(request, key\)/);
});
