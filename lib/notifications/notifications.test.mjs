// LA-8.4 (Notion sprint, Module 8 — Settings) · the notification preference centre.
// Run with: node --experimental-strip-types --test lib/notifications/notifications.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { digestDue, eventByKey, eventForKind, inQuietHours, NOTIFICATION_EVENTS, PROTECTED_EVENT_KEYS, resolveDelivery, visibleEvents } from "./events.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = read("supabase/migrations/20261015320000_la_8_4_notifications.sql");
const EVERY = [...new Set(NOTIFICATION_EVENTS.map((e) => e.required_feature).filter(Boolean))];

test("events register themselves: a new one appears, with its defaults, and no screen changes", () => {
  const made = { key: "made_up_alert", label: "Made-up alert", description: "x", group: "Money", owned_by_module: "LA-99.1", defaults: { in_app: true, email: true, push: false }, supports_digest: true, is_protected: false, required_feature: null, kinds: ["made_up"], email: "outbox" };
  const list = [...NOTIFICATION_EVENTS, made];
  assert.ok(visibleEvents([], "producer", list).some((e) => e.key === "made_up_alert"));
  assert.equal(eventForKind("made_up", list)?.key, "made_up_alert");
  // No preference row: the registry default — absent is NOT off, or a new alert ships to nobody.
  assert.deepEqual(resolveDelivery(made, undefined), { in_app: true, email: true, push: false, digest: "immediate", protected: false });
  const panel = read("components/app/settings/notification-preferences.tsx");
  for (const e of NOTIFICATION_EVENTS) assert.ok(!panel.includes(`"${e.key}"`), `the panel names ${e.key}: it must draw from the registry`);
  assert.match(read("app/api/app/notification-preferences/route.ts"), /events: visibleEvents\(granted, context\.role\)\.map/);
  for (const e of NOTIFICATION_EVENTS) assert.match(e.key, /^[a-z][a-z0-9_]{1,63}$/);
  assert.equal(new Set(NOTIFICATION_EVENTS.map((e) => e.key)).size, NOTIFICATION_EVENTS.length);
  assert.equal(new Set(NOTIFICATION_EVENTS.flatMap((e) => e.kinds)).size, NOTIFICATION_EVENTS.flatMap((e) => e.kinds).length, "one kind, one event");
});

test("an event gated by a feature or role the person lacks does not appear", () => {
  const ownerAll = visibleEvents(EVERY, "owner").map((e) => e.key);
  assert.ok(ownerAll.includes("reinstatement_closing") && ownerAll.includes("doi_deadline"));
  const noWinback = visibleEvents(EVERY.filter((f) => f !== "winback"), "owner").map((e) => e.key);
  assert.ok(!noWinback.includes("reinstatement_closing"));
  const setter = visibleEvents(EVERY, "setter").map((e) => e.key);
  assert.ok(!setter.includes("plan_payment_failed") && !setter.includes("unclaimed_escalation"), "owner-only events are not a setter's");
  assert.ok(setter.includes("callback_due"));
});

test("four protected events — and only four — can never be switched off, by any route", () => {
  assert.deepEqual([...PROTECTED_EVENT_KEYS].sort(), ["credential_expiring", "doi_deadline", "plan_payment_failed", "reinstatement_closing"]);
  for (const key of PROTECTED_EVENT_KEYS) {
    const e = eventByKey(key);
    assert.ok(e.protected_reason, `${key} says why`);
    // Whatever is stored, it resolves on, on every channel it has, immediately.
    const d = resolveDelivery(e, { in_app: false, email: false, push: false, digest: "off" });
    assert.equal(d.in_app, true); assert.equal(d.email, true); assert.equal(d.digest, "immediate"); assert.equal(d.protected, true);
  }
  // The only writer refuses, the API goes through it, and the database refuses any stored "off".
  assert.match(read("lib/notifications/preferences.ts"), /if \(event\.is_protected\) throw new NotificationPreferenceError\(`\$\{event\.label\} cannot be switched off\./);
  assert.match(read("app/api/app/notification-preferences/route.ts"), /await savePreference\(auth\.context\.userId, event_key, patch\);/);
  assert.match(MIGRATION, /event_key not in \('doi_deadline', 'reinstatement_closing', 'credential_expiring', 'plan_payment_failed'\)\n\s+or \(in_app and email and push and digest = 'immediate'\)/);
  // Protected is the platform's: a code registry, and no route accepts it.
  assert.doesNotMatch(read("app/api/app/notification-preferences/route.ts"), /is_protected:|protected: z\./);
  // Protected events ignore quiet hours, by email and in the browser.
  const prefs = read("lib/notifications/preferences.ts");
  assert.ok(prefs.indexOf('if (event.is_protected) return "send";') < prefs.indexOf('return "quiet";'), "protected is decided before quiet hours");
  assert.match(prefs, /push: d\.push && \(d\.protected \|\| !quiet\)/);
  // Shown locked, with the reason, never hidden.
  const panel = read("components/app/settings/notification-preferences.tsx");
  assert.match(panel, /disabled=\{busy \|\| e\.protected \|\| !view\.available\}/);
  assert.match(panel, /e\.protected && e\.protectedReason \? `Cannot be switched off\. \$\{e\.protectedReason\}`/);
  // Each protected event has a real sender: DOI (its digest), reinstatement (SQL), and the two LA-8.4 added.
  assert.match(MIGRATION, /create or replace function public\.emit_credential_expiry_alerts/);
  assert.match(read("lib/subscriptions/applyProviderEvent.ts"), /if \(envelope\.type === "payment\.failed" \|\| envelope\.type === "invoice\.past_due"\) \{\n\s+await notifyPlanPaymentFailed\(tenantId, envelope\.id\)/);
});

test("digests: offered only where the event supports one, sent in the person's timezone, never empty", () => {
  const lead = eventByKey("new_lead");
  const callback = eventByKey("callback_due");
  assert.equal(resolveDelivery(lead, { in_app: true, email: true, push: false, digest: "daily" }).digest, "daily");
  assert.equal(resolveDelivery(callback, { in_app: true, email: true, push: false, digest: "daily" }).digest, "immediate", "a callback is time-bound: no digest");
  assert.equal(resolveDelivery(lead, { in_app: true, email: true, push: false, digest: "off" }).email, false, "a digest of 'off' is no email");
  assert.match(read("lib/notifications/preferences.ts"), /if \(patch\.digest && patch\.digest !== "immediate" && !event\.supports_digest\) throw/);
  assert.match(read("components/app/settings/notification-preferences.tsx"), /\{e\.supportsDigest \? \(/);
  // 08:00 in their zone: 07:30 in Chicago is not due, 08:05 is; once a day; weekly only on Mondays.
  const chicago = (iso) => new Date(iso);
  assert.equal(digestDue("daily", chicago("2026-10-15T12:30:00Z"), "America/Chicago", null), false, "07:30 in Chicago");
  assert.equal(digestDue("daily", chicago("2026-10-15T13:05:00Z"), "America/Chicago", null), true, "08:05 in Chicago");
  assert.equal(digestDue("daily", chicago("2026-10-15T20:00:00Z"), "America/Chicago", "2026-10-15T13:06:00Z"), false, "already sent today");
  assert.equal(digestDue("daily", chicago("2026-10-16T13:05:00Z"), "America/Chicago", "2026-10-15T13:06:00Z"), true, "the next day");
  assert.equal(digestDue("weekly", chicago("2026-10-15T13:05:00Z"), "America/Chicago", null), false, "a Thursday");
  assert.equal(digestDue("weekly", chicago("2026-10-19T13:05:00Z"), "America/Chicago", null), true, "a Monday");
  assert.equal(digestDue("daily", chicago("2026-10-15T13:05:00Z"), "Europe/Berlin", null), true, "15:05 in Berlin is past eight too");
  assert.equal(digestDue("daily", chicago("2026-10-15T05:30:00Z"), "Europe/Berlin", null), false, "07:30 in Berlin");
  // Never empty: a digest is built only from queued items, one email per person per cadence.
  const outbox = read("lib/notifications/outbox.ts");
  assert.match(outbox, /for \(const item of \(data \?\? \[\]\) as DigestItem\[\]\) \{/);
  assert.match(outbox, /items: mine\.map\(\(i\) =>/);
  assert.match(outbox, /if \(mark\.error \|\| !\(mark\.data \?\? \[\]\)\.length\) continue;/, "no claimed lines, no email");
});

test("quiet hours: in the person's timezone, across midnight, holding email and browser alerts but never protected ones", () => {
  const q = { enabled: true, start: "21:00", end: "08:00" };
  assert.equal(inQuietHours(new Date("2026-10-16T03:00:00Z"), "America/Chicago", q), true, "22:00 in Chicago");
  assert.equal(inQuietHours(new Date("2026-10-16T12:30:00Z"), "America/Chicago", q), true, "07:30 in Chicago");
  assert.equal(inQuietHours(new Date("2026-10-16T13:00:00Z"), "America/Chicago", q), false, "08:00 in Chicago");
  assert.equal(inQuietHours(new Date("2026-10-16T03:00:00Z"), "America/Chicago", { ...q, enabled: false }), false);
  assert.equal(inQuietHours(new Date("2026-10-16T14:00:00Z"), "UTC", { enabled: true, start: "13:00", end: "15:00" }), true, "a daytime window");
  // Held, not dropped: the outbox releases a quiet-hours row for a later run.
  assert.match(read("lib/notifications/outbox.ts"), /if \(decision === "quiet"\) \{\n\s+\/\/ Held, not dropped[^\n]*\n\s+await db\(\)\.from\("agent_notifications"\)\.update\(\{ email_handled_at: null \}\)/);
});

test("every sender asks first; the in-app feed and browser alerts follow the same choices", () => {
  const senders = {
    "lib/callbacks/reminders.ts": "callback_due", "lib/appointments/reminders.ts": "appointment_due", "lib/queueSla/service.ts": "unclaimed_escalation",
    "app/api/cron/retention-summary/route.ts": "retention_dry_run", "app/api/cron/compliance-monthly/route.ts": "compliance_monthly", "lib/ingestion/parser.ts": "carrier_status_unmapped",
  };
  for (const [file, key] of Object.entries(senders)) {
    assert.ok(read(file).includes(`eventKey: "${key}"`), `${file} does not ask about ${key}`);
    assert.equal(eventByKey(key)?.email, "sender", key);
  }
  for (const e of NOTIFICATION_EVENTS.filter((x) => x.email === "outbox")) assert.ok(e.kinds.length, `${e.key}: the outbox needs an in-app kind to email`);
  const feed = read("lib/agentAlerts/service.ts");
  assert.match(feed, /return eventType && choice\.in_app \? \[\{ \.\.\.row, event_type: eventType, push: choice\.push \}\] : \[\];/);
  assert.match(read("lib/agentAlerts/useAgentAlertFeed.ts"), /alert\.push === false/);
  // One home: the bell no longer has per-event switches; it links here.
  const bell = read("components/app/agent-alert-preferences.tsx");
  assert.doesNotMatch(bell, /enabled_events/);
  assert.match(bell, /href="\/app\/settings#alerts"/);
  // What people chose behind the bell carries over.
  assert.match(MIGRATION, /where jsonb_typeof\(s\.enabled_events\) = 'object' and s\.enabled_events ->> m\.old_key = 'false'/);
  // A run scoped to one agency touches only that agency's rows, and skips the every-agency E&O check.
  const route = read("app/api/cron/notifications/route.ts");
  assert.match(route, /const credentials = tenant \? null : await emitCredentialExpiry\(\);/);
  assert.match(read("lib/notifications/outbox.ts"), /const scoped = <Q extends \{ eq\(column: string, value: string\): Q \}>\(q: Q\): Q => \(tenantId \? q\.eq\("tenant_id", tenantId\) : q\);/);
  // Existing notifications are not emailed when the outbox starts.
  assert.match(MIGRATION, /add column if not exists email_handled_at timestamptz default now\(\);\nalter table public\.agent_notifications alter column email_handled_at drop default;/);
});

test("LA-8 audit: doi_deadline is emitted — in-app once per complaint per threshold, email through the registry", () => {
  const digest = read("lib/compliance/complaintDigest.ts");
  // The in-app row, kind doi_deadline, keyed per complaint per threshold (red, then overdue) and per recipient.
  assert.match(digest, /kind: "doi_deadline"/);
  assert.match(digest, /return `doi-deadline:\$\{complaintId\}:\$\{tone\}`;/);
  assert.match(digest, /source_key: doiDeadlineSourceKey\(c\.id, tone\)/);
  assert.match(digest, /from\("agent_notifications"\)\.upsert\(rows, \{ onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true \}\)/);
  // The email channel asks the registry; protected means it is always sent, quiet hours or not.
  assert.match(digest, /shouldEmail\(\{ userId: person\.id, tenantId: c\.tenant_id, eventKey: "doi_deadline"/);
  const event = eventByKey("doi_deadline");
  assert.equal(eventForKind("doi_deadline")?.key, "doi_deadline");
  assert.equal(event.is_protected, true);
  assert.deepEqual(resolveDelivery(event, { in_app: false, email: false, push: false, digest: "off" }), { in_app: true, email: true, push: true, digest: "immediate", protected: true });
});
