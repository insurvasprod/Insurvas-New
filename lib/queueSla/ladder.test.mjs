// Run with: npm test
//
// Settings › Queue & SLA. The board's rung behaviours — "sorts to the top", "offered more widely",
// "their pipeline row says nobody claimed it", "becomes a nurture lead" — and its duration fields,
// stepper and save messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { formatDuration, ladderStepStates, parseDuration } from "./ladder.ts";
import { NOBODY_CLAIMED_LABEL, nobodyClaimed } from "../partnerLeads/lanes.ts";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const MIGRATIONS = join(root, "supabase", "migrations");
const files = readdirSync(MIGRATIONS).sort();
function latestDefining(pattern) {
  for (let index = files.length - 1; index >= 0; index--) {
    const body = readFileSync(join(MIGRATIONS, files[index]), "utf8");
    if (pattern.test(body)) return { name: files[index], body };
  }
  return null;
}

const LADDER = { warn: 45, escalate: 120, partner: 300, expire: 14400 };

test("a rung is typed the way the board writes it", () => {
  assert.equal(parseDuration("45 seconds"), 45);
  assert.equal(parseDuration("45s"), 45);
  assert.equal(parseDuration("2 minutes"), 120);
  assert.equal(parseDuration("2m"), 120);
  assert.equal(parseDuration("4 hours"), 14400);
  assert.equal(parseDuration("1 day"), 86400);
  assert.equal(parseDuration("90"), 90);
  assert.equal(parseDuration("soon"), null);
  assert.equal(parseDuration("0 seconds"), null);
  assert.equal(parseDuration("3 fortnights"), null);
});

test("and written back in the board's own form", () => {
  assert.equal(formatDuration(45), "45 seconds");
  assert.equal(formatDuration(120), "120 seconds");
  assert.equal(formatDuration(300), "300 seconds");
  assert.equal(formatDuration(14400), "4 hours");
  assert.equal(formatDuration(86400), "1 day");
  assert.equal(formatDuration(1), "1 second");
});

test("the stepper marks the rungs the longest-waiting transfer has passed, and the next one", () => {
  // The board's picture: waited past warn, not yet escalated.
  assert.deepEqual(ladderStepStates(LADDER, 90), ["done", "done", "current", "upcoming", "upcoming"]);
  assert.deepEqual(ladderStepStates(LADDER, 10), ["done", "current", "upcoming", "upcoming", "upcoming"]);
  // Nothing waiting: nothing is done, and "Claimable" is where a transfer would start.
  assert.deepEqual(ladderStepStates(LADDER, null), ["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
});

test("the partner's row says nobody claimed it once the ladder told them, while it stays unclaimed", () => {
  assert.equal(NOBODY_CLAIMED_LABEL, "Nobody claimed it");
  assert.equal(nobodyClaimed({ status: "unclaimed", slaPartnerNotifiedAt: "2026-09-24T10:00:00Z" }), true);
  assert.equal(nobodyClaimed({ status: "expired", slaPartnerNotifiedAt: "2026-09-24T10:00:00Z" }), true);
  assert.equal(nobodyClaimed({ status: "claimed", slaPartnerNotifiedAt: "2026-09-24T10:00:00Z" }), false);
  assert.equal(nobodyClaimed({ status: "unclaimed", slaPartnerNotifiedAt: null }), false);
  const service = read("lib", "partnerLeads", "service.ts");
  assert.match(service, /not\("sla_partner_notified_at", "is", null\)/);
  assert.ok((service.match(/NOBODY_CLAIMED_LABEL/g) ?? []).length >= 3, "both the list and the detail must carry the label");
});

test("warned rows sort to the top because the inbox lists the longest-waiting first", () => {
  const inbox = latestDefining(/create or replace function public\.list_transfer_inbox\(/);
  assert.ok(inbox);
  // Age is what triggers the warning, so oldest-first puts every warned row above every unwarned one.
  assert.match(inbox.body, /order by newest\.queued_at asc|order by q\.queued_at asc/);
});

test("escalation offers the lead to everyone who can claim it; expiry makes it a nurture lead", () => {
  const service = read("lib", "queueSla", "service.ts");
  assert.match(service, /roles: \["owner", "producer", "assistant"\]/);
  assert.match(service, /sourceKey: `unclaimed-sla:\$\{event\.work_item_id\}:offered`/);
  assert.match(service, /rpc\("nurture_expired_transfer"/);

  const nurture = latestDefining(/create or replace function public\.nurture_expired_transfer/);
  assert.ok(nurture, "nothing turns an expired transfer into a nurture lead");
  assert.match(nurture.body, /lead_state = 'nurture', next_dial_after = now\(\)/);
  // The dialer work item has no partner, so the inbox and the ladder never see it again.
  assert.match(nurture.body, /\(tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier, nurtured_from_work_item_id\)/);
  // The ladder's own function belongs to other work and is not redefined here.
  assert.doesNotMatch(nurture.body, /create or replace function public\.run_unclaimed_sla/);
  assert.doesNotMatch(nurture.body, /create or replace function public\.list_transfer_inbox/);

  const reopen = latestDefining(/create or replace function public\.reopen_expired_lead/);
  assert.match(reopen.body, /LEAD_BEING_DIALLED/);
  assert.match(reopen.body, /set status = 'closed'/);
});

test("the route names the actual problem, and the screen re-reads after a save", () => {
  const route = read("app", "api", "app", "queue-sla-settings", "route.ts");
  assert.match(route, /Each rung has to fire within 7 days/);
  assert.match(route, /oldestWaitingSeconds/);
  const screen = read("components", "app", "queue-sla-settings.tsx");
  assert.match(screen, /notify\.done\("Queue SLA settings saved"\);\s*\n\s*\/\/[^\n]*\n\s*await load\(\);/);
  assert.match(screen, /The row turns amber and sorts to the top/);
  assert.match(screen, /An alert, and the lead is offered more widely/);
  assert.match(screen, /Their pipeline row says nobody claimed it/);
});
