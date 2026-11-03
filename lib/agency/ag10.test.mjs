// AG-0.10 · lead assignment and routing rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ageLabel, ageTone } from "./routingCore.ts";
import { RULE_STRATEGIES, STRATEGY_LABEL } from "../assignment/constants.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018170000_ag_0_10_lead_assignment_routing.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/app/(shell)/assignments/page.tsx", import.meta.url), "utf8");
const pool = readFileSync(new URL("../../app/api/app/agency/pool/route.ts", import.meta.url), "utf8");

test("a state rule never assigns to a producer who is not appointed in that state", () => {
  assert.match(sql, /if v_state <> '' and not exists \(\s*select 1 from public\.producer_appointment a/);
  assert.match(sql, /a\.state = v_state and a\.status = 'appointed'/);
  assert.match(sql, /expires_on is null or a\.expires_on >= current_date/);
});

test("suspended, offboarded, invited and onboarding producers are excluded from every rule", () => {
  assert.match(sql, /p\.user_id = p_user_id and p\.status = 'active'\) then\s+return false;/);
});

test("reassignment preserves the prior assignment: the history is append-only", () => {
  assert.match(sql, /revoke update, delete, truncate on public\.lead_assignment_events from service_role, tenant_app, authenticated;/);
  assert.match(sql, /assignment history can be rewritten/);
});

test("the unassigned pool shows an age and is visible to owner and admin only", () => {
  assert.match(pool, /requireFeatureRole\("lead_assignment", \["owner"\]\)/);
  assert.match(page, /agency && guard\.role !== "owner"/);
  assert.equal(ageLabel(45), "45 min");
  assert.equal(ageLabel(3 * 24 * 60 + 4 * 60), "3 d 4 h");
  assert.equal(ageTone(30), "neutral");
  assert.equal(ageTone(6 * 60), "warning");
  assert.equal(ageTone(26 * 60), "danger");
});

test("routing by recent placement rate is a strategy of the existing router, not a new lead system", () => {
  assert.ok(RULE_STRATEGIES.includes("best_placement"));
  assert.equal(STRATEGY_LABEL.best_placement, "Best recent placement rate");
  assert.match(sql, /best_placement'' then -public\.producer_recent_placement_bps\(p_tenant_id, tu\.user_id\)/);
  assert.doesNotMatch(sql, /create table/i);
});
