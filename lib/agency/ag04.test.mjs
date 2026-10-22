// AG-0.4 · row-level producer visibility — one predicate, two places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { keepVisible, rowVisible, visibleUserIdsFor } from "./visibilityCore.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018130000_ag_0_4_producer_visibility.sql", import.meta.url), "utf8");
const helper = readFileSync(new URL("./visibility.ts", import.meta.url), "utf8");

const agency = (role, extra = {}) => visibleUserIdsFor({ audience: "agency", role, title: null, selfUserId: "me", ...extra });

test("the rule, role by role", () => {
  assert.equal(agency("owner"), null);
  assert.equal(agency("owner", { title: "admin" }), null);
  assert.equal(agency("bookkeeper"), null);
  assert.equal(agency("retention"), null);
  assert.deepEqual(agency("producer"), ["me"]);
  assert.deepEqual(agency("setter"), ["me"], "a setter nobody assigned keeps only his own work");
  assert.deepEqual(agency("setter", { assistsUserIds: ["maria", "dev"] }), ["me", "dev", "maria"], "and books for the producers he is assigned to");
  assert.deepEqual(agency("producer", { title: "manager", directReportUserIds: ["dev", "ana"] }), ["me", "ana", "dev"]);
  assert.deepEqual(agency("assistant", { assistsUserIds: ["maria"] }), ["maria"]);
  assert.deepEqual(agency("assistant"), [], "an assistant nobody assigned sees nothing");
  assert.deepEqual(agency(null), [], "a non-member sees nothing");
});

test("for a solo agent the predicate is a no-op", () => {
  for (const role of ["owner", "producer", "assistant", "bookkeeper"]) {
    assert.equal(visibleUserIdsFor({ audience: "individual", role, title: null, selfUserId: "me" }), null);
  }
  assert.equal(visibleUserIdsFor({ audience: null, role: "producer", title: null, selfUserId: "me" }), null);
});

test("aggregates count: unattributed and other producers' rows are dropped before summing", () => {
  const rows = [{ p: "me", c: 100 }, { p: "b", c: 900 }, { p: null, c: 50 }];
  const mine = keepVisible(["me"], rows, (r) => r.p);
  assert.equal(mine.reduce((s, r) => s + r.c, 0), 100);
  assert.equal(keepVisible(null, rows, (r) => r.p).length, 3);
  assert.equal(rowVisible(["me"], null), false);
  assert.equal(rowVisible(null, null), true);
});

test("both places call the same database function; scope never comes from the request", () => {
  assert.match(sql, /create or replace function public\.agency_visible_user_ids/);
  assert.match(helper, /rpc<string\[\] \| null>\("agency_visible_user_ids"/);
  assert.doesNotMatch(helper, /searchParams|request\.|params\./);
  assert.match(sql, /current_setting\('app\.user_id', true\)/);
});

test("CI check: every producer-scoped table carries the restrictive policy", () => {
  const listed = [...sql.matchAll(/array\['([a-z_]+)', '[^']*(?:''[^']*)*'\]/g)].map((m) => m[1]);
  for (const table of ["lead_queue", "tenant_application_cases", "tenant_applications", "policy_current", "tenant_issued_policies",
    "commission_entry", "cost_entry", "producer_ledger_entry", "producer_split", "producer_payout_run", "tenant_call_attempts",
    "tenant_callbacks", "retention_assignment"]) {
    assert.ok(listed.includes(table), `${table} has no agency_producer_scope policy`);
  }
  assert.match(sql, /as restrictive for select to tenant_app/);
  // and the migration's own self-check fails on a listed table without it
  assert.match(sql, /producer-scoped tables without the restrictive policy/);
});

test("the follow-up migration keeps the database rule identical: setter branch, and agency pools closed to narrowed sessions", () => {
  const followup = readFileSync(new URL("../../supabase/migrations/20261019100000_ag_followups_setters_pool_wording.sql", import.meta.url), "utf8");
  assert.match(followup, /if v_role = 'setter' then[\s\S]*?array\[p_user_id\] \|\| coalesce\(array_agg\(ap\.producer_user_id/);
  assert.match(followup, /agent_can_take_pool_lead[\s\S]*?agency_visible_user_ids\(p_tenant_id, p_user_id\) is not null then false/);
});
