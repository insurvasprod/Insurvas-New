// Settings › Integrations, round 8 option A ("Integrations hub"): the rules the hub's tables, sheets
// and status line share. DB-free and network-free.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { KEY_PRESETS, ROTATION_OVERLAP_HOURS, WEBHOOK_EVENTS, WEBHOOK_EVENT_KEYS, API_SCOPE_KEYS, webhookEventLabel } from "./constants.ts";
import { MAX_TRIES, OFF_AFTER, RETRY_LADDER_MINUTES, answerWords, canDoWords, getsWords, hookState, hostOf, keyState, maskedUrl, replacedKeyIds, requestSample, samplePath, sentWords, verifySample, SAMPLE_DELIVERY, EVENT_SAMPLES } from "./hub.ts";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
const NOW = Date.parse("2026-11-12T15:00:00Z");
const DAY = 86_400_000;
const key = (over = {}) => ({ id: "k1", label: "Zapier", keyPrefix: "isk_abcdefgh", lastFour: "a1b2", scopes: ["policies:read"], createdAt: new Date(NOW - 200 * DAY).toISOString(), createdByName: "Dana Avery", lastUsedAt: new Date(NOW - 3600_000).toISOString(), lastUsedIp: "1.2.3.4", expiresAt: null, revokedAt: null, rotatedFrom: null, ...over });

test("a key's one chip: working, ends soon, rotating out, idle, ended, revoked", () => {
  assert.equal(keyState(key(), false, NOW).label, "Working");
  assert.equal(keyState(key({ expiresAt: new Date(NOW + 12.5 * DAY).toISOString() }), false, NOW).label, "Ends in 12 days");
  assert.equal(keyState(key({ expiresAt: new Date(NOW + 30 * DAY).toISOString() }), false, NOW).kind, "working");
  const rotating = keyState(key({ expiresAt: new Date(NOW + 19 * 3600_000).toISOString() }), true, NOW);
  assert.equal(rotating.kind, "rotating_out");
  assert.equal(rotating.label, "Rotating out · 19 h left");
  const idle = keyState(key({ lastUsedAt: new Date(NOW - 94 * DAY).toISOString() }), false, NOW);
  assert.deepEqual([idle.kind, idle.label, idle.idleDays], ["idle", "Idle 94 days", 94]);
  assert.equal(keyState(key({ expiresAt: new Date(NOW - DAY).toISOString() }), false, NOW).label, "Ended");
  assert.equal(keyState(key({ revokedAt: new Date(NOW - DAY).toISOString() }), false, NOW).label, "Revoked");
  assert.deepEqual([...replacedKeyIds([key({ rotatedFrom: "old" }), key()])], ["old"]);
});

test("what a key can do, in the owner's words", () => {
  assert.equal(canDoWords(["policies:read"]), "Read policies");
  assert.equal(canDoWords(["commissions:read", "policies:read"]), "Read policies, commissions");
  assert.equal(canDoWords(["leads:read", "leads:write"]), "Read leads · Create leads");
  assert.equal(canDoWords([]), "Nothing");
  assert.equal(samplePath(["commissions:read"]), "/api/v1/commissions?limit=50");
});

test("presets only tick real scopes, and there is still no full-access scope", () => {
  for (const preset of KEY_PRESETS) for (const scope of preset.scopes) assert.ok(API_SCOPE_KEYS.includes(scope), `${preset.label}: ${scope}`);
  assert.ok(KEY_PRESETS.every((preset) => preset.scopes.length < API_SCOPE_KEYS.length));
});

test("rotation offers stops now, 1 hour, 24 hours and 3 days; the route takes exactly those", () => {
  assert.deepEqual([...ROTATION_OVERLAP_HOURS], [0, 1, 24, 72]);
  assert.match(read("app/api/app/api-keys/[id]/rotate/route.ts"), /ROTATION_OVERLAP_HOURS as readonly number\[\]\)\.includes\(hours\)/);
});

test("the form builder's events have plain names, and every event the queue can carry has one", () => {
  assert.ok(WEBHOOK_EVENT_KEYS.includes("form.submitted") && WEBHOOK_EVENT_KEYS.includes("form.test"));
  assert.equal(webhookEventLabel("form.submitted"), "Application form sent");
  assert.equal(webhookEventLabel("form.test"), "Application form test");
  assert.equal(webhookEventLabel("webhook.test"), "Test delivery");
  // The application-forms paste widens the table's check to exactly these.
  const paste = read("supabase/deploy/2026-11-12-application-forms.sql");
  for (const event of WEBHOOK_EVENTS) assert.match(paste, new RegExp(`'${event.key.replace(".", "\\.")}'`));
  for (const event of WEBHOOK_EVENTS) assert.ok(EVENT_SAMPLES[event.key], `an example for ${event.key}`);
  assert.equal(getsWords(["policy.issued", "policy.lapsed"]), "Gets policy issued, lapsed");
});

test("a webhook's one chip", () => {
  const base = { status: "active", consecutiveFailures: 0, lastSuccessAt: "x", lastFailureAt: null };
  assert.equal(hookState(base).label, "Working");
  assert.equal(hookState({ ...base, status: "failing", consecutiveFailures: 5 }).label, "Failing · 5 tries");
  assert.equal(hookState({ ...base, consecutiveFailures: 1 }).label, "Retrying · 1 try");
  assert.deepEqual([hookState({ ...base, status: "disabled" }).label, hookState({ ...base, status: "disabled" }).needsYou], ["Turned off", true]);
  assert.equal(hookState({ ...base, lastSuccessAt: null }).label, "Not used yet");
});

test("their answer in plain words", () => {
  assert.equal(answerWords({ ok: true, statusCode: 200, error: null }).chip, "Delivered");
  assert.equal(answerWords({ ok: false, statusCode: 500, error: "HTTP 500" }).chip, "Their server errored");
  assert.equal(answerWords({ ok: false, statusCode: null, error: "No answer within 10 seconds." }).chip, "No answer in 10 s");
  assert.equal(answerWords({ ok: false, statusCode: 404, error: "HTTP 404" }).chip, "Address not found");
});

test("what we sent: figures in dollars, never the body", () => {
  assert.equal(sentWords("policy.issued", { carrier: "Mutual of Omaha", policyNumber: "MO-1", premiumCents: "4820", premiumMode: "monthly" }), "Policy issued · Mutual of Omaha · policy MO-1 · $48.20 a month");
  assert.equal(sentWords("webhook.test", {}), "Test delivery · a message that needs no action");
});

test("addresses show as their site; the path stays hidden", () => {
  assert.equal(hostOf("https://hooks.slack.com/services/T0/B0/xyz"), "hooks.slack.com");
  assert.equal(maskedUrl("https://hooks.slack.com/services/T0/B0/xyz"), "https://hooks.slack.com/services/••••••");
});

test("the screen's retry ladder is the delivery job's", () => {
  const rules = read("lib/webhooks/rules.ts");
  assert.match(rules, new RegExp(`RETRY_DELAYS_MINUTES = \\[${RETRY_LADDER_MINUTES.join(", ")}\\] as const`));
  assert.match(rules, /MAX_ATTEMPTS = RETRY_DELAYS_MINUTES\.length \+ 1/);
  assert.match(rules, /DISABLE_AFTER_FAILURES = 3 \* MAX_ATTEMPTS/);
  assert.equal(MAX_TRIES, 6);
  assert.equal(OFF_AFTER, 18);
});

test("samples: the key goes in the header, the signature check matches the sender's", () => {
  assert.match(requestSample("curl", "https://app.example.test", "YOUR_KEY"), /-H "Authorization: Bearer YOUR_KEY"/);
  assert.match(requestSample("js", "https://app.example.test"), /headers: \{ Authorization: "Bearer YOUR_KEY" \}/);
  const js = verifySample("js");
  assert.match(js, /createHmac\("sha256", secret\)\.update\(`\$\{t\}\.\$\{rawBody\}`\)\.digest\("hex"\)/);
  assert.match(js, /> 300\) return false/);
  assert.match(read("lib/webhooks/rules.ts"), /update\(`\$\{timestamp\}\.\$\{body\}`\)\.digest\("hex"\)/);
  // The sample delivery has the trigger's fields, and nothing sensitive.
  assert.match(SAMPLE_DELIVERY, /"premium_cents": 4820/);
  assert.doesNotMatch(SAMPLE_DELIVERY, /ssn|bank|routing|account_number/i);
});

test("the hub's routes stay owner-only, and nothing shows a key or secret after it is made", () => {
  for (const file of ["app/api/app/api-keys/[id]/route.ts", "app/api/app/webhooks/[id]/route.ts"]) {
    const source = read(file);
    const handlers = source.match(/export async function \w+\(/g) ?? [];
    const gates = source.match(/requireTenant\(\["owner"\]\)/g) ?? [];
    assert.equal(gates.length, handlers.length, file);
  }
  const ops = read("lib/apiKeys/webhookOps.ts");
  assert.doesNotMatch(ops, /select\([^)]*signing_secret/, "the sealed secret is never read back for the screen");
  assert.doesNotMatch(read("lib/apiKeys/service.ts"), /select\([^)]*key_hash/);
});

test("Integrations is the section's name; its id stays", () => {
  const sections = read("lib/settings/sections.ts");
  assert.match(sections, /id: "integrations", label: "Integrations"/);
  assert.match(read("components/app/agent-settings-tabs.tsx"), /const OWN_SCROLL[^\n]*"integrations"/);
});
