/**
 * Marketing and affiliate leads stay in their own pipeline when an outcome is recorded (owner,
 * 2026-10-22; 20261022200000). The lead's pipeline's own stage wins; the agency-wide stage is the
 * fallback; the database and the screens resolve it the same way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { outcomesByStage, resolveOutcomeStages } from "./outcomeResolution.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const migration = read("supabase", "migrations", "20261022200000_partner_pipelines_keep_their_outcomes.sql").replace(/\r\n/g, "\n");

// Publisher pipeline P (agency-wide defaults live there), marketing pipeline M, affiliate pipeline A.
const agencyWide = [
  { disposition_key: "application_submitted", stage_id: "p-submitted" },
  { disposition_key: "not_interested", stage_id: "p-previously-sold" },
  { disposition_key: "voicemail", stage_id: "t-contacted" }, // a deliberate route to a product pipeline
];
const own = [
  { pipeline_id: "M", disposition_key: "application_submitted", stage_id: "m-converted" },
  { pipeline_id: "M", disposition_key: "not_interested", stage_id: "m-disqualified" },
  { pipeline_id: "A", disposition_key: "application_submitted", stage_id: "a-submitted" },
];

test("a lead's own pipeline wins, then the agency-wide stage, else it stays", () => {
  const marketing = resolveOutcomeStages(agencyWide, own, "M");
  assert.equal(marketing.get("application_submitted"), "m-converted");
  assert.equal(marketing.get("not_interested"), "m-disqualified");
  assert.equal(marketing.get("voicemail"), "t-contacted", "no own row: the agency-wide route still applies");
  assert.equal(marketing.get("busy"), undefined, "unmapped anywhere: the lead stays");

  const publisher = resolveOutcomeStages(agencyWide, own, "P");
  assert.equal(publisher.get("application_submitted"), "p-submitted", "a publisher lead is unchanged");

  const noLead = resolveOutcomeStages(agencyWide, own, null);
  assert.equal(noLead.get("application_submitted"), "p-submitted", "no pipeline: agency-wide only");
});

test("an archived own stage falls back to the agency-wide one, as the database does", () => {
  const resolved = resolveOutcomeStages(agencyWide, own, "M", (id) => id !== "m-converted");
  assert.equal(resolved.get("application_submitted"), "p-submitted");
});

test("the board offers a stage its pipeline's own outcomes and the agency-wide ones it has not replaced", () => {
  const pipelineOf = (id) => ({ "p-submitted": "P", "p-previously-sold": "P", "t-contacted": "T", "m-converted": "M", "m-disqualified": "M", "a-submitted": "A" })[id];
  const byStage = outcomesByStage(agencyWide, own, pipelineOf);
  assert.deepEqual(byStage.get("m-converted"), ["application_submitted"]);
  assert.deepEqual(byStage.get("p-submitted"), ["application_submitted"], "P has no own row, so its agency-wide stage still offers it");
  // An agency-wide stage inside M that M has replaced is not offered there.
  const replaced = outcomesByStage([{ disposition_key: "not_interested", stage_id: "m-other" }], own, (id) => (id === "m-other" ? "M" : pipelineOf(id)));
  assert.equal(replaced.get("m-other"), undefined);
  assert.deepEqual(replaced.get("m-disqualified"), ["not_interested"]);
});

test("the database lookup has the same order and the four movers all use it", () => {
  const resolver = migration.slice(migration.indexOf("create or replace function public.resolve_disposition_stage"), migration.indexOf("revoke all on function public.resolve_disposition_stage"));
  assert.ok(resolver.indexOf("pipeline_disposition_stages") < resolver.indexOf("stage_dispositions sd"), "own pipeline first");
  assert.match(resolver, /coalesce\(/);
  assert.match(resolver, /not s\.is_archived/);
  for (const fn of ["complete_disposition(uuid,uuid,uuid,uuid,text,text)", "complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)", "apply_lead_disposition_move(uuid,uuid,text,uuid,text)", "move_lead_to_disposition(uuid,uuid,text)"]) {
    assert.ok(migration.includes(`'public.${fn}'`), `${fn} is patched`);
  }
  assert.match(migration, /still reads stage_dispositions directly/, "the self-check refuses a mover that bypasses the resolver");
});

test("defaults: marketing and affiliate only, never over a stage the agency already chose inside that pipeline", () => {
  assert.match(migration, /p\.partner_type::text in \('marketing', 'affiliate'\)/);
  assert.match(migration, /and ms\.pipeline_id = p\.id/);
  assert.match(migration, /not exists \(select 1 from public\.pipeline_disposition_stages o where o\.tenant_id = p_tenant_id and o\.pipeline_id = p\.id\)/, "seeded once per pipeline");
  assert.match(migration, /perform public\.seed_partner_pipeline_outcomes\(p_tenant_id\);/, "new agencies get them too");
  for (const key of ["application_submitted", "not_interested", "do_not_call", "no_answer", "callback_scheduled"]) {
    assert.match(migration, new RegExp(`\\('marketing', '${key}'`));
    assert.match(migration, new RegExp(`\\('affiliate', '${key}'`));
  }
});
