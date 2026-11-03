// Settings › Pipelines & outcomes (owner, 2026-10-27): the same-name default and "stays where it is",
// in the TypeScript twin of resolve_disposition_stage (20261027100000), in the database's order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { resolveOutcomeStages, sameName } = await import("./outcomeResolution.ts");

// Pipeline M has stages m-new, m-callback ("Needs callback"), m-quoted ("Quoted"). Pipeline P has p-callback.
const pipelineOf = (id) => (id.startsWith("m-") ? "M" : id.startsWith("p-") ? "P" : undefined);
const mStages = [{ id: "m-new", name: "New lead" }, { id: "m-callback", name: "Needs callback" }, { id: "m-quoted", name: " quoted " }];
const labels = new Map([["needs_callback", "Needs callback"], ["quoted", "Quoted"], ["no_answer", "No answer"], ["sold", "Sold"]]);
const options = {
  pipelineOfStage: pipelineOf,
  stageNamedLike: (key) => mStages.find((s) => sameName(s.name, labels.get(key) ?? "\u0000"))?.id,
  keys: labels.keys(),
};

test("an outcome with nothing set goes to the stage in the lead's pipeline that has its name", () => {
  const resolved = resolveOutcomeStages([], [], "M", undefined, options);
  assert.equal(resolved.get("needs_callback"), "m-callback");
  assert.equal(resolved.get("quoted"), "m-quoted", "case and outer spaces do not count");
  assert.equal(resolved.has("no_answer"), false, "no stage of that name: the lead stays where it is");
});

test("the pipeline's own choice wins, and a row with no stage keeps the lead where it is", () => {
  const own = [{ pipeline_id: "M", disposition_key: "needs_callback", stage_id: "m-quoted" }, { pipeline_id: "M", disposition_key: "quoted", stage_id: null }];
  const resolved = resolveOutcomeStages([], own, "M", undefined, options);
  assert.equal(resolved.get("needs_callback"), "m-quoted");
  assert.equal(resolved.has("quoted"), false);
});

test("an agency-wide stage inside the lead's pipeline beats the name; one in another pipeline does not", () => {
  const inside = resolveOutcomeStages([{ disposition_key: "needs_callback", stage_id: "m-new" }], [], "M", undefined, options);
  assert.equal(inside.get("needs_callback"), "m-new");
  const elsewhere = resolveOutcomeStages([{ disposition_key: "needs_callback", stage_id: "p-callback" }, { disposition_key: "sold", stage_id: "p-sold" }], [], "M", undefined, options);
  assert.equal(elsewhere.get("needs_callback"), "m-callback", "the name in the lead's own pipeline keeps it there");
  assert.equal(elsewhere.get("sold"), "p-sold", "nothing in this pipeline: the agency-wide stage, as before");
});

test("without the options it is the old lookup: own row, else agency-wide", () => {
  const resolved = resolveOutcomeStages([{ disposition_key: "quoted", stage_id: "p-q" }], [{ pipeline_id: "M", disposition_key: "sold", stage_id: "m-new" }], "M");
  assert.deepEqual([...resolved.entries()].sort(), [["quoted", "p-q"], ["sold", "m-new"]]);
});

test("the database follows the same order", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261027100000_pipeline_outcome_defaults.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("create or replace function public.resolve_disposition_stage"));
  const at = (needle) => body.indexOf(needle);
  assert.ok(at("from public.pipeline_disposition_stages o") < at("and s.pipeline_id = p_pipeline_id"));
  assert.ok(at("and s.pipeline_id = p_pipeline_id") < at("lower(btrim(s.name)) = lower(btrim(d.label))"));
  assert.ok(at("lower(btrim(s.name)) = lower(btrim(d.label))") < at("-- 4. The agency-wide stage anywhere."));
  assert.match(sql, /alter column stage_id drop not null/);
});
