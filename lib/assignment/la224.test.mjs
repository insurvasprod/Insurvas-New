import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sql = read("supabase/migrations/20260913490000_la_2_24_lead_assignment_rules.sql");
// assign_lead was restated on 2026-09-24 (the Lead assignment board). The tables, the capacity
// trigger, the inactive-user return and return_lead_to_assignment_pool still live only in the
// original file, so those assertions stay on it; everything about the ROUTER reads the migration
// that defines it now — the same reason `eligibility` below does not read 20260913490000.
// Restated again on 2026-09-25 (the concept audit: strategy, AND-conditions, licence fall-through,
// routing on arrival). The board file still holds the preview and the rotation, which that
// restatement only calls.
const board = read("supabase/migrations/20260924300000_lead_assignment_board.sql");
const router = read("supabase/migrations/20260925702100_assignment_router_strategy_conditions_auto_route.sql");
// The eligibility rule moved on 2026-09-23 and was restated on 2026-09-25 (personal licence
// expiry). The original file still contains the `can_write` version, so asserting against it alone
// would keep passing while the live database did something else entirely — a guard reading a
// superseded migration is a guard reading fiction.
const eligibility = read("supabase/migrations/20260925702000_agent_licence_expiry.sql");
const lapse = read("supabase/migrations/20260925702200_return_leads_when_a_licence_lapses.sql");
const route = read("app/api/app/assignments/route.ts");

test("LA-2.24 stores configurable rules and agent capacity", () => {
  assert.match(sql, /create table if not exists public\.assignment_rules/);
  assert.match(sql, /priority integer/);
  assert.match(sql, /match_type text.*campaign.*state.*language.*product.*fallback/s);
  assert.match(sql, /create table if not exists public\.agent_capacity/);
  assert.match(sql, /max_open_leads integer/);
  assert.match(sql, /current_open integer/);
});

test("full agents are skipped and eligibility is still consulted", () => {
  assert.match(router, /if v_open >= v_capacity\.max_open_leads then continue/);
  assert.match(router, /assignment_candidate_is_eligible/);
  assert.doesNotMatch(router, /create or replace function public\.assignment_candidate_is_eligible/, "eligibility is owned by Settings › States & licences; the router calls it and must not redefine it");
});

test("eligibility reads the appointments this product actually keeps", () => {
  // It read `agent_carrier_contracts` and `agent_appointments` — the organization-era tables, empty
  // in every database — so no owner or producer could ever be assigned a lead. The tables the
  // Carrier appointments screen writes are `appointments` and `licenses`.
  assert.match(eligibility, /from public\.licenses l/, "the licence half of 'licensed and appointed' is gone");
  assert.match(eligibility, /from public\.appointments a/, "the appointment half is gone");
  assert.match(
    eligibility,
    /join public\.tenant_carriers tc/,
    "an appointment with a switched-off carrier is history, not permission — the carrier join is gone",
  );
  assert.doesNotMatch(
    eligibility,
    /from public\.agent_carrier_contracts|from public\.agent_appointments/,
    "eligibility is reading the empty organization-era tables again",
  );
});

test("the gate still refuses, and says why", () => {
  // Widening a compliance check until it always passes is not a fix. Each of these is a refusal
  // that has to survive.
  assert.match(eligibility, /if v_state = '' then return false/, "a lead with no state became assignable");
  assert.match(eligibility, /p_requires_licensed and p_role = 'setter'/, "a setter can be given a lead that needs a licence");
  assert.match(eligibility, /expires_at is null or l\.expires_at >= current_date/, "an expired licence is being accepted");
  assert.match(eligibility, /a\.status = 'active'/, "a terminated appointment is being accepted");

  // And the refusal has to be legible. `ASSIGNMENT_TARGET_NOT_ELIGIBLE` reached the screen verbatim,
  // covering four situations with four different remedies.
  assert.match(eligibility, /create or replace function public\.assignment_ineligibility_reason/);
});

test("the API turns an ineligibility code into a sentence", () => {
  const service = read("lib/assignment/service.ts");
  assert.match(service, /ASSIGNMENT_TARGET_NOT_ELIGIBLE/, "the refusal is no longer detected");
  assert.match(service, /assignment_ineligibility_reason/, "the refusal is no longer explained");
});

test("rule order is deterministic and stops at the first match", () => {
  assert.match(router, /order by r\.priority, r\.id/);
  // Stops at the first matching rule THAT HAS AN ELIGIBLE CANDIDATE (fall-through, decision 1).
  assert.match(router, /v_selected_rule := v_rule;[\s\S]*?exit;/);
  assert.match(router, /for v_rule_index in 1 \.\. cardinality\(v_rules\) loop/, "fall-through to the next matching rule is gone");
});

test("assign next skips ahead, and the rotation never hands a lead back to its owner", () => {
  assert.match(router, /if p_work_item_id is null and p_target_user_id is null then v_max_items := 25; end if;/);
  assert.match(router, /for update skip locked/);
  assert.match(router, /p_rotate_from_user_id is null or tu\.user_id <> p_rotate_from_user_id/);
  // Rotation is a scheduled job. A trigger on tenant_call_attempts would put it in the dialer's path.
  assert.doesNotMatch(router, /create trigger[^;]*on public\.tenant_call_attempts/i);
  assert.doesNotMatch(board, /create trigger[^;]*on public\.tenant_call_attempts/i);
  // The Vercel cron schedule was removed on 2026-09-25 (vercel.json is now empty); the job is an
  // HTTP endpoint any scheduler can call, so the guard is that the endpoint still exists.
  assert.ok(existsSync(new URL("app/api/cron/assignment-rotation/route.ts", root)), "the rotation job has no endpoint");
});

test("manual reassignment honours rest days and one agent per household", () => {
  assert.match(router, /ASSIGNMENT_TARGET_RESTING/);
  assert.match(router, /ASSIGNMENT_HOUSEHOLD_OWNED/);
  // A language rule, or a rule with a language condition, pairs the lead with a speaker.
  assert.match(router, /if v_pairs_language and not exists/, "language pairing no longer reads the lead's language");
  assert.match(router, /coalesce\(\(p_rule\)\.match_type = 'language', false\)/, "a language rule no longer pairs");
});

test("the routing preview always rolls back and is manager-only", () => {
  assert.match(board, /raise exception using errcode = 'P0001', message = 'assignment_preview_rollback'/);
  assert.match(board, /if v_actor_role not in \('owner', 'producer'\) then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'/);
});

test("every existing caller keeps the six-argument router, with the system route off", () => {
  assert.match(router, /return public\.assign_lead_core\(p_tenant_id, p_actor_user_id, p_work_item_id, p_target_user_id, p_reason, p_rotate_from_user_id, false\);/);
  // Only the owner may run the seven-argument form: nothing can reach the system route directly.
  assert.match(router, /revoke all on function public\.assign_lead_core\(uuid, uuid, uuid, uuid, text, uuid, boolean\)\s+from public, anon, authenticated, tenant_app, service_role;/);
});

test("routing on arrival: off by default, real-time rules only, and the gate is asked twice", () => {
  assert.match(router, /auto_route_posted boolean not null default false/);
  assert.match(router, /\(not v_system or r\.match_type = 'realtime'\)/, "the system route can reach the rest of the chain");
  assert.match(router, /if not v_has_fallback and not v_system then/, "the system route falls back to the whole roster");
  assert.match(router, /if not coalesce\(v_on, false\) then return jsonb_build_object\('routed', false, 'reason', 'off'\)/);
  assert.match(router, /ASSIGNMENT_AUTO_ROUTE_GATE_REFUSED/, "the owner the router picked is not re-checked against the gate");
  assert.match(router, /'tenant\.lead_auto_routed'/);
  assert.match(router, /'tenant\.lead_auto_route_skipped'/);
  const post = read("lib/leadPost/service.ts");
  assert.match(post, /await autoRoutePostedLead\(keyRow\.tenant_id, created\.id\)/, "the lead-post path no longer offers posted leads to the router");
  assert.match(read("lib/assignment/autoRoute.ts"), /Never throws/);
});

test("strategy, AND-conditions and the pinned fallback", () => {
  assert.match(router, /check \(strategy in \('round_robin', 'least_loaded'\)\)/);
  assert.match(router, /case when v_least_loaded then coalesce\(c\.current_open, 0\) else 0 end/, "fewest open first is not ordered by open leads");
  assert.match(router, /jsonb_array_length\(conditions\) <= 2/, "a rule can carry more than three conditions");
  assert.match(router, /order by \(x\.value->>'match_type' = 'fallback'\), x\.ord/, "the published fallback is not pinned last");
  // Capacity is still the ceiling under every strategy.
  assert.match(router, /if v_open >= v_capacity\.max_open_leads then continue; end if;/);
});

test("a rule the licence gate refuses entirely is logged once, as a licence skip", () => {
  assert.match(router, /check \(reason in \('capacity', 'rest', 'household', 'day_off', 'licence'\)\)/);
  assert.match(router, /v_rule_candidates > 0 and v_rule_licence = v_rule_candidates/);
  assert.match(router, /check \(user_id is not null or reason = 'licence'\)/);
});

test("a lapsed personal licence is not held, by the router or the dialer", () => {
  assert.match(eligibility, /add column if not exists expires_on date/);
  // Twice in the eligibility pair and once in agent_may_work_state.
  assert.ok((eligibility.match(/s\.expires_on is null or s\.expires_on >= current_date/g) ?? []).length >= 3, "an expired personal state still counts somewhere");
  assert.match(eligibility, /create or replace function public\.agent_may_work_state/);
  // "Any states recorded?" still counts lapsed rows: a lapse must never widen reach to the agency's.
  assert.match(eligibility, /not exists \(select 1 from public\.tenant_user_licensed_states s where s\.tenant_id = p_tenant_id and s\.user_id = p_user_id\)\n/);
  // A states-only save keeps the expiry of a state that stays.
  assert.match(eligibility, /on conflict \(tenant_id, user_id, state\) do nothing/);
});

test("leads in a lapsed state go back to the pool with the rotation job's guards", () => {
  assert.match(lapse, /from public\.active_calls ac/);
  assert.match(lapse, /op\.disposition is null and op\.attempted_at > now\(\) - interval '2 hours'/);
  assert.match(lapse, /cb\.status in \('scheduled', 'due'\)/);
  assert.match(lapse, /q\.status = 'claimed' and q\.disposition is null/);
  assert.match(lapse, /if public\.assignment_candidate_is_eligible\(/, "the lapse job returns leads without asking the gate");
  assert.doesNotMatch(lapse, /create trigger/i);
  assert.ok(existsSync(new URL("app/api/cron/licence-lapse/route.ts", root)), "the licence lapse job has no endpoint");
});

test("sticky ownership, inactive return, pool return and reasons are persisted", () => {
  assert.match(router, /v_item\.disposition is null and p_target_user_id is null/);
  assert.match(sql, /users_return_inactive_assignments/);
  assert.match(sql, /return_lead_to_assignment_pool/);
  assert.match(sql, /lead_assignment_events/);
  assert.match(router, /REASSIGNMENT_REASON_REQUIRED/);
  assert.match(router, /rest_days/);
});

test("rules and next assignments are mutable through the authenticated API", () => {
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function POST/);
  assert.match(route, /saveAssignmentRule/);
  assert.match(route, /assignLead/);
  assert.match(route, /const managers = \["owner", "producer"\]/);
  assert.match(route, /export async function PATCH/);
});

test("manual cross-owner mutations stay manager-only and capacity stays tenant-scoped", () => {
  assert.match(router, /ASSIGNMENT_MANAGER_REQUIRED/);
  assert.match(sql, /v_item\.owner_user_id <> p_actor_user_id and v_actor_role not in \('owner', 'producer'\)/);
  assert.match(read("lib/assignment/service.ts"), /Capacity user is not a member of this tenant/);
  const workspace = read("components/app/assignment-workspace.tsx");
  assert.match(workspace, /Reassign work item/);
  assert.match(workspace, /targetUserId: reassignTargetUserId/);
});
