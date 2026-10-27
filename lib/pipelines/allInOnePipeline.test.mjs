// Run with: npm test
//
// Settings › Pipelines & outcomes (owner, 2026-10-27): one all-in-one pipeline every agent uses by default.
// A new agency starts with the Sales pipeline only (20261027300000); every lead with no partner — and a
// partner's lead while the agency has no pipeline of that partner type — enters it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase", "migrations", "20261027300000_all_in_one_sales_pipeline.sql");
const service = read("lib", "pipelines", "service.ts");

test("a new agency is seeded with the all-in-one Sales pipeline only", () => {
  const seed = migration.slice(migration.indexOf("create or replace function public.seed_default_pipelines"));
  assert.match(seed, /perform public\.seed_general_pipeline\(p_tenant_id\);/);
  assert.match(seed, /perform public\.seed_partner_pipeline_outcomes\(p_tenant_id\);/, "the 20261022200000 check still finds it");
  assert.doesNotMatch(seed.slice(0, seed.indexOf("$$;")), /Publisher transfers|Marketing leads|Affiliate referrals/);
});

test("the Sales pipeline has ten stages and sends every standard outcome somewhere", () => {
  assert.match(migration, /values \(p_tenant_id, 'Sales pipeline', null, true, 'live'\)/);
  const stages = [...migration.matchAll(/\(v_pipeline, '([^']+)',\s+(\d), '(open|won|lost)'/g)];
  assert.equal(stages.length, 10);
  assert.deepEqual(stages.filter((s) => s[3] === "won").map((s) => s[1]), ["Submitted"]);
  const outcomes = [...migration.matchAll(/\('([a-z_]+)',\s+'([^']+)'\)/g)];
  const names = new Set(stages.map((s) => s[1]));
  for (const key of ["application_submitted", "sent_to_underwriting", "callback_scheduled", "did_not_qualify", "no_payment_method", "not_interested", "do_not_call", "call_dropped", "no_answer", "voicemail", "busy", "wrong_number", "disconnected", "inbound_return_call"]) {
    const row = outcomes.find((o) => o[1] === key);
    assert.ok(row, `${key} has a stage`);
    assert.ok(names.has(row[2]), `${key} goes to a stage the pipeline has`);
  }
  assert.match(migration, /if v_pipeline is not null then return v_pipeline; end if;/, "an agency's own all-in-one default is kept");
});

test("leads with no partner, and partners with no pipeline of their type, enter the all-in-one pipeline", () => {
  assert.match(service, /if \(partnerType === null\) return \(await resolveGeneralStage\(tenantId, stageKey\)\) \?\? resolveRuntimeStage\(tenantId, stageKey, "marketing"\);/);
  assert.match(service, /if \(partnerType === null\) return resolveUnpartneredEntry\(tenantId\);/);
  assert.match(service, /const general = await resolveGeneralStage\(tenantId, "partner_submitted"\);/);
  assert.match(service, /if \(!partnerId\) return null;/);
  assert.doesNotMatch(read("lib", "retention", "winbackStore.ts"), /resolveRuntimeStage\(tenantId, "new", "marketing"\)/);
});
