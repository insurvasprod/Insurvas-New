import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DISABLE_AFTER_FAILURES, MAX_ATTEMPTS, RETRY_DELAYS_MINUTES, checkTargetUrl, generateSigningSecret, isPrivateAddress, nextForDelivery, nextForSubscription, responseSnippet, signPayload, verifySignature } from "./rules.ts";
import { findSensitiveKeys, findSensitiveValues } from "../apiKeys/rules.ts";
import { NOTIFICATION_EVENTS } from "../notifications/events.ts";

const MIGRATION = fs.readFileSync("supabase/migrations/20261015340000_la_8_7_api_keys_webhooks.sql", "utf8");

test("deliveries are HMAC-signed over a timestamp; a receiver can verify and refuse a replay", () => {
  const secret = generateSigningSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  const body = JSON.stringify({ id: "e1", type: "policy.issued", data: { policy_number: "P-1" } });
  const now = Date.parse("2026-10-15T12:00:00Z");
  const header = signPayload(secret, body, Math.floor(now / 1000));
  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature(secret, body, header, now), true);
  assert.equal(verifySignature(secret, body + " ", header, now), false, "a changed body fails");
  assert.equal(verifySignature("whsec_other", body, header, now), false, "another secret fails");
  assert.equal(verifySignature(secret, body, header, now + 10 * 60_000), false, "an old delivery replayed later fails");
  const deliver = fs.readFileSync("lib/webhooks/deliver.ts", "utf8");
  assert.match(deliver, /"insurvas-signature": signPayload\(secret, body, timestamp\)/);
});

test("the secret is shown once: encrypted at rest, never selected into a view", () => {
  assert.match(MIGRATION, /signing_secret_ciphertext text not null/);
  assert.doesNotMatch(MIGRATION, /signing_secret text/);
  const service = fs.readFileSync("lib/webhooks/service.ts", "utf8");
  assert.doesNotMatch(/const COLUMNS = "([^"]+)"/.exec(service)[1], /secret/);
  assert.match(service, /encryptSensitive\(secret, secretScope\(tenantId, id\)\)/);
});

test("non-HTTPS, private and loopback targets are refused", () => {
  for (const bad of [
    "http://hooks.example.com/in", "ftp://hooks.example.com", "https://localhost/in", "https://127.0.0.1/in", "https://10.0.0.5/in",
    "https://192.168.1.10/x", "https://172.16.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://[fd00::1]/x",
    "https://printer.local/x", "https://metadata.google.internal/x", "https://intranet/x", "https://user:pass@hooks.example.com/x",
    "https://hooks.example.com:8443/x", "https://100.64.0.1/x", "https://0.0.0.0/x", "not a url",
  ]) {
    assert.equal(checkTargetUrl(bad).ok, false, bad);
  }
  for (const good of ["https://hooks.example.com/in", "https://hooks.zapier.com/hooks/catch/1/abc/", "https://8.8.8.8/hook", "https://example.com:443/x"]) {
    assert.equal(checkTargetUrl(good).ok, true, good);
  }
  // After DNS too: a public name pointing at a private address is refused when connecting.
  for (const address of ["10.1.2.3", "127.0.0.1", "::1", "::ffff:192.168.0.1", "fe80::1", "169.254.0.1"]) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(address), false, address);
  const deliver = fs.readFileSync("lib/webhooks/deliver.ts", "utf8");
  assert.match(deliver, /list\.some\(\(entry\) => isPrivateAddress\(entry\.address\)\)/);
  assert.doesNotMatch(deliver, /maxRedirects|followRedirects|redirect: "follow"/);
  assert.match(MIGRATION, /target_url ~ '\^https:\/\//);
});

test("failed deliveries retry on a ladder over a few hours, then the delivery fails", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(MAX_ATTEMPTS, 6);
  assert.ok(RETRY_DELAYS_MINUTES.reduce((a, b) => a + b, 0) <= 12 * 60);
  let next = nextForDelivery(1, { ok: false }, now);
  assert.equal(next.status, "pending");
  assert.equal(next.nextAttemptAt.getTime() - now.getTime(), 60_000);
  next = nextForDelivery(5, { ok: false }, now);
  assert.equal(next.nextAttemptAt.getTime() - now.getTime(), 360 * 60_000);
  assert.deepEqual(nextForDelivery(6, { ok: false }, now), { status: "failed" });
  assert.deepEqual(nextForDelivery(3, { ok: true }, now), { status: "succeeded" });
});

test("a used-up delivery marks the subscription failing; sustained failure disables it, and the agency is told", () => {
  let state = { status: "active", consecutiveFailures: 0 };
  state = nextForSubscription(state, { ok: false }, false);
  assert.equal(state.status, "active");
  state = nextForSubscription({ status: "active", consecutiveFailures: 5 }, { ok: false }, true);
  assert.equal(state.status, "failing");
  assert.equal(state.justDisabled, false);
  state = nextForSubscription({ status: "failing", consecutiveFailures: DISABLE_AFTER_FAILURES - 1 }, { ok: false }, false);
  assert.deepEqual(state, { status: "disabled", consecutiveFailures: DISABLE_AFTER_FAILURES, justDisabled: true });
  assert.deepEqual(nextForSubscription({ status: "failing", consecutiveFailures: 9 }, { ok: true }, false), { status: "active", consecutiveFailures: 0, justDisabled: false });
  // A paused or disabled subscription is not changed by an attempt.
  assert.equal(nextForSubscription({ status: "paused", consecutiveFailures: 0 }, { ok: false }, true).status, "paused");
  // The notification is registered (so the outbox emails it) and sent when it happens.
  const event = NOTIFICATION_EVENTS.find((e) => e.key === "webhook_disabled");
  assert.ok(event && event.kinds.includes("webhook_disabled") && event.defaults.in_app && event.defaults.email);
  assert.match(fs.readFileSync("lib/webhooks/deliver.ts", "utf8"), /if \(state\.justDisabled\)[\s\S]*kind: "webhook_disabled"/);
});

test("every attempt is logged with its status code and a short response snippet", () => {
  assert.match(MIGRATION, /create table if not exists public\.webhook_attempt/);
  assert.match(fs.readFileSync("lib/webhooks/deliver.ts", "utf8"), /from\("webhook_attempt"\)\.insert\(\{[\s\S]*status_code: result\.status/);
  assert.equal(responseSnippet("x".repeat(900)).length, 500);
  assert.equal(responseSnippet("ok\u0000\u0007 done\n\n"), "ok done");
});

test("webhook payloads carry identifiers and figures only — no SSN, bank or card data", () => {
  // The keys each trigger puts in its payload, read from the migration.
  const keys = [...MIGRATION.matchAll(/jsonb_build_object\(([\s\S]*?)\)\s*\);/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'\s*,/g)].map((k) => k[1]));
  assert.ok(keys.includes("policy_number") && keys.includes("difference_cents"));
  assert.deepEqual(findSensitiveKeys(Object.fromEntries(keys.map((k) => [k, 1]))), []);
  // Not the discrepancy's free-text explanation or evidence, nor any contact field.
  for (const forbidden of ["explanation", "evidence", "first_name", "last_name", "email", "phone", "contact_id", "values"]) assert.ok(!keys.includes(forbidden), forbidden);
  const sample = { id: "e", type: "policy.issued", data: { policy_number: "123456789", carrier: { id: "c", name: "Safe Harbour" }, status: "active", premium_cents: 4500 } };
  assert.deepEqual([...findSensitiveKeys(sample), ...findSensitiveValues(sample)], []);
});

test("events are queued by the database, for every writer, and only where someone listens", () => {
  assert.match(MIGRATION, /after insert on public\.policy_change\s+referencing new table as inserted\s+for each statement/);
  assert.match(MIGRATION, /after insert on public\.commission_discrepancy\s+referencing new table as inserted\s+for each statement/);
  assert.match(MIGRATION, /new_value = 'active' and i\.old_value in \('submitted', 'approved_unpaid'\)/);
  assert.match(MIGRATION, /on conflict \(subscription_id, source_key\) do nothing/);
  // Written by the app only: the API roles get nothing.
  assert.match(MIGRATION, /revoke all on public\.api_key, public\.webhook_subscription, public\.webhook_delivery, public\.webhook_attempt from public, anon, authenticated;/);
});

test("LA-8 audit: a paused subscription collects no events (nothing stale is sent on resume)", () => {
  const audit = fs.readFileSync("supabase/migrations/20261015640000_la_8_audit_team_webhooks.sql", "utf8");
  const fn = audit.slice(audit.indexOf("create or replace function public.enqueue_webhook_event"), audit.indexOf("revoke all on function public.enqueue_webhook_event"));
  assert.match(fn, /and s\.status in \('active', 'failing'\)/);
  assert.doesNotMatch(fn, /'paused'/);
});
