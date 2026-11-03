// Run with: npm test
//
// #24's claim is that a billing job which never runs looks identical to a healthy one. These tests
// exist to make that false, so most of them are about the ways of being UNHEALTHY — a monitor that
// only proves it can say "ok" has proven nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  billingHeartbeatState,
  describeBillingHeartbeat,
  BILLING_RUN_SUCCEEDED,
  BILLING_RUN_FAILED,
} from "./heartbeat.ts";

const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 36 * HOUR; // the default window: a daily cron may miss once, not twice

const ranAt = (msAgo, action = BILLING_RUN_SUCCEEDED) => ({
  action,
  metadata: { considered: 3, invoicesRaised: 1 },
  created_at: new Date(NOW - msAgo).toISOString(),
});

const state = (row, unbilledCount = 0, maxAgeSeconds = DAY / 1000) =>
  billingHeartbeatState({ row, nowMs: NOW, maxAgeSeconds, unbilledCount });

test("a recent successful run with nobody unbilled is healthy", () => {
  const heartbeat = state(ranAt(2 * HOUR));
  assert.equal(heartbeat.healthy, true);
  assert.equal(heartbeat.reason, "ok");
  assert.equal(heartbeat.ageSeconds, 7200);
});

test("no run ever recorded is never_run, not ok", () => {
  const heartbeat = state(null);
  assert.equal(heartbeat.healthy, false);
  assert.equal(heartbeat.reason, "never_run");
  assert.equal(heartbeat.lastRunAt, null);
  assert.equal(heartbeat.ageSeconds, null);
});

test("a run older than the window is stale", () => {
  const heartbeat = state(ranAt(48 * HOUR));
  assert.equal(heartbeat.healthy, false);
  assert.equal(heartbeat.reason, "stale");
});

test("one missed daily run is tolerated; the window is not one day", () => {
  // 30 hours: yesterday's run happened, today's has not yet. Alerting here would mean an alert
  // every time the cron slipped by an hour.
  assert.equal(state(ranAt(30 * HOUR)).healthy, true);
});

test("a failed last run is reported as failed rather than merely recent", () => {
  const heartbeat = state(ranAt(HOUR, BILLING_RUN_FAILED));
  assert.equal(heartbeat.healthy, false);
  assert.equal(heartbeat.reason, "last_run_failed");
});

// ── the check the age alone cannot make ──────────────────────────────────────

test("a recent successful run that left subscriptions unbilled is NOT healthy", () => {
  const heartbeat = state(ranAt(HOUR), 12);
  assert.equal(heartbeat.healthy, false);
  assert.equal(heartbeat.reason, "subscriptions_unbilled");
  assert.equal(heartbeat.unbilledCount, 12);
});

test("the unbilled count is carried on every verdict, healthy or not", () => {
  assert.equal(state(ranAt(HOUR), 0).unbilledCount, 0);
  assert.equal(state(null, 7).unbilledCount, 7);
  assert.equal(state(ranAt(48 * HOUR), 7).unbilledCount, 7);
});

test("never_run outranks unbilled, because it explains it", () => {
  // Telling an operator that 40 subscriptions are unbilled is less useful than telling them the
  // job has never run, which is why.
  assert.equal(state(null, 40).reason, "never_run");
});

test("a failed run outranks unbilled, for the same reason", () => {
  assert.equal(state(ranAt(HOUR, BILLING_RUN_FAILED), 40).reason, "last_run_failed");
});

test("staleness outranks unbilled", () => {
  assert.equal(state(ranAt(72 * HOUR), 40).reason, "stale");
});

// ── the things a monitor says out loud ───────────────────────────────────────

test("every unhealthy reason produces a description that names the consequence", () => {
  const rows = [
    state(null),
    state(ranAt(72 * HOUR)),
    state(ranAt(HOUR, BILLING_RUN_FAILED)),
    state(ranAt(HOUR), 12),
  ];
  for (const heartbeat of rows) {
    const text = describeBillingHeartbeat(heartbeat);
    assert.ok(text.length > 20, `${heartbeat.reason} has no description`);
    // Each one must say what it costs, not merely that a state was entered.
    assert.match(text, /invoic|bill/i, `${heartbeat.reason}: ${text}`);
  }
});

test("the unbilled description says the job is running and not billing", () => {
  const text = describeBillingHeartbeat(state(ranAt(HOUR), 12));
  assert.match(text, /12 subscription/);
  assert.match(text, /running and not billing/);
});

test("an unparseable timestamp is treated as infinitely old rather than as fresh", () => {
  // The dangerous direction: a bad date that read as age 0 would report a dead scheduler healthy.
  const heartbeat = state({ action: BILLING_RUN_SUCCEEDED, metadata: null, created_at: "not a date" });
  assert.equal(heartbeat.healthy, false);
  assert.equal(heartbeat.reason, "stale");
});

test("the last report is carried through so an operator sees what the run did", () => {
  const heartbeat = state(ranAt(HOUR));
  assert.deepEqual(heartbeat.lastReport, { considered: 3, invoicesRaised: 1 });
});
