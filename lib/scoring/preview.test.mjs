/**
 * Queue scoring, concept board LA-2 §13: "Next up, and why", held-back leads, the 14-day holdout
 * window, live vendor rates and the vendor-score card — pinned.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { heldBackSentence, leadLine, minutesPhrase, normalizePreview, scoreShare, shareLabel } from "./preview.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const preview = read("supabase", "migrations", "20260925701100_scoring_queue_preview.sql");
const since = read("supabase", "migrations", "20260925701000_scoring_cohort_stats_since.sql");

test("the score shows as 0–1: score over the total effective weight", () => {
  assert.equal(scoreShare(86, 100), 0.86);
  assert.equal(shareLabel(scoreShare(60.806, 100)), "0.61");
  // Custom weights that do not sum to 100 still give a 0–1 figure.
  assert.equal(scoreShare(25, 50), 0.5);
  assert.equal(scoreShare(null, 100), null);
  assert.equal(scoreShare(10, 0), null);
  assert.equal(shareLabel(null), "—");
});

test("a held-back lead says why, and when it enters the queue", () => {
  assert.equal(
    heldBackSentence({ reason: "before_open", zone: "America/Los_Angeles", startMinute: 480, localMinute: 432, minutesUntilOpen: 48 }),
    "Not served — 7:12 AM their time, the window opens at 8:00 AM PT. Enters the queue in 48 minutes.",
  );
  assert.equal(minutesPhrase(65), "1 hour 5 minutes");
  assert.match(heldBackSentence({ reason: "after_close", zone: "America/New_York", startMinute: 480, localMinute: 1209, minutesUntilOpen: null }), /closed for today/);
  assert.match(heldBackSentence({ reason: "state_no_sunday", zone: null, startMinute: null, localMinute: null, minutesUntilOpen: null }), /Sunday/);
  assert.equal(leadLine({ name: "Dolores Ruiz", state: "AZ", attemptsMade: 2 }), "Dolores Ruiz · AZ · att 3");
});

test("the RPC's JSON is normalised, and a malformed payload is an empty preview", () => {
  const empty = normalizePreview(null);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.heldBack, []);
  const parsed = normalizePreview({
    enabled: true, ranked: true, holdout_pct: 10, total_weight: "100.0", capacity_gate: true, pool_open: false,
    servable_count: 3, held_back_count: 1,
    rows: [{ position: 1, work_item_id: "w", lead_id: "l", name: "A", state: "AZ", attempts_made: 2, tier: 4, tier_name: "retry", tier_reason: "Due for a retry", assigned_to_you: true, cohort: "scored", score: "61.2", reasons: ["attempt 3 of 7", 5] }],
    held_back: [{ work_item_id: "h", lead_id: "m", reason: "before_open", start_minute: 480, local_minute: 432, minutes_until_open: 48 }],
  });
  assert.equal(parsed.totalWeight, 100);
  assert.equal(parsed.poolOpen, false);
  assert.equal(parsed.rows[0].score, 61.2);
  assert.deepEqual(parsed.rows[0].reasons, ["attempt 3 of 7"]);
  assert.equal(parsed.heldBack[0].minutesUntilOpen, 48);
});

test("the preview is read-only and never records a scoring decision", () => {
  const body = preview.slice(preview.indexOf("as $function$"), preview.indexOf("$function$;"));
  const code = body.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /\binsert\s+into\b/i);
  assert.doesNotMatch(code, /\bupdate\s+\w+\s+(\w+\s+)?set\b/i);
  assert.doesNotMatch(code, /tenant_scoring_decisions/);
  assert.match(preview, /returns jsonb\nlanguage plpgsql\nstable/);
  // Bounded: at most 50 rows, a 50-candidate retrieval like serve_next_lead's, 10 held-back leads.
  assert.match(preview, /least\(greatest\(coalesce\(p_limit, 25\), 1\), 50\)/);
  assert.match(preview, /v_candidate_cap integer := 50/);
  assert.match(preview, /v_held_limit integer := 10/);
});

test("the preview carries every serving gate, the capacity gate behind a guard, and checks its tier CASE", () => {
  for (const gate of [
    "campaigns_servable",
    "is_phone_suppressed(p_tenant_id",
    "tenant_can_dial_now(p_tenant_id",
    "agent_may_work_state(p_tenant_id, p_agent_user_id",
    "lead_state <> 'exhausted'",
    "lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id",
    "hashtextextended(q.lead_id::text, 42)",
  ]) assert.ok(preview.includes(gate), `missing gate: ${gate}`);
  // A static call to a function that may not exist fails at plan time; the helper is looked up.
  assert.match(preview, /to_regprocedure\('public\.agent_can_take_pool_lead\(uuid, uuid\)'\) is not null/);
  assert.match(preview, /execute 'select public\.agent_can_take_pool_lead\(\$1, \$2\)'/);
  // The assertion compares the tier CASE with the LIVE serve_next_lead.
  assert.match(preview, /pg_get_functiondef\('public\.serve_next_lead\(uuid, uuid\)'::regprocedure\)/);
  assert.match(preview, /tier CASE differs from serve_next_lead/);
  // The held-back reason comes from the window explainer.
  assert.match(preview, /tenant_dial_window\(p_tenant_id, k\.raw_state, k\.campaign_id, v_now\)/);
});

test("the 14-day holdout window has an all-time toggle, and falls back when the function is missing", () => {
  assert.match(since, /create or replace function public\.tenant_scoring_cohort_stats_since/);
  assert.match(since, /d\.cohort in \('scored', 'control'\)/);
  const service = read("lib", "scoring", "service.ts");
  assert.match(service, /rpc\("tenant_scoring_cohort_stats_since"/);
  assert.match(service, /SCORING_PERIOD_DAYS = 14/);
  const route = read("app", "api", "app", "scoring", "route.ts");
  assert.match(route, /searchParams\.get\("period"\) === "all" \? "all" : "14d"/);
  const workspace = read("components", "app", "scoring-workspace.tsx");
  assert.match(workspace, /Last 14 days/);
  assert.match(workspace, /All time/);
  // Contacts in the sample line, not only dials.
  assert.match(workspace, /scored\?\.contacted/);
  assert.match(workspace, /control\?\.contacted/);
});

test("live vendor rates are shown only from 30 dials, and the vendor score is not ranked on", () => {
  const service = read("lib", "scoring", "service.ts");
  assert.match(service, /VENDOR_RATE_MIN_ATTEMPTS = 30/);
  assert.match(service, /from\("tenant_contact_rate_stats"\)/);
  assert.match(service, /\.eq\("scope", "vendor"\)/);
  const workspace = read("components", "app", "scoring-workspace.tsx");
  assert.match(workspace, /The vendor&apos;s own score is not used|The vendor's own score is not used/);
  assert.match(workspace, /Rules mode · not learned yet/);
  assert.match(workspace, /% of the score/);
  // Nothing scores on a vendor_score.
  for (const file of ["20260913397000_la_2_13_score_returns_one_row.sql", "20260925701100_scoring_queue_preview.sql"]) {
    assert.doesNotMatch(read("supabase", "migrations", file).replace(/--[^\n]*/g, ""), /vendor_score/);
  }
});

test("the preview route is owner and producer, validates the agent, and is registered", () => {
  const route = read("app", "api", "app", "scoring", "preview", "route.ts");
  assert.match(route, /const SCORING_ROLES = \["owner", "producer"\] as const/);
  assert.match(route, /z\.string\(\)\.uuid\(\)/);
  assert.match(route, /not a dialing member of this agency/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  const policy = read("lib", "entitlements", "agentApiPolicy.ts");
  assert.match(policy, /scoring\/preview\/route\.ts", featureKey: "outbound_dialing", allowedRoles: \["owner", "producer"\]/);
  const workspace = read("components", "app", "scoring-workspace.tsx");
  assert.match(workspace, /Preview the queue/);
  assert.match(workspace, /The order within a tier can differ from Serve next/);
});
