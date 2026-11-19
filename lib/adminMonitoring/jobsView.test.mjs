// Run with: node --experimental-strip-types --test lib/adminMonitoring/jobsView.test.mjs
//
// Admin › Monitoring › Jobs & services (admin round 1, monitoring.html screen 6): each job's sheet facts, and Run now
// only ever reaching the app jobs Platform health names, each through its own fail-closed /api/cron route.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { APP_JOBS, healthRows } from "../adminDashboard/healthJobs.ts";
import { APP_SCHEDULES, RUNNABLE_SLUGS, answerLabel, isRunnableSlug, jobDetails, jobFix, jobPathOf, jobsCause } from "./jobsView.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("every runnable job has a schedule and its own fail-closed route", () => {
  assert.deepEqual(Object.keys(APP_SCHEDULES).sort(), Object.keys(APP_JOBS).sort());
  for (const slug of RUNNABLE_SLUGS) {
    const path = `app/api/cron/${slug}/route.ts`;
    assert.ok(existsSync(new URL(path, root)), path);
    assert.ok(read(path).includes('if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)'), `${path} does not fail closed`);
  }
});

test("Run now's route loads exactly the runnable jobs, is super admin only and audited", () => {
  const source = read("app/api/admin/monitoring/jobs/[key]/run/route.ts");
  const loaded = [...source.matchAll(/^\s+"([a-z0-9-]+)": \(\) => import\("@\/app\/api\/cron\/([a-z0-9-]+)\/route"\)/gm)];
  assert.deepEqual(loaded.map((m) => m[1]).sort(), [...RUNNABLE_SLUGS].sort());
  for (const m of loaded) assert.equal(m[1], m[2]);
  assert.match(source, /requireAdminRole\(\["super_admin"\]\)/);
  assert.match(source, /action: "monitoring\.job_run"/);
  assert.ok(read("lib/audit/actions.ts").includes('"monitoring.job_run"'));
});

test("only known slugs are runnable", () => {
  assert.ok(isRunnableSlug("metrics-daily"));
  assert.ok(!isRunnableSlug("assignment-rotation"));
  assert.ok(!isRunnableSlug("../admin"));
  assert.ok(!isRunnableSlug("Metrics-Daily"));
});

test("rows map to their route: folded rows and app rows", () => {
  assert.equal(jobPathOf("metrics"), "/api/cron/metrics-daily");
  assert.equal(jobPathOf("billing"), "/api/cron/period-billing");
  assert.equal(jobPathOf("app:/api/cron/webhooks"), "/api/cron/webhooks");
  assert.equal(jobPathOf("payments"), null);
});

const NOW = Date.parse("2026-11-17T12:00:00Z");
const input = {
  now: NOW,
  snapshot: { date: "2026-09-21", ageDays: 57 },
  billing: { healthy: true, lastRunAt: "2026-11-17T03:00:00Z", description: "Ran today." },
  payments: { stuck: 0, oldestReceivedAt: null, lastProcessedAt: "2026-11-17T11:00:00Z" },
  sources: { enabled: 1, failing: [], lastSuccessAt: "2026-11-17T11:00:00Z" },
  email: { lastSentAt: "2026-11-17T11:00:00Z", sent24h: 4, failed24h: 0 },
  ladder: { lastRunAt: "2026-11-17T11:59:30Z", ok: true, error: null },
  appCron: [
    { path: "/api/cron/metrics-daily", lastDispatchedAt: "2026-11-17T04:00:00Z", skippedReason: null, httpStatus: 401, timedOut: false },
    { path: "/api/cron/webhooks", lastDispatchedAt: "2026-11-17T11:59:00Z", skippedReason: null, httpStatus: 200, timedOut: false },
  ],
  dbCron: "missing",
};

test("a job's sheet: schedule, last call, the fix in words", () => {
  const jobs = jobDetails(input, healthRows(input));
  const metrics = jobs.find((job) => job.key === "metrics");
  assert.equal(metrics.status, "failing");
  assert.equal(metrics.path, "/api/cron/metrics-daily");
  assert.deepEqual(metrics.schedule, { words: "Every day at 04:00 UTC", cron: "0 4 * * *" });
  assert.equal(metrics.lastCall.httpStatus, 401);
  assert.match(metrics.fix, /CRON_SECRET/);
  const webhooks = jobs.find((job) => job.key === "app:/api/cron/webhooks");
  assert.equal(webhooks.status, "working");
  assert.equal(webhooks.fix, null);
  const db = jobs.find((job) => job.key === "db-jobs");
  assert.match(db.fix, /20261117310000/);
  assert.match(jobsCause(input), /401/);
});

test("fixes for the other ways a call goes wrong", () => {
  const call = (o) => ({ at: "2026-11-17T04:00:00Z", httpStatus: null, timedOut: null, skippedReason: null, ...o });
  assert.match(jobFix("failing", "x", call({ skippedReason: "vault secret cron_secret is missing" }), null), /cron_secret/);
  assert.match(jobFix("failing", "x", call({ timedOut: true }), null), /60 seconds/);
  assert.match(jobFix("failing", "x", call({ httpStatus: 500 }), null), /server log/);
  assert.match(jobFix("failing", "x", call({ at: null }), null), /never called/);
  assert.match(jobFix("failing", "db:x", null, { active: true, lastStatus: "failed", lastStartAt: "x", lastMessage: "boom" }), /error below/);
  assert.deepEqual(answerLabel({ httpStatus: 401, timedOut: false, skippedReason: null }), { text: "401", tone: "danger" });
  assert.deepEqual(answerLabel({ httpStatus: null, timedOut: null, skippedReason: null }), { text: "Not kept", tone: "neutral" });
});
