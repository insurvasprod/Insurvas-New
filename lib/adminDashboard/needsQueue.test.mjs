import test from "node:test";
import assert from "node:assert/strict";

import { allDailyChecks, dailyChecksFor } from "./dailyChecks.ts";
import { CHECK_EXPLAIN, CHECK_SHORT_TITLE, defaultView, groupForView, needsCounts, needsHref, parseNeedsView, resolveSelection, viewOf } from "./needsQueue.ts";

const NOW = Date.parse("2026-11-17T09:00:00Z");

/** Production on 2026-11-17, roughly: payment events stuck, the billing run and the metrics stopped. */
function morning(overrides = {}) {
  return {
    now: NOW,
    stuckWebhooks: { count: 2, oldestReceivedAt: "2026-09-14T05:51:07Z", lastError: null },
    billingRun: { healthy: false, description: "The period billing run last completed 2026-09-13T04:52:00Z." },
    pastDue: 1,
    overdueInvoices: 19,
    mismatchedInvoices: 23,
    trialsEnding: [{ tenantName: "Blair Test Insurance", daysRemaining: 1, hasPaymentMethod: false }],
    newSignups24h: 3,
    cancellations24h: 0,
    seatLimited: [{ tenantName: "A", used: 5, max: 5 }],
    suspendedTenants: 2,
    signIns: { today: 3, failedToday: 1 },
    staleInvitations: 72,
    failingSources: [],
    snapshot: { date: "2026-09-21", ageDays: 57 },
    maintenance: { level: "off" },
    featuresOff: 1,
    staffChangesToday: 2,
    ...overrides,
  };
}

test("every check has a short title and a plain explanation", () => {
  for (const check of allDailyChecks(morning())) {
    assert.ok(CHECK_SHORT_TITLE[check.key], `short title for ${check.key}`);
    assert.ok(CHECK_EXPLAIN[check.key], `explanation for ${check.key}`);
  }
});

test("statuses fall into To do, FYI and Clear; couldn't-check is to do, never clear", () => {
  assert.equal(viewOf("failing"), "todo");
  assert.equal(viewOf("look"), "todo");
  assert.equal(viewOf("unknown"), "todo");
  assert.equal(viewOf("info"), "fyi");
  assert.equal(viewOf("clear"), "clear");
});

test("counts add up to the role's checks", () => {
  const checks = dailyChecksFor("super_admin", morning());
  const counts = needsCounts(checks);
  assert.equal(counts.todo + counts.fyi + counts.clear, checks.length);
  assert.equal(counts.failing, 3); // payment events, billing run, nightly metrics
});

test("groups follow Money, Customers, Security, Platform and keep the worst first inside each", () => {
  const checks = dailyChecksFor("super_admin", morning());
  const groups = groupForView(checks, "todo");
  assert.deepEqual(groups.map((group) => group.area), ["Money", "Customers", "Platform"]);
  const money = groups[0].checks.map((check) => check.status);
  assert.deepEqual(money.slice(0, 2), ["failing", "failing"]);
  assert.ok(groups.every((group) => group.checks.every((check) => viewOf(check.status) === "todo")));
});

test("the address picks the view and the check; a stray or foreign check falls back to the view's first", () => {
  const checks = dailyChecksFor("super_admin", morning());
  assert.deepEqual(resolveSelection(checks, null, null).view, "todo");
  assert.equal(resolveSelection(checks, null, null).check?.key, "webhooks");
  // A check named without a view opens in its own view.
  const trials = resolveSelection(checks, null, "trials");
  assert.equal(trials.view, "todo");
  assert.equal(trials.check?.key, "trials");
  const signups = resolveSelection(checks, null, "signups");
  assert.equal(signups.view, "fyi");
  // A check outside the asked view gives way to the view's first.
  assert.equal(resolveSelection(checks, "fyi", "trials").check?.key, groupForView(checks, "fyi")[0].checks[0].key);
  assert.equal(resolveSelection(checks, "todo", "no-such-check").check?.key, "webhooks");
  assert.equal(parseNeedsView("nonsense"), null);
});

test("platform config never gets a money check in its queue", () => {
  const checks = dailyChecksFor("platform_config", morning());
  assert.ok(checks.every((check) => check.area !== "Money"));
  assert.equal(resolveSelection(checks, null, "trials").check?.key === "trials", false);
});

test("a morning where everything is fine opens on FYI", () => {
  const fine = morning({ stuckWebhooks: { count: 0, oldestReceivedAt: null, lastError: null }, billingRun: { healthy: true, description: "ok" }, pastDue: 0, overdueInvoices: 0, mismatchedInvoices: 0, trialsEnding: [], seatLimited: [], staleInvitations: 0, snapshot: { date: "2026-11-16", ageDays: 1 } });
  assert.equal(defaultView(dailyChecksFor("super_admin", fine)), "fyi");
});

test("a check's address keeps the tab", () => {
  assert.equal(needsHref("todo", "trials"), "/admin?tab=needs&view=todo&check=trials");
  assert.equal(needsHref("clear"), "/admin?tab=needs&view=clear");
});
