import test from "node:test";
import assert from "node:assert/strict";

import { ago, describeCron, healthRows, healthSummary } from "./healthJobs.ts";

const NOW = Date.parse("2026-11-17T14:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

function input(overrides = {}) {
  return {
    now: NOW,
    snapshot: { date: "2026-11-17", ageDays: 0 },
    billing: { healthy: true, lastRunAt: minutesAgo(600), description: "The period billing run is healthy." },
    payments: { stuck: 0, oldestReceivedAt: null, lastProcessedAt: minutesAgo(3) },
    sources: { enabled: 3, failing: [], lastSuccessAt: minutesAgo(12) },
    email: { lastSentAt: minutesAgo(3), sent24h: 40, failed24h: 0 },
    ladder: { lastRunAt: minutesAgo(1), ok: true, error: null },
    appCron: [{ path: "/api/cron/notifications", lastDispatchedAt: minutesAgo(2), skippedReason: null, httpStatus: 200, timedOut: false }],
    dbCron: "missing",
    ...overrides,
  };
}

const row = (rows, key) => rows.find((item) => item.key === key);

test("a healthy platform: every watched job working, the database jobs honestly not watched yet", () => {
  const rows = healthRows(input());
  assert.ok(rows.filter((item) => item.key !== "db-jobs").every((item) => item.status === "working"), JSON.stringify(rows.map((item) => [item.key, item.status])));
  assert.equal(row(rows, "db-jobs").status, "not_watched");
  assert.match(row(rows, "db-jobs").reason, /needs a database update/);
  assert.equal(healthSummary(rows), "All 7 watched jobs working");
});

test("production on 2026-11-17: metrics stopped, the app refuses the database's calls (401)", () => {
  const rows = healthRows(input({
    snapshot: { date: "2026-09-21", ageDays: 57 },
    appCron: [
      { path: "/api/cron/metrics-daily", lastDispatchedAt: minutesAgo(600), skippedReason: null, httpStatus: null, timedOut: null },
      { path: "/api/cron/webhooks", lastDispatchedAt: minutesAgo(1), skippedReason: null, httpStatus: 401, timedOut: false },
      { path: "/api/cron/trial-reminders", lastDispatchedAt: minutesAgo(1440), skippedReason: null, httpStatus: null, timedOut: null },
    ],
  }));
  const metrics = row(rows, "metrics");
  assert.equal(metrics.status, "failing");
  assert.equal(metrics.lastWorked, "Sep 21");
  assert.match(metrics.reason, /refused \(401\)/);
  const webhooks = row(rows, "app:/api/cron/webhooks");
  assert.equal(webhooks.status, "failing");
  assert.match(webhooks.reason, /CRON_SECRET/);
  // A daily job whose answer expired is failing too when the same calls are being refused.
  assert.equal(row(rows, "app:/api/cron/trial-reminders").status, "failing");
  // The folded routes have no line of their own.
  assert.equal(row(rows, "app:/api/cron/metrics-daily"), undefined);
  // Failing first.
  assert.equal(rows[0].status, "failing");
});

test("a job whose answer expired, with nothing refused, is couldn't-check, not working", () => {
  const rows = healthRows(input({ appCron: [{ path: "/api/cron/trial-reminders", lastDispatchedAt: minutesAgo(1440), skippedReason: null, httpStatus: null, timedOut: null }] }));
  assert.equal(row(rows, "app:/api/cron/trial-reminders").status, "unknown");
});

test("skipped, timed out, never called and late are said plainly", () => {
  const rows = healthRows(input({
    appCron: [
      { path: "/api/cron/notifications", lastDispatchedAt: minutesAgo(2), skippedReason: "vault secret cron_secret is missing", httpStatus: null, timedOut: null },
      { path: "/api/cron/calendar-busy", lastDispatchedAt: minutesAgo(2), skippedReason: null, httpStatus: null, timedOut: true },
      { path: "/api/cron/licence-lapse", lastDispatchedAt: null, skippedReason: null, httpStatus: null, timedOut: null },
      { path: "/api/cron/deletion-perform", lastDispatchedAt: minutesAgo(400), skippedReason: null, httpStatus: 200, timedOut: false },
    ],
  }));
  assert.match(row(rows, "app:/api/cron/notifications").reason, /Skipped: vault secret cron_secret is missing/);
  assert.match(row(rows, "app:/api/cron/calendar-busy").reason, /did not answer in time/);
  assert.match(row(rows, "app:/api/cron/licence-lapse").reason, /never called/);
  assert.equal(row(rows, "app:/api/cron/deletion-perform").status, "look");
});

test("payment events: stuck past 10 minutes is failing, a fresh queue is working", () => {
  assert.equal(row(healthRows(input({ payments: { stuck: 2, oldestReceivedAt: "2026-09-14T05:51:07Z", lastProcessedAt: minutesAgo(300) } })), "payments").status, "failing");
  assert.equal(row(healthRows(input({ payments: { stuck: 2, oldestReceivedAt: minutesAgo(1), lastProcessedAt: minutesAgo(2) } })), "payments").status, "working");
});

test("a read that failed is couldn't-check, never working", () => {
  const rows = healthRows(input({ snapshot: null, billing: null, payments: null, sources: null, email: null, ladder: null, appCron: null, dbCron: null }));
  assert.ok(rows.every((item) => item.status === "unknown"), JSON.stringify(rows.map((item) => [item.key, item.status])));
});

test("database jobs once readable: failures, housekeeping left out, the app routes not listed twice", () => {
  const rows = healthRows(input({
    dbCron: [
      { jobname: "callback-due", schedule: "* * * * *", active: true, lastStartAt: minutesAgo(1), lastStatus: "failed", lastMessage: "ERROR: column reference is ambiguous", lastSucceededAt: null },
      { jobname: "assignment-rotation", schedule: "*/5 * * * *", active: true, lastStartAt: minutesAgo(2), lastStatus: "succeeded", lastMessage: "1 row", lastSucceededAt: minutesAgo(2) },
      { jobname: "callback-jobs-log-cleanup", schedule: "23 3 * * *", active: true, lastStartAt: minutesAgo(600), lastStatus: "succeeded", lastMessage: null, lastSucceededAt: minutesAgo(600) },
      { jobname: "app-cron-webhooks", schedule: "* * * * *", active: true, lastStartAt: minutesAgo(1), lastStatus: "succeeded", lastMessage: null, lastSucceededAt: minutesAgo(1) },
    ],
  }));
  const callbacks = row(rows, "db:callback-due");
  assert.equal(callbacks.status, "failing");
  assert.equal(callbacks.name, "Callback due times");
  assert.equal(callbacks.shouldRun, "Every minute");
  assert.equal(callbacks.lastWorked, "Never");
  assert.equal(row(rows, "db:assignment-rotation").status, "working");
  assert.equal(row(rows, "db:callback-jobs-log-cleanup"), undefined);
  assert.equal(row(rows, "db:app-cron-webhooks"), undefined);
  assert.equal(row(rows, "db-jobs"), undefined);
});

test("cron schedules and ages in words", () => {
  assert.equal(describeCron("* * * * *"), "Every minute");
  assert.equal(describeCron("*/15 * * * *"), "Every 15 minutes");
  assert.equal(describeCron("5 * * * *"), "Every hour");
  assert.equal(describeCron("0 3 * * *"), "Every day at 03:00 UTC");
  assert.equal(describeCron("0 3 * * 1"), "0 3 * * 1");
  assert.equal(ago(null, NOW), "Never");
  assert.equal(ago(minutesAgo(12), NOW), "12 min ago");
  assert.equal(ago(minutesAgo(300), NOW), "5 hours ago");
  assert.equal(ago("2026-09-21T04:00:00Z", NOW), "Sep 21");
});
