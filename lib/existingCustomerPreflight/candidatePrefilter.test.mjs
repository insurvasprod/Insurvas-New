// LA-1.24-9 (M1 perf, 2026-09-30): the pre-flight at 20,000 contacts in a 135,500-lead tenant.
//
// find_existing_customer_preflight scored every lead of the tenant and tested every contact before
// any index narrowed them, and timed out on every run. 20260929140100 adds indexed candidate CTEs
// BEFORE the scorer. These pin that the prefilter is there, that it is a superset of what the scorer
// can return, and that the scorer itself did not change by one character.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260929140100_m1_preflight_indexed_candidates.sql", "utf8");
const previous = await readFile("supabase/migrations/20260915130000_la_1_24_preflight_candidate_indexes.sql", "utf8");
const LAST = "limit least(greatest(coalesce(p_limit, 20), 1), 50);";
const body = (sql) => sql.slice(sql.indexOf("with input as ("), sql.lastIndexOf(LAST) + LAST.length);
const between = (sql, from, to) => { const start = sql.indexOf(from); return start < 0 ? "" : sql.slice(start, sql.indexOf(to, start)); };
const now = body(migration);
const before = body(previous);

test("the scorer, its weights and its thresholds are byte-for-byte the previous definition", () => {
  // Each scoring CTE up to the next CTE, and the final select to the end.
  const segment = (sql, from) => {
    const rest = sql.slice(sql.indexOf(from));
    const ends = [rest.indexOf("\n), ", 1), rest.indexOf("\n)\nselect ", 1)].filter((index) => index > 0);
    return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
  };
  for (const from of ["), lead_scored as (", "), contact_scored as (", "\nselect s.lead_id"]) {
    const was = segment(before, from);
    assert.ok(before.includes(from) && was.length > 40, `found ${from.trim()} in 20260915130000`);
    assert.equal(segment(now, from), was, `${from.trim()} is unchanged`);
  }
  assert.match(migration, /set "pg_trgm\.similarity_threshold" to '0\.3'/i);
  assert.equal((now.match(/raw_score >= \.45/g) ?? []).length, 2);
});

test("an indexed lead prefilter runs before the scoring, with the three arms that can reach .45", () => {
  const candidates = between(now, "), lead_candidates as (", "), lead_values as (");
  assert.ok(now.indexOf("lead_candidates as (") < now.indexOf("lead_values as ("), "prefilter comes first");
  assert.match(candidates, /public\.preflight_lead_phone_keys\(l\.values\) @> array\[/);
  assert.match(candidates, /nullif\(regexp_replace\(coalesce\(l\.values->>'dob', l\.values->>'date_of_birth', ''\), '\[\^0-9\]', '', 'g'\), ''\) = replace\(p_dob::text, '-', ''\)/);
  assert.match(candidates, /public\.preflight_lead_name_key\(l\.values\) % /);
  // A name-only lead needs similarity >= .625 (.40 x name + at most .20 address >= .45). The arm keeps a margin under it.
  const floor = Number(candidates.match(/\) >= (\.\d+)\n/)?.[1]);
  assert.ok(floor > 0.3 && floor < 0.625, `name arm floor ${floor} is under .625`);
  assert.match(between(now, "), lead_values as (", "), lead_scored as ("), /and l\.id in \(select c\.id from lead_candidates c\)/);
  // Apart from that one line, lead_values is the previous definition.
  assert.equal(
    between(now, "), lead_values as (", "), lead_scored as (").replace("    and l.id in (select c.id from lead_candidates c)\n", ""),
    between(before, "), lead_values as (", "), lead_scored as ("),
  );
});

test("the contact prefilter is the contact OR, one indexed arm per branch, and the OR still applies", () => {
  const candidates = between(now, "), contact_candidates as (", "), contact_values as (");
  assert.match(candidates, /regexp_replace\(coalesce\(c\.primary_phone, ''\), '\[\^0-9\]', '', 'g'\) = /);
  assert.match(candidates, /from public\.contact_phones cp/);
  assert.match(candidates, /c\.dob = p_dob/);
  assert.match(candidates, /c\.name_search % /);
  assert.match(candidates, /from public\.households h/);
  const values = between(now, "), contact_values as (", "), contact_scored as (");
  assert.match(values, /and c\.id in \(select cc\.contact_id from contact_candidates cc\)/);
  // Apart from that one line, contact_values (and its whole OR) is the previous definition.
  assert.equal(
    values.replace("    and c.id in (select cc.contact_id from contact_candidates cc)\n", ""),
    between(before, "), contact_values as (", "), contact_scored as ("),
  );
});

test("the candidate indexes and helpers exist, idempotently, and the helpers are checked against the scorer", () => {
  for (const name of ["agent_leads_preflight_phone_keys_idx", "agent_leads_preflight_dob_idx", "agent_leads_preflight_name_trgm_idx", "contacts_preflight_household_idx"]) {
    assert.match(migration, new RegExp(`create index if not exists ${name}\\b`));
  }
  assert.doesNotMatch(migration, /create index concurrently/i);
  assert.match(migration, /create or replace function public\.preflight_lead_name_key\(p_values jsonb\)\nreturns text\nlanguage sql\nimmutable/);
  assert.match(migration, /create or replace function public\.preflight_lead_phone_keys\(p_values jsonb\)\nreturns text\[\]\nlanguage sql\nimmutable/);
  assert.match(migration, /the preflight helpers disagree with the scorer/);
  // Index maintenance runs the helpers for whoever inserts a lead: EXECUTE must stay with PUBLIC.
  assert.doesNotMatch(migration, /revoke[^;]*preflight_lead_(name_key|phone_keys)/i);
  assert.match(migration, /revoke all on function public\.find_existing_customer_preflight\([^)]*\) from public, anon, authenticated, tenant_app/);
  assert.match(migration, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
  for (const line of migration.split("\n").filter((l) => l.trimStart().startsWith("--"))) assert.ok(!line.includes(";"), `no semicolon in a comment: ${line}`);
});
