// LA-6.1 (Notion sprint, Module 6 — Compliance) · the compliance record index.
// Run with: node --experimental-strip-types --test lib/compliance/recordIndex.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getUsPhone10Digits } from "./scrub.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015100000_la_6_1_compliance_index.sql";

// The corpus both keys answer to. The migration's self-check lists the same cases.
const CORPUS = [
  ["(817) 555-0142", "8175550142"],
  ["8175550142", "8175550142"],
  ["+18175550142", "8175550142"],
  ["817-555-0142", "8175550142"],
  ["1 817.555.0142", "8175550142"],
  [" 817 555 0142 ", "8175550142"],
  ["28175550142", null],
  ["555-0142", null],
  ["817555014x", null],
  ["", null],
];
const key = (v) => {
  try {
    return getUsPhone10Digits(v);
  } catch {
    return null;
  }
};

test("LA-1.5's getUsPhone10Digits keys the corpus: four formats of one number, one key", () => {
  for (const [input, want] of CORPUS) assert.equal(key(input), want, JSON.stringify(input));
});

test("the database twin is held to the same corpus by the migration's self-check", () => {
  const sql = read(MIGRATION);
  for (const [input, want] of CORPUS) {
    const lit = input.replaceAll("'", "''");
    const line = want === null ? `public.us_phone_10_digits('${lit}') is not null` : `public.us_phone_10_digits('${lit}') is distinct from '${want}'`;
    assert.ok(sql.includes(line), `the self-check is missing ${line}`);
  }
  assert.ok(sql.includes("public.us_phone_10_digits(null) is not null"));
  // Same rule as the TypeScript: only these characters, a leading 1 on eleven digits dropped, else no number.
  assert.match(sql, /p_value !~ '\^\[\[:space:\]\]\*\[\+\(\)0-9\[:space:\]\.-\]\+\[\[:space:\]\]\*\$'/);
  assert.match(sql, /when length\(d\) = 11 and left\(d, 1\) = '1' then right\(d, 10\)\n\s+when length\(d\) = 10 then d/);
});

test("the read side normalises with getUsPhone10Digits and writes no second normaliser", () => {
  const store = read("lib/compliance/recordIndex.ts");
  assert.match(store, /import \{ getUsPhone10Digits \} from "\.\/scrub";/);
  assert.match(store, /return getUsPhone10Digits\(phone\);/);
  assert.doesNotMatch(store, /replace\(\/\\D\/g|\[\^0-9\]|\\d\{10\}/);
});

test("one definition of what is indexed: the triggers, the rebuild and the reconciliation all read the source view", () => {
  const sql = read(MIGRATION);
  const fromView = sql.match(/from public\.compliance_index_source/g) ?? [];
  assert.ok(fromView.length >= 5, `the view is read ${fromView.length} times`);
  for (const fn of ["compliance_index_sync()", "compliance_index_sync_disclosure()", "compliance_index_sync_lead()", "compliance_index_rebuild(p_tenant_id uuid)"]) {
    const at = sql.indexOf(`create or replace function public.${fn}`);
    assert.ok(at > 0, fn);
    const body = sql.slice(at, sql.indexOf("end $$;", at));
    assert.match(body, /public\.compliance_index_source/, `${fn} reads the view`);
  }
});

test("every source table named in the spec's map has a trigger", () => {
  const sql = read(MIGRATION);
  for (const t of ["screening_audit", "tenant_suppression_list", "tenant_campaign_scrub_rejections", "tenant_dial_dnc_checks", "tenant_do_not_call", "tenant_consent_artefacts", "tenant_call_attempts", "tenant_application_disclosures"]) {
    assert.match(sql, new RegExp(`create trigger compliance_index_sync after insert or (update or delete|delete or update of [a-z_, ]+) on public\\.${t} for each row`), t);
    assert.match(sql, new RegExp(`'${t}'(::text)? as source_table|'${t}', `), `${t} is a branch of the view`);
  }
  assert.match(sql, /create trigger compliance_index_sync_lead after update of values, contact_id on public\.agent_leads/);
});

test("pointers, not copies: the index keeps keys and a short summary only", () => {
  const sql = read(MIGRATION);
  const table = sql.slice(sql.indexOf("create table if not exists public.compliance_index ("), sql.indexOf("\n);", sql.indexOf("create table if not exists public.compliance_index (")));
  const cols = [...table.matchAll(/^\s{2}(\w+) /gm)].map((m) => m[1]).filter((c) => c !== "constraint");
  assert.deepEqual(cols, ["tenant_id", "phone_digits", "contact_id", "lead_id", "event_type", "event_at", "source_table", "source_id", "source_sub_id", "outcome_summary", "module"]);
  // The key is (event type, source row): a rebuild reproduces the same rows, nothing random.
  assert.match(table, /primary key \(tenant_id, event_type, source_table, source_id, source_sub_id\)/);
  assert.doesNotMatch(table, /gen_random_uuid|default now\(\)/);
  assert.match(sql, /create index if not exists compliance_index_phone_idx on public\.compliance_index \(tenant_id, phone_digits, event_at\)/);
  assert.match(sql, /create index if not exists compliance_index_contact_idx on public\.compliance_index \(tenant_id, contact_id, event_at\)/);
});

test("event_at is when the thing happened, taken from the source row", () => {
  const sql = read(MIGRATION);
  const view = sql.slice(sql.indexOf("create or replace view public.compliance_index_source"), sql.indexOf("revoke all on public.compliance_index_source"));
  assert.doesNotMatch(view, /now\(\)|current_timestamp|clock_timestamp/);
  for (const at of ["s.ts", "v.added_at", "r.rejected_at", "d.checked_at", "n.created_at", "coalesce(c.consent_timestamp, c.captured_at)", "a.attempted_at", "a.disclosure_confirmed_at", "t.acknowledged_at"]) {
    assert.ok(view.includes(at), at);
  }
});

test("only the database writes the index; the app reads it", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.compliance_index from service_role, tenant_app;/);
  const writers = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /from\("compliance_index"\)\.(insert|upsert|update|delete)/.test(read(p))) writers.push(p);
    }
  };
  for (const d of ["lib", "app", "components"]) walk(d);
  assert.deepEqual(writers, []);
});

test("the nightly reconciliation is scheduled and reports a miss count", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /cron\.schedule\('la6-compliance-index-nightly', '30 5 \* \* \*'/);
  assert.match(sql, /jsonb_build_object\('tenants', v_tenants, 'missing', v_total_missing, 'stale', v_total_stale, 'unkeyed', v_total_unkeyed\)/);
  assert.match(sql, /if \(v->>'missing'\)::int <> 0 or \(v->>'stale'\)::int <> 0 then/);
});
