import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// Owner 2026-10-29: every pipeline follows its applications, each by its own map, and a card moves
// only within the pipeline it is on (20261029100000).
test("the stage sync reads the map of the lead's own pipeline", () => {
  const sync = read("./stageSyncService.ts");
  assert.match(sync, /select\("sync_key, stage_id, pipeline_id"\)/);
  assert.match(sync, /if \(mapQ\.perPipeline && row\.pipeline_id !== base\.boardPipelineId\) continue;/);
});

test("Settings saves one pipeline's map at a time, keyed by pipeline", () => {
  const settings = read("../salesSettings/stageMap.ts");
  assert.match(settings, /onConflict: perPipeline \? "tenant_id,pipeline_id,sync_key" : "tenant_id,sync_key"/);
  assert.match(settings, /if \(perPipeline\) del = del\.eq\("pipeline_id", pipeline!\.id\);/);
});

test("the migration keys the map by pipeline and keeps each stage in its own pipeline", () => {
  const sql = read("../../supabase/migrations/20261029100000_application_stage_map_per_pipeline.sql");
  assert.match(sql, /primary key \(tenant_id, pipeline_id, sync_key\)/);
  assert.match(sql, /STAGE_MAP_OTHER_PIPELINE/);
});
