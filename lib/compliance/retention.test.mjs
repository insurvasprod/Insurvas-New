// LA-6.6 (Notion sprint, Module 6 — Compliance) · the retention policy engine and the purge.
// Run with: node --experimental-strip-types --test lib/compliance/retention.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describeDays, resolveRule, RECORD_TYPE_KEYS, AUTOMATIC_REASONS, NOT_LEGAL_ADVICE } from "./retention.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015150000_la_6_6_retention.sql";
const T = "t1";
const rule = (tenantId, recordType, state, retainDays, action = "purge") => ({ id: `${tenantId}-${recordType}-${state}`, tenantId, recordType, state, retainDays, action, basis: "our_policy", notes: null, setAt: "" });

test("four-level resolution: tenant + state, tenant + all, platform + state, platform default", () => {
  const rules = [rule(null, "call_attempt_logs", null, 1461), rule(null, "call_attempt_logs", "CA", 2000), rule(T, "call_attempt_logs", null, 1800), rule(T, "call_attempt_logs", "TX", 3650)];
  assert.equal(resolveRule(rules, T, "call_attempt_logs", "TX").retainDays, 3650);
  assert.equal(resolveRule(rules, T, "call_attempt_logs", "FL").retainDays, 1800);
  assert.equal(resolveRule(rules.filter((r) => r.tenantId === null), T, "call_attempt_logs", "CA").retainDays, 2000);
  assert.equal(resolveRule(rules.filter((r) => r.tenantId === null), T, "call_attempt_logs", "FL").retainDays, 1461);
  assert.equal(resolveRule([], T, "call_attempt_logs", "TX"), null, "no match means no purge");
  const sql = read(MIGRATION);
  assert.match(sql, /order by \(r\.tenant_id is null\), \(r\.state is null\), r\.effective_from desc/);
  assert.match(sql, /v_unruled := v_unruled \|\| v_type;\n\s+continue;/);
});

test("every record type ships a default with its basis; the defaults are a starting point, not legal advice", () => {
  const sql = read(MIGRATION);
  for (const t of RECORD_TYPE_KEYS) assert.match(sql, new RegExp(`\\(null, '${t}', null, (\\d+|null), '(purge|anonymise|never_delete)', 'our_policy'`), t);
  assert.match(sql, /constraint retention_rule_basis check \(basis in \('statute', 'carrier_requirement', 'our_policy', 'legal_advice'\)\)/);
  assert.match(NOT_LEGAL_ADVICE, /not legal advice/);
  assert.equal(describeDays(1461), "1,461 days (about 4 years)");
  assert.equal(describeDays(null), "Forever");
});

test("do-not-call entries are never purged: stated in the table, refused by a constraint, and never touched by the engine", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /constraint retention_rule_dnc check \(record_type <> 'internal_dnc' or action = 'never_delete'\)/);
  const engine = sql.slice(sql.indexOf("create or replace function public.retention_execute"), sql.indexOf("revoke all on function public.retention_execute"));
  assert.doesNotMatch(engine, /tenant_do_not_call t|delete from public\.tenant_do_not_call|update public\.tenant_do_not_call|tenant_suppression_list/);
  assert.match(engine, /'record_type', 'internal_dnc', 'table', 'tenant_do_not_call', 'rows_matched', 0, 'rows_held', 0, 'rows_purged', 0, 'note', 'Never deleted\.'/);
  assert.match(sql, /a rule was allowed to purge the do-not-call list/);
});

test("a hold beats the schedule, for every hold source; it is reported apart from what was purged", () => {
  const sql = read(MIGRATION);
  const engine = sql.slice(sql.indexOf("create or replace function public.retention_execute"), sql.indexOf("revoke all on function public.retention_execute"));
  const deletes = [...engine.matchAll(/with (?:d|u) as \((?:delete from|update) public\.(\w+)[\s\S]*?returning 1\)/g)];
  assert.ok(deletes.length >= 7);
  for (const d of deletes) assert.match(d[0], /not x\.held|not public\.legal_hold_active\(/, `${d[1]} skips held rows`);
  assert.match(sql, /'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new/);
  // Automatic holds: an open complaint and a commission dispute.
  assert.match(sql, /create trigger legal_hold_on_complaint after insert on public\.complaint/);
  assert.match(sql, /create trigger legal_hold_on_dispute after insert on public\.commission_dispute/);
  assert.deepEqual([...AUTOMATIC_REASONS], ["complaint", "commission_dispute"]);
  // And a deletion request waits for a hold too (LA-6.5).
  assert.match(read("supabase/migrations/20261015140000_la_6_5_consumer_deletion.sql"), /this person''s records are under a legal hold; the deletion waits until it is released/);
});

test("an automatic hold is released only by a person, and not while its source is open", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /the complaint is still open; close it to release the hold/);
  assert.match(sql, /the commission dispute is still open; close it to release the hold/);
  assert.match(sql, /revoke delete, truncate on public\.legal_hold from service_role;/);
  assert.match(read("lib/compliance/retentionStore.ts"), /Complaint and dispute holds are placed by their source/);
});

test("a dry run before every live run", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /if not exists \(select 1 from public\.retention_run r where r\.tenant_id = p_tenant_id and r\.mode = 'dry_run' and r\.finished_at >= now\(\) - make_interval\(days => v_window\)\) then/);
  assert.match(sql, /a live run ran without a dry run/);
  assert.match(read("app/api/app/compliance/retention/runs/route.ts"), /if \(parsed\.data\.mode === "live" && parsed\.data\.confirm !== true\)/);
  // Scheduled: off until the tenant turns it on; a dry run first, the live run after the window.
  assert.match(sql, /add column if not exists purge_schedule_enabled boolean not null default false/);
  assert.match(sql, /for s in select \* from public\.compliance_settings where purge_schedule_enabled loop/);
});

test("anonymise keeps the row: complaints and policy records stay, without the person", () => {
  const sql = read(MIGRATION);
  const engine = sql.slice(sql.indexOf("create or replace function public.retention_execute"), sql.indexOf("revoke all on function public.retention_execute"));
  assert.doesNotMatch(engine, /delete from public\.(complaint|policy_current|policy_snapshot|raw_rows|agent_leads)\b/);
  assert.match(engine, /update public\.complaint c set complainant_name = null/);
  assert.match(engine, /update public\.raw_rows r set payload = public\.erase_matching_values/);
  // Lead data at 18 months never takes the 4-year defence with it.
  assert.match(engine, /'phone', case when exists \(select 1 from public\.tenant_call_attempts a where a\.lead_id = l\.id\)/);
});
