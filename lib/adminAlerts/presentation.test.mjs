import test from "node:test";
import assert from "node:assert/strict";
import { buildStaffAlerts, buildStaffNotifications } from "./presentation.ts";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const quiet = { now: NOW, stuckWebhooks: null, failingSources: null, maintenance: null, billingRun: null, pastDueCount: null, seatLimited: null };

test("a webhook is failing only once it has waited ten minutes, and only super admins see it", () => {
  const fresh = { count: 3, oldestReceivedAt: "2026-09-24T11:55:00Z", lastError: null };
  const stuck = { count: 9, oldestReceivedAt: "2026-09-24T11:42:00Z", lastError: "timeout" };
  assert.deepEqual(buildStaffAlerts({ ...quiet, role: "super_admin", stuckWebhooks: fresh }), []);
  const [alert] = buildStaffAlerts({ ...quiet, role: "super_admin", stuckWebhooks: stuck });
  assert.equal(alert.title, "Webhook failing");
  assert.match(alert.body, /for 18 minutes\. 9 events are waiting\. Last error: timeout/);
  assert.deepEqual(buildStaffAlerts({ ...quiet, role: "billing_admin", stuckWebhooks: stuck }), []);
});

test("each alert is shown only to the roles that can open its page", () => {
  const input = { ...quiet, maintenance: { level: "read_only", message: null }, pastDueCount: 2, failingSources: [{ name: "Cobalt DNC", failures24h: 4, lastSuccessAt: null }] };
  assert.deepEqual(buildStaffAlerts({ ...input, role: "support_agent" }), []);
  assert.deepEqual(buildStaffAlerts({ ...input, role: "platform_config" }).map((a) => a.title), ["Scrub failing", "Maintenance is on"]);
  assert.deepEqual(buildStaffAlerts({ ...input, role: "billing_admin" }).map((a) => a.title), ["Payments failing"]);
});

test("critical alerts come before warnings", () => {
  const alerts = buildStaffAlerts({ ...quiet, role: "super_admin", pastDueCount: 1, maintenance: { level: "locked", message: "Upgrading" } });
  assert.deepEqual(alerts.map((a) => a.severity), ["critical", "warning"]);
  assert.match(alerts[0].body, /Every workspace is locked\. “Upgrading”/);
});

test("seat limits list up to three customers, then summarise", () => {
  const tenant = (n) => ({ tenantId: `t${n}`, tenantName: `Tenant ${n}`, used: 12, max: 12, pendingInvites: n === 1 ? 2 : 0 });
  const few = buildStaffAlerts({ ...quiet, role: "support_agent", seatLimited: [tenant(1)] });
  assert.equal(few[0].body, "Tenant 1 is at 12 of 12 seats and has 2 pending invites.");
  const many = buildStaffAlerts({ ...quiet, role: "support_agent", seatLimited: [1, 2, 3, 4].map(tenant) });
  assert.equal(many.length, 1);
  assert.equal(many[0].link, "/admin/tenants");
});

test("an unhealthy billing run is an alert with the monitor's own sentence", () => {
  const [alert] = buildStaffAlerts({ ...quiet, role: "billing_admin", billingRun: { healthy: false, description: "The period billing run has never recorded a run." } });
  assert.equal(alert.body, "The period billing run has never recorded a run.");
  assert.deepEqual(buildStaffAlerts({ ...quiet, role: "billing_admin", billingRun: { healthy: true, description: "ok" } }), []);
});

const trial = { subscriptionId: "s1", tenantId: "t1", tenantName: "Bell & Vance Agency", trialEndsAt: "2026-10-06T12:00:00Z", startedAt: "2026-09-08T12:00:00Z", daysRemaining: 12, hasPaymentMethod: false };

test("a trial ending with no card is a notification, dated when it entered the window", () => {
  const [item] = buildStaffNotifications({ role: "billing_admin", now: NOW, trials: [trial], audit: [], readKeys: new Set() });
  assert.equal(item.body, "Bell & Vance Agency’s trial ends in 12 days with no card on file.");
  assert.equal(item.created_at, "2026-09-22T12:00:00.000Z");
  assert.equal(buildStaffNotifications({ role: "billing_admin", now: NOW, trials: [{ ...trial, hasPaymentMethod: true }], audit: [], readKeys: new Set() }).length, 0);
  assert.equal(buildStaffNotifications({ role: "billing_admin", now: NOW, trials: [{ ...trial, daysRemaining: 20 }], audit: [], readKeys: new Set() }).length, 0);
});

test("plan changes and cancellations from the audit log, newest first, minus what was read", () => {
  const audit = [
    { id: "a1", action: "subscription.plan_changed", ts: "2026-09-24T10:00:00Z", tenantId: "t2", tenantName: "Northline Insurance", fromPlan: "Starter", toPlan: "Growth", appliedNow: true },
    { id: "a2", action: "subscription.cancelled", ts: "2026-09-24T11:00:00Z", tenantId: "t3", tenantName: "Pike & Co", reason: null },
    { id: "a3", action: "subscription.plan_changed", ts: "2026-09-01T10:00:00Z", tenantId: "t2", tenantName: "Old", fromPlan: "A", toPlan: "B" },
  ];
  const items = buildStaffNotifications({ role: "super_admin", now: NOW, trials: [], audit, readKeys: new Set(["audit:a2"]) });
  assert.deepEqual(items.map((i) => i.id), ["audit:a1"]);
  assert.equal(items[0].body, "Northline Insurance moved Starter → Growth.");
});

test("staff without billing access get no billing notifications", () => {
  assert.deepEqual(buildStaffNotifications({ role: "support_agent", now: NOW, trials: [trial], audit: [], readKeys: new Set() }), []);
});

test("SA-4.9: a credit meter alerts at the warn threshold and again, critically, at 100% — platform roles only", async () => {
  const { creditAlertLevel, CREDIT_ALERT_MAX_ROWS } = await import("./presentation.ts");
  const low = { tenantId: "t1", tenantName: "Acme", meterLabel: "DNC lookups", used: 850, limit: 1000 };
  const out = { tenantId: "t2", tenantName: "Bolt", meterLabel: "TCPA checks", used: 1000, limit: 1000 };
  assert.equal(creditAlertLevel(850, 1000), "running_low");
  assert.equal(creditAlertLevel(1000, 1000), "used_up", "at the limit is used up");
  const alerts = buildStaffAlerts({ ...quiet, role: "platform_config", creditUsage: [low, out] });
  assert.deepEqual(alerts.map((a) => [a.title, a.severity]), [["Credits used up", "critical"], ["Credits running low", "warning"]]);
  assert.match(alerts[1].body, /Acme has used 850 of 1,000 DNC lookups \(85%\)/);
  assert.equal(alerts[0].link, "/admin/credits-limits");
  assert.deepEqual(buildStaffAlerts({ ...quiet, role: "billing_admin", creditUsage: [low, out] }), []);
  const many = Array.from({ length: CREDIT_ALERT_MAX_ROWS + 1 }, (_, i) => ({ ...low, tenantId: `t${i}` }));
  const summary = buildStaffAlerts({ ...quiet, role: "super_admin", creditUsage: many });
  assert.equal(summary.length, 1);
  assert.match(summary[0].body, /^4 customer meters are past the warning threshold/);
});
