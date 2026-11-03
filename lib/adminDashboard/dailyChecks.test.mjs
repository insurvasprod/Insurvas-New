import test from "node:test";
import assert from "node:assert/strict";

import { canOpenAdminHref } from "./compose.ts";
import { FAILED_SIGNIN_LOOK, WEBHOOK_STUCK_MINUTES, allDailyChecks, dailyChecksFor, dailySummary, readableTimes, waited } from "./dailyChecks.ts";

const NOW = Date.parse("2026-10-13T09:00:00Z");

/** A morning where everything is fine. */
function healthy(overrides = {}) {
  return {
    now: NOW,
    stuckWebhooks: { count: 0, oldestReceivedAt: null, lastError: null },
    billingRun: { healthy: true, description: "Last run finished 3 hours ago." },
    pastDue: 0,
    overdueInvoices: 0,
    mismatchedInvoices: 0,
    trialsEnding: [],
    newSignups24h: 2,
    cancellations24h: 0,
    seatLimited: [],
    suspendedTenants: 0,
    signIns: { today: 140, failedToday: 3 },
    staleInvitations: 0,
    failingSources: [],
    snapshot: { date: "2026-10-12", ageDays: 1 },
    maintenance: { level: "off" },
    featuresOff: 0,
    staffChangesToday: 4,
    ...overrides,
  };
}

const byKey = (checks) => Object.fromEntries(checks.map((check) => [check.key, check]));

test("a healthy morning has nothing failing and nothing to look at", () => {
  const checks = allDailyChecks(healthy());
  assert.equal(checks.filter((check) => check.status === "failing" || check.status === "look" || check.status === "unknown").length, 0);
  assert.match(dailySummary(checks), /^\d+ fine$/);
});

test("a failed read is 'Couldn't check', never 'Clear'", () => {
  const checks = byKey(allDailyChecks(healthy({ pastDue: null, failingSources: null, snapshot: null })));
  for (const key of ["past-due", "compliance", "metrics"]) assert.equal(checks[key].status, "unknown", key);
  assert.match(dailySummary(Object.values(checks)), /3 couldn't be checked/);
});

test("payment events: queued is clear, stuck past the threshold is failing", () => {
  const fresh = new Date(NOW - 2 * 60_000).toISOString();
  const stale = new Date(NOW - (WEBHOOK_STUCK_MINUTES + 5) * 60_000).toISOString();
  assert.equal(byKey(allDailyChecks(healthy({ stuckWebhooks: { count: 3, oldestReceivedAt: fresh, lastError: null } }))).webhooks.status, "clear");
  const stuck = byKey(allDailyChecks(healthy({ stuckWebhooks: { count: 3, oldestReceivedAt: stale, lastError: "timeout" } }))).webhooks;
  assert.equal(stuck.status, "failing");
  assert.match(stuck.detail, /3 events waiting/);
  assert.match(stuck.detail, /timeout/);
});

test("trials: a card on file is FYI, no card is a look, with the names", () => {
  const withCard = byKey(allDailyChecks(healthy({ trialsEnding: [{ tenantName: "Acme", daysRemaining: 1, hasPaymentMethod: true }] }))).trials;
  assert.equal(withCard.status, "info");
  const noCard = byKey(allDailyChecks(healthy({ trialsEnding: [{ tenantName: "Acme", daysRemaining: 1, hasPaymentMethod: false }, { tenantName: "Birch", daysRemaining: 2, hasPaymentMethod: true }] }))).trials;
  assert.equal(noCard.status, "look");
  assert.match(noCard.detail, /1 with no card on file: Acme/);
});

test("failed sign-ins are a look only past the threshold", () => {
  assert.equal(byKey(allDailyChecks(healthy({ signIns: { today: 100, failedToday: FAILED_SIGNIN_LOOK } }))).signins.status, "clear");
  assert.equal(byKey(allDailyChecks(healthy({ signIns: { today: 100, failedToday: FAILED_SIGNIN_LOOK + 1 } }))).signins.status, "look");
});

test("a late or missing metrics snapshot is failing", () => {
  assert.equal(byKey(allDailyChecks(healthy({ snapshot: { date: "2026-10-09", ageDays: 4 } }))).metrics.status, "failing");
  assert.equal(byKey(allDailyChecks(healthy({ snapshot: { date: null, ageDays: null } }))).metrics.status, "failing");
});

test("maintenance: a banner is FYI, read only or locked is a look", () => {
  assert.equal(byKey(allDailyChecks(healthy({ maintenance: { level: "banner_only" } }))).maintenance.status, "info");
  assert.equal(byKey(allDailyChecks(healthy({ maintenance: { level: "locked" } }))).maintenance.status, "look");
});

test("worst first: failing, then look, then the rest in the listed order", () => {
  const checks = dailyChecksFor("super_admin", healthy({ failingSources: [{ name: "DNC.com" }], pastDue: 2 }));
  assert.equal(checks[0].key, "compliance");
  assert.equal(checks[1].key, "past-due");
});

test("a role only gets checks whose page it can open", () => {
  for (const role of ["super_admin", "support_agent", "billing_admin", "platform_config"]) {
    const checks = dailyChecksFor(role, healthy());
    assert.ok(checks.length > 0, `${role} has checks`);
    for (const check of checks) assert.ok(canOpenAdminHref(role, check.href), `${role} → ${check.href}`);
  }
  // platform_config sees no customer or money data at all.
  const config = dailyChecksFor("platform_config", healthy()).map((check) => check.area);
  assert.ok(!config.includes("Money") && !config.includes("Customers"));
});

test("raw ISO times in a detail read as dates", () => {
  assert.equal(readableTimes("last completed 2026-09-13T04:52:22.402089+00:00, which is old"), "last completed 13 Sep 2026, 04:52 UTC, which is old");
  const billing = byKey(allDailyChecks(healthy({ billingRun: { healthy: false, description: "Last run 2026-09-13T04:52:22Z." } })))["billing-run"];
  assert.equal(billing.detail, "Last run 13 Sep 2026, 04:52 UTC.");
});

test("a wait reads in minutes, hours or days", () => {
  assert.equal(waited(12), "12 minutes");
  assert.equal(waited(300), "5 hours");
  assert.equal(waited(42_587), "30 days");
});
