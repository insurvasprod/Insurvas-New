// AG-0.10 follow-up (2026-10-19) · Serve next in an agency is serve_next_lead, and a refused assigned lead stays
// assigned. node --test (from PowerShell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assignedTo, keptAssignedReason, refusedLeadHandBack } from "./refusedLead.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const service = read("lib/dialerScripts/service.ts");
const route = read("app/api/app/dialer/next/route.ts");
const migration = read("supabase/migrations/20261019300000_ag_serve_next_own_leads_without_the_pool.sql");

const fn = (source, start) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${start} not found`);
  const next = source.indexOf("\nexport ", from + start.length);
  const nextLocal = source.indexOf("\nasync function ", from + start.length);
  const ends = [next, nextLocal].filter((index) => index > 0);
  return source.slice(from, ends.length ? Math.min(...ends) : undefined);
};
const sqlFn = (name) => {
  const from = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(from >= 0, `${name} not in the migration`);
  return migration.slice(from, migration.indexOf("$function$;", from));
};

// ── 1. Serve next ───────────────────────────────────────────────────────────────────────────────────

test("every session, agency producer included, is served by serve_next_lead — the tier-order workaround is gone", () => {
  const serve = fn(service, "export async function serveNextLead");
  assert.match(serve, /serveNextLead\(input: \{ tenantId: string; agentId: string \}\)/, "serveNextLead takes no scope");
  assert.match(serve, /db\.rpc\("serve_next_lead"/);
  assert.doesNotMatch(service, /serveNextAssignedLead/, "the app-side assigned-lead serve is removed");
  assert.doesNotMatch(serve, /getQueuePreview|serveLeadById/, "Serve next does not walk the queue preview");
  // The TypeScript licence re-check still applies to every served lead, agency or solo.
  assert.match(serve, /licenceFor\(licence, state\)/);
});

test("the route sends agency sessions through serve_next_lead and explains their empty queue from their own work", () => {
  assert.match(route, /serveNextLead\(\{\s*tenantId: auth\.context\.tenantId,\s*agentId: auth\.context\.userId,\s*\}\)/);
  assert.doesNotMatch(route, /serveNextLead\(\{[^}]*scope/, "no scope is passed to the serve");
  // Scope from the session (AG-0.5 rule 9), used only for the empty-queue wording.
  assert.match(route, /const scope = await scopeFor\(auth\.context\)/);
  assert.match(route, /scope \? \(await diagnoseAssignedQueue\(auth\.context\.tenantId, auth\.context\.userId\)/);
  assert.match(route, /atCapacity: scope \? null : atCapacity \?\? null/, "a scoped session is never told the ceiling closed the pool");
});

test("in the database the pool is closed to a narrowed agency session, so the draw and the score run over his own leads", () => {
  // 20261019100000: the gate serve_next_lead reads.
  const gate = read("supabase/migrations/20261019100000_ag_followups_setters_pool_wording.sql");
  assert.match(gate, /= 'agency'\s+and public\.agency_visible_user_ids\(p_tenant_id, p_user_id\) is not null then false/);
  // 20261019300000 asserts serve_next_lead still feeds that gate to serve_eligible_ids, whose pool branch needs it.
  assert.match(migration, /v_pool_ok := agent_can_take_pool_lead\(p_tenant_id, p_agent_user_id\);/);
  assert.match(migration, /and p_pool_ok\)%/);
});

test("without the pool, serve_top and serve_tier_candidates read only the agent's own set — no pool scan", () => {
  const top = sqlFn("serve_top");
  // The small sets (whose first branch is every lead claimed by and owned by this agent) are always read.
  assert.match(top, /v_small uuid\[\] := public\.serve_small_qids\(p_tenant_id, p_agent_user_id, p_now\);/);
  assert.match(top, /v_zoned uuid\[\] := case when p_pool_ok then public\.serve_zoned_qids\(p_tenant_id\) else '\{\}'::uuid\[\] end;/);
  assert.match(top, /v_due := case when p_pool_ok then public\.serve_due_qids\(p_tenant_id, p_now\) else '\{\}'::uuid\[\] end;/);
  // Every fresh-pool probe sits inside `if p_pool_ok then … end if; -- p_pool_ok`.
  const open = top.indexOf("  if p_pool_ok then -- [AG 20261019300000]\n");
  const close = top.indexOf("end if; -- p_pool_ok");
  assert.ok(open > 0 && close > open);
  for (const probe of ["serve_open_states", "serve_fresh_page", "serve_fresh_scan"]) {
    const at = [...top.matchAll(new RegExp(`public\\.${probe}\\(`, "g"))].map((m) => m.index);
    assert.ok(at.length > 0, probe);
    for (const index of at) assert.ok(index > open && index < close, `${probe} is read only with the pool open`);
  }
  // Own tier-5 leads are still offered before the probes, from v_rows.
  assert.ok(top.indexOf("where (r->>'p')::integer = 5") < open);

  const candidates = sqlFn("serve_tier_candidates");
  assert.match(candidates, /v_keep := public\.serve_small_qids\(p_tenant_id, p_agent_user_id, p_now\);\n[\s\S]*if not coalesce\(p_pool_ok, false\) then\n\s+null; -- \[AG 20261019300000\]\n\s+elsif p_tier in \(4, 6\) then/);
});

test("the migration changes nothing else: built from the live bodies, every edit marked", () => {
  assert.doesNotMatch(migration, /\r/, "LF endings");
  const marked = migration.split("\n").filter((line) => line.includes("[AG 20261019300000]")).length;
  assert.equal(marked, 8, "the header line + 7 marked edits (3 comments, due, if, end if, null)");
  assert.doesNotMatch(migration, /create or replace function public\.serve_next_lead/i, "serve_next_lead itself is not rewritten");
  assert.doesNotMatch(migration, /\b(grant|revoke)\b/i, "grants are kept by create or replace");
  // Solo: with p_pool_ok true every branch reads what it read before.
  assert.match(sqlFn("serve_tier_candidates"), /elsif p_tier in \(4, 6\) then\n\s+v_keep := public\.serve_due_qids\(p_tenant_id, p_now\) \|\| v_keep;\n\s+elsif p_tier = 5 then/);
});

// ── 2. A refused assigned lead ──────────────────────────────────────────────────────────────────────

test("an agency lead assigned to the producer stays his; a pool lead and every solo lead go back to the pool", () => {
  assert.equal(refusedLeadHandBack({ agency: true, assignedToAgent: true }), "keep_assigned");
  assert.equal(refusedLeadHandBack({ agency: true, assignedToAgent: false }), "return_to_pool");
  assert.equal(refusedLeadHandBack({ agency: false, assignedToAgent: true }), "return_to_pool", "solo behaviour unchanged");
  assert.equal(refusedLeadHandBack({ agency: false, assignedToAgent: false }), "return_to_pool");
});

test("assigned means the latest assignment event names him, the rule lead_queue_assignee reads", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  assert.equal(assignedTo({ event_type: "assigned", to_user_id: me }, me), true);
  assert.equal(assignedTo({ event_type: "pulled", to_user_id: me }, me), true);
  assert.equal(assignedTo({ event_type: "reassigned", to_user_id: me }, me), true);
  assert.equal(assignedTo({ event_type: "assigned", to_user_id: "someone-else" }, me), false);
  assert.equal(assignedTo({ event_type: "returned_to_pool", to_user_id: null }, me), false);
  assert.equal(assignedTo({ event_type: "auto_returned", to_user_id: me }, me), false);
  assert.equal(assignedTo(null, me), false);
});

test("the reason says why, fits the 500-character column, and never stores an empty line", () => {
  assert.equal(
    keptAssignedReason("You are not licensed in TX."),
    "Kept assigned after the dialer passed over it: You are not licensed in TX. The owner can reassign it to a licensed producer.",
  );
  assert.match(keptAssignedReason("No licence on file for TX"), /for TX\. The owner/);
  assert.match(keptAssignedReason(""), /the licence check could not be read\./);
  assert.match(keptAssignedReason(undefined), /the licence check could not be read\./);
  const long = keptAssignedReason("x".repeat(900));
  assert.ok(long.length <= 500 && long.trim().length >= 1);
});

test("returnRefusedLead keeps the owner, unlocks, and records the reason as a reassignment to himself", () => {
  const body = fn(service, "async function returnRefusedLead");
  // Solo and pool leads: the hand-back it always made, byte for byte.
  assert.match(body, /\{ status: "unclaimed", claimed_by: null, owner_user_id: null, locked_until: null, updated_at: now \}/);
  // Agency + assigned: owner, claimed_by and status untouched; only the lock is lifted.
  assert.match(body, /handBack === "keep_assigned"\s*\/\/[^\n]*\n\s*\? \{ locked_until: null, updated_at: now \}/);
  // The agency question and the history read are asked only in an agency: a solo tenant makes no new read.
  assert.match(body, /const agency = await isAgencyTenant\(tenantId\)\.catch\(\(\) => false\);/);
  assert.match(body, /const latest = agency\s*\?\s*await db\.from\("lead_assignment_events"\)/);
  // The why, written only when the row really was put back.
  assert.match(body, /handBack === "keep_assigned" && !released\.error && \(\(released\.data as Row\[\] \| null\) \?\? \[\]\)\.length > 0/);
  assert.match(body, /from_user_id: agentId,\s*to_user_id: agentId,\s*event_type: "reassigned",\s*reason: keptAssignedReason\(why\),/);
  // The refusal's own sentence is what is recorded, from both the serve and the pick.
  assert.match(service, /returnRefusedLead\(db, input\.tenantId, input\.agentId, item\.row, item\.message\)/);
  assert.match(service, /returnRefusedLead\(db, input\.tenantId, input\.agentId, row, decision\.message\)/);
});
