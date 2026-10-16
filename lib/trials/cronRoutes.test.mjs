// Run with: node --experimental-strip-types --test lib/trials/cronRoutes.test.mjs
//
// The three scheduled routes added in the billing audit (2026-10-15): each exists, fails closed on
// CRON_SECRET the way /api/cron/period-billing does, calls the shared lib function its script calls,
// and is one of the paths the database dispatcher may call (20261015500000).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { metricsDates, NIGHTLY_METRICS_DAYS, MAX_METRICS_DAYS } from "../metrics/buildDaily.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const ROUTES = {
  "/api/cron/trial-reminders": { lib: "sendDueTrialReminders", script: "scripts/send-trial-reminders.mjs" },
  "/api/cron/invoices-overdue": { lib: "markOverdueInvoices", script: "scripts/mark-overdue-invoices.mjs" },
  "/api/cron/metrics-daily": { lib: "buildMetricsDays", script: "scripts/build-metrics.mjs" },
};

for (const [path, { lib, script }] of Object.entries(ROUTES)) {
  test(`${path} is a GET that fails closed on CRON_SECRET and shares ${lib} with its script`, () => {
    const source = read(`app${path}/route.ts`);
    assert.match(source, /export async function GET\(request: Request\)/);
    assert.ok(source.includes('if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)'), "no fail-closed bearer check");
    assert.match(source, /status: 401/);
    assert.ok(source.includes(lib), `${path} does not call ${lib}`);
    assert.ok(read(script).includes(lib), `${script} does not call ${lib}`);
  });

  test(`${path} is a route the database dispatcher may call`, () => {
    assert.ok(read("supabase/migrations/20261015500000_app_cron_dispatcher.sql").includes(`'${path}'`));
  });
}

test("the nightly metrics window is yesterday and today, oldest first, capped", () => {
  const now = new Date("2026-10-15T04:00:00Z");
  assert.deepEqual(metricsDates(NIGHTLY_METRICS_DAYS, now), ["2026-10-14", "2026-10-15"]);
  assert.equal(metricsDates(10_000, now).length, MAX_METRICS_DAYS + 1);
  assert.deepEqual(metricsDates(-5, now), ["2026-10-15"]);
});
