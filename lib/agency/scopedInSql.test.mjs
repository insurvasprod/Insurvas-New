// AG-0.5 performance follow-up (2026-10-19): deal flow, the activity log and the contact directory page a
// narrowed agency scope in SQL (uuid[] parameters, migrations 20261019400000 / 410000 / 420000) instead of
// reading every row the scope's agents produced and paging in code.
//
// What these prove, statically:
//   · the null scope (solo tenants, all-seeing roles) sends exactly the call it always sent — the new argument
//     is added only when a scope is set;
//   · a scoped call never falls back to a path that reads every agent;
//   · the in-code paging is gone;
//   · each migration filters at every agent filter, keeps one signature, and keeps the live grants.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const dealFlow = read("lib/dealFlow/service.ts");
const activity = read("lib/activityLog/service.ts");
const contacts = read("lib/contacts/service.ts");
const alerts = read("lib/agentAlerts/service.ts");
const visibility = read("lib/agency/visibility.ts");
const notifications = read("app/api/app/notifications/route.ts");
const dealSql = read("supabase/migrations/20261019400000_ag_scoped_deal_flow_in_sql.sql");
const activitySql = read("supabase/migrations/20261019410000_ag_scoped_activity_log_in_sql.sql");
const contactSql = read("supabase/migrations/20261019420000_ag_scoped_contact_directory_in_sql.sql");

const count = (text, needle) => text.split(needle).length - 1;

test("deal flow: the null scope sends the old arguments; several agents go as p_agent_ids", () => {
  assert.equal(count(dealFlow, "...(agentIds ? { p_agent_ids: agentIds } : {})"), 2, "report and export add the list only when set");
  assert.match(dealFlow, /if \(scope !== null\) return scopedDealFlow\(tenantId, filters, scope\);\n\s+return dealFlowReport\(tenantId, filters, null\);/);
  assert.match(dealFlow, /: await dealFlowReport\(tenantId, \{ \.\.\.filters, agentId: undefined \}, agents\);/);
  assert.match(dealFlow, /if \(next\.error && agentIds\) throw new Error\(SCOPED_DEAL_FLOW_PENDING\);/, "a scoped list never reaches the legacy every-agent path");
  assert.doesNotMatch(dealFlow, /rowsForAgents|all\.slice\(\(page - 1\) \* pageSize/, "no in-code paging of a scope");
});

test("activity log: one report call with p_agent_user_ids, no per-agent export walks", () => {
  assert.match(activity, /\.\.\.\(agentList \? \{ p_agent_user_ids: agentList \} : \{\}\)/);
  assert.match(activity, /const agentList = agents !== null && agents\.length > 1 \? agents : null;/);
  assert.match(activity, /if \(agentList && .*isMissingSignature.*throw new Error\(SCOPED_ACTIVITY_PENDING\);/);
  assert.doesNotMatch(activity, /scopedMultiAgentReport|agents\.map\(\(agentId\) => activityReport/);
  assert.match(activity, /if \(f\.agents\) query = query\.in\("agent_user_id", f\.agents\);/, "the page boundary for refused dials covers the same agents");
});

test("contacts: the directory, tiles and export ask SQL for the scope", () => {
  assert.match(contacts, /\.\.\.\(scope !== null \? \{ p_scope: scope \} : \{\}\),/);
  assert.match(contacts, /if \(rpc\.error && scope !== null\) throw scopedRpcError\(rpc\.error, "contacts"\);/, "a scoped read never reaches the PostgREST fallback, which reads every contact");
  assert.match(contacts, /rpc\("contact_scope_totals", \{ p_tenant_id: tenantId, p_scope: scope \}\)/);
  assert.match(contacts, /rpc\("contact_scope_ids", \{ p_tenant_id: tenantId, p_scope: scope \}\)/);
  assert.doesNotMatch(contacts, /scopedDirectory|visibleContactLeadCounts|visibleLeadIds\(/);
});

test("alert polling: one queue read per poll for a scoped session, and the scope re-read at most every 30s", () => {
  assert.match(alerts, /const queue = scope === null \? null : await latestQueueRows\(/);
  assert.match(alerts, /const unclaimed = scope === null \? await unclaimedLeadIds\(tenantId, leadIds\) : queue && /, "the null scope keeps its own read, unchanged");
  assert.match(notifications, /scopeFor\(\{ tenantId: session\.tenantId, userId: session\.sub \}, \{ maxAgeMs: ALERT_SCOPE_MAX_AGE_MS \}\)/);
  assert.match(notifications, /const ALERT_SCOPE_MAX_AGE_MS = 30_000;/);
  assert.match(visibility, /if \(maxAge <= 0\) \{\s*\/\/[^\n]*\n\s*const early = requestScope\.get\(context\);\s*if \(early !== undefined\) return [^\n]*\n\s*return visibleProducerUserIds\(context\.tenantId, context\.userId\);/, "every other caller reads the scope fresh (or in its own request's auth round trip)");
  assert.match(visibility, /const requestScope = new WeakMap<object, ProducerScope>\(\);/, "a prefetched scope is held per request context object, never across requests");
});

test("deal-flow migration: one signature each, worked_by filtered by the list, grants as live", () => {
  assert.match(dealSql, /drop function if exists public\.list_deal_flow_report\(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid\);/);
  assert.match(dealSql, /drop function if exists public\.list_deal_flow_export\(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer\);/);
  assert.match(dealSql, /p_focus_lead_id uuid DEFAULT NULL::uuid, p_agent_ids uuid\[\] DEFAULT NULL::uuid\[\]\)/);
  assert.match(dealSql, /p_limit integer DEFAULT 1000, p_agent_ids uuid\[\] DEFAULT NULL::uuid\[\]\)/);
  // report: filtered + pinned; export: keys + filtered
  assert.equal(count(dealSql, "(p_agent_ids is null or b.worked_by = any(p_agent_ids))"), 3);
  assert.equal(count(dealSql, "(p_agent_ids is null or d.worked_by = any(p_agent_ids))"), 1);
  assert.match(dealSql, /revoke all on function public\.list_deal_flow_export\([^)]*\) from public, anon, authenticated, tenant_app;/);
  assert.match(dealSql, /^begin;$[\s\S]*^commit;$/m);
});

test("activity migration: the list sits beside every agent filter", () => {
  assert.equal(count(activitySql, "(p_agent_user_id is null or a.agent_user_id = p_agent_user_id)"), 5);
  assert.equal(count(activitySql, "(p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids))"), 5);
  assert.match(activitySql, /if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;/, "a setter stays pinned to itself");
  assert.match(activitySql, /grant execute on function public\.tenant_activity_report\([^)]*uuid\[\]\) to service_role, tenant_app;/);
});

test("contacts migration: the D1 lead rule in one inlinable function; the null scope keeps the old count", () => {
  const fn = contactSql.slice(contactSql.indexOf("create or replace function public.agency_scope_contact_leads"), contactSql.indexOf("revoke all on function public.agency_scope_contact_leads"));
  assert.doesNotMatch(fn, /security definer|\bset search_path/i, "plain SQL so the planner inlines it");
  assert.match(fn, /left join public\.lead_queue q on q\.lead_id = l\.id and q\.tenant_id = l\.tenant_id/);
  assert.match(fn, /q\.owner_user_id = any \(p_scope\) or \(q\.id is null and l\.created_by = any \(p_scope\)\)/, "queue owner, else creator — visibleLeadIds' rule");
  assert.match(contactSql, /and \(p_scope is null or c\.id in \(select s\.contact_id from scoped s\)\)/);
  assert.match(contactSql, /case when p_scope is null then \(\n\s+with recursive absorbed\(id\) as \(/);
  assert.match(contactSql, /drop function if exists public\.contact_directory_page\(uuid, text, text, text, integer, integer\);/);
});
