// Run with: npm test
//
// Campaigns concept audit (LA-2 §5): "Run the scrub" re-screens every lead in a campaign, owner only,
// chunked and resumable, and never marks a campaign scrubbed by assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABEL,
  SCRUB_LABEL,
  campaignServes,
  hasNoWorkableLeads,
  ledgerOutcome,
  scrubOutcomeAction,
  scrubRunIsStale,
  workedPercent,
} from "./constants.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("every status and scrub state the database holds has a label", () => {
  for (const status of CAMPAIGN_STATUSES) assert.ok(CAMPAIGN_STATUS_LABEL[status], status);
  assert.deepEqual(Object.keys(SCRUB_LABEL).sort(), ["failed", "scrubbed", "scrubbing", "unscrubbed"]);
  const constraint = read("supabase", "migrations", "20260913290000_la_2_3_suppression_hard_gate.sql");
  assert.match(constraint, /scrub_status in \('unscrubbed', 'scrubbing', 'scrubbed', 'failed'\)/);
});

test("a campaign serves only when active and scrubbed", () => {
  assert.equal(campaignServes("active", "scrubbed"), true);
  assert.equal(campaignServes("active", "unscrubbed"), false);
  assert.equal(campaignServes("paused", "scrubbed"), false);
});

test("screening outcomes: hits are suppressed, invalid is rejected, an outage stops the run", () => {
  assert.equal(scrubOutcomeAction("tcpa_litigator"), "suppress");
  assert.equal(scrubOutcomeAction("dnc"), "suppress");
  assert.equal(scrubOutcomeAction("invalid_phone"), "reject");
  assert.equal(scrubOutcomeAction("unavailable"), "outage");
  assert.equal(scrubOutcomeAction("internal_dq"), "clear");
  assert.equal(scrubOutcomeAction("clear"), "clear");
  assert.equal(ledgerOutcome("invalid_phone"), "invalid");
});

test("a run is stale after 15 minutes without progress", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(scrubRunIsStale({ status: "running", last_progress_at: "2026-09-25T11:44:00Z" }, now), true);
  assert.equal(scrubRunIsStale({ status: "running", last_progress_at: "2026-09-25T11:50:00Z" }, now), false);
  assert.equal(scrubRunIsStale({ status: "failed", last_progress_at: "2026-09-25T10:00:00Z" }, now), false);
});

test("worked and the no-workable hint", () => {
  assert.equal(workedPercent({ leads_received: 4820, leads_dialed: 1832 }), 38);
  assert.equal(workedPercent({ leads_received: 0, leads_dialed: 0 }), null);
  assert.equal(hasNoWorkableLeads({ leads_received: 10, leads_workable: 0 }), true);
  assert.equal(hasNoWorkableLeads({ leads_received: 0, leads_workable: 0 }), false);
});

test("the route is owner-only and registered as a money route with an owner-only policy", () => {
  const route = read("app", "api", "app", "campaigns", "[id]", "scrub", "route.ts");
  assert.match(route, /const roles = \["owner"\] as const;/);
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(policy, /app\/api\/app\/campaigns\/\[id\]\/scrub\/route\.ts", featureKey: "outbound_dialing", allowedRoles: \["owner"\]/);
  const actions = read("lib", "audit", "actions.ts");
  assert.match(actions, /"tenant\.campaign_scrub_started":/);
  assert.match(actions, /"tenant\.campaign_scrub_finished":/);
});

test("never a plain mark scrubbed: only a finished run writes scrubbed", () => {
  const sql = read("supabase", "migrations", "20260925706100_campaign_scrub_runs.sql");
  assert.match(sql, /SCRUB_RUN_IN_PROGRESS/);
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /SCRUB_RUN_LEASE_LOST/);
  const patch = read("app", "api", "app", "campaigns", "[id]", "route.ts");
  assert.doesNotMatch(patch.slice(patch.indexOf("const statusSchema"), patch.indexOf("}).strict()")), /scrub_status/);
  const service = read("lib", "campaigns", "scrubRun.ts");
  // Hits go to the ledger AND the suppression list; the cursor moves only after both.
  assert.ok(service.indexOf('rpc("record_campaign_scrub_rejections"') < service.indexOf('rpc("suppress_phone"'));
  assert.ok(service.indexOf('rpc("suppress_phone"') < service.lastIndexOf("cursor: leads[settled - 1].id"));
});
