// SA-4.7 audit (2026-10-15): which template a product hands out, when a copy is behind, and how a
// template's stages reach the pipeline board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chooseProductTemplate, newerVersionOfCopy, pickProductStage, stagesToAdd } from "./templateChoice.ts";

const standard = { id: "a-standard", name: "Term Life standard", version: 1, is_active: true, published_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
const simplified = { id: "b-simplified", name: "Term Life simplified", version: 3, is_active: true, published_at: "2026-08-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };

test("a higher version number of ANOTHER template never wins", () => {
  // Before: order by version desc picked the simplified template's v3.
  assert.equal(chooseProductTemplate([simplified, standard]).id, "a-standard", "most recently published wins");
});

test("the platform's designated default wins over recency", () => {
  assert.equal(chooseProductTemplate([standard, { ...simplified, is_default: true }]).id, "b-simplified");
});

test("inactive templates are never chosen; none active means none", () => {
  assert.equal(chooseProductTemplate([{ ...standard, is_active: false, is_default: true }, simplified]).id, "b-simplified");
  assert.equal(chooseProductTemplate([{ ...standard, is_active: false }]), null);
});

test("the choice does not depend on row order (ties broken by id)", () => {
  const tieA = { ...standard, id: "x2" };
  const tieB = { ...standard, id: "x1" };
  assert.equal(chooseProductTemplate([tieA, tieB]).id, "x1");
  assert.equal(chooseProductTemplate([tieB, tieA]).id, "x1");
});

test("'a newer version is available' compares only within the copy's own template id", () => {
  const copy = { template_id: "a-standard", template_version: 1 };
  assert.equal(newerVersionOfCopy(copy, [standard, simplified]), null, "simplified v3 is not an update to standard v1");
  assert.equal(newerVersionOfCopy(copy, [{ ...standard, version: 2 }, simplified]).version, 2);
  assert.equal(newerVersionOfCopy(copy, [{ ...standard, version: 2, is_active: false }]), null);
});

test("merging a template into a pipeline adds only missing stages, in template order, never duplicates", () => {
  const template = [
    { label: "New", sort_order: 0 },
    { label: "Quoted", sort_order: 2 },
    { label: "contacted", sort_order: 1 },
    { label: "Issued", sort_order: 3 },
  ];
  // The agency renamed nothing, archived "Quoted" (still present), and added its own stage.
  const existing = ["New", " Quoted ", "My custom stage"];
  assert.deepEqual(stagesToAdd(existing, template).map((s) => s.label), ["contacted", "Issued"]);
  // Applying the same template twice adds nothing the second time.
  assert.deepEqual(stagesToAdd([...existing, "contacted", "Issued"], template), []);
});

test("a template lead enters its product pipeline on the named stage, else the first open one", () => {
  const stages = [
    { id: "s2", name: "Contacted", position: 1, stage_type: "open", is_archived: false },
    { id: "s0", name: "Lost", position: 0, stage_type: "lost", is_archived: false },
    { id: "s3", name: "Quoted", position: 2, stage_type: "open", is_archived: true },
  ];
  assert.equal(pickProductStage(stages, "contacted").id, "s2");
  assert.equal(pickProductStage(stages, "Quoted").id, "s2", "an archived stage is never entered");
  assert.equal(pickProductStage(stages, null).id, "s2");
  assert.equal(pickProductStage([stages[1]], null), null);
});

test("the service applies the template's stages to the board and uses the deterministic choice", () => {
  const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /\.order\("version", \{ ascending: false \}\)\s*\.limit\(1\)/, "no highest-version-across-ids pick");
  assert.match(service, /const source = chooseProductTemplate\(candidates\);/);
  assert.match(service, /const newer = newerVersionOfCopy\(copy, candidates\);/);
  assert.match(service, /await syncTemplatePipeline\(tenantId, source\.product_code, source\.product_name \|\| source\.product_code, merged\.stages\);/);
  assert.match(service, /\(await resolveProductEntryStage\(tenantId, template\.template\.product_code, label\)\) \?\?\s*\(await resolveRuntimeStage\(tenantId, key\)\)/);
  const pipelines = readFileSync(new URL("../pipelines/service.ts", import.meta.url), "utf8");
  assert.match(pipelines, /rpc\("apply_template_pipeline" as never/);
});

test("the migration merges without deleting, renaming or moving a stage", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261015610000_sa4_template_default_and_product_pipelines.sql", import.meta.url), "utf8");
  const fn = sql.slice(sql.indexOf("create or replace function public.apply_template_pipeline"), sql.indexOf("-- ─── self-check"));
  assert.doesNotMatch(fn, /delete from|update public\.tenant_pipeline_stages|is_archived = true/i);
  assert.match(fn, /lower\(btrim\(s\.name\)\) = lower\(v_stage\.label\)/);
  assert.match(sql, /create unique index if not exists templates_one_default_per_product\s+on public\.templates \(product_code\)\s+where is_default;/);
  assert.match(sql, /revoke all on function public\.apply_template_pipeline\(uuid, text, text, jsonb\) from public, anon, authenticated;/);
});
