// A partner's own pipeline (owner 2026-11-19). Run with: node --experimental-strip-types --test lib/pipelines/partnerTypePipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const lib = read("lib/pipelines/partnerTypePipeline.ts");
const seed = read("supabase/migrations/20260902190000_la_1_9_pipelines.sql");

test("adding a partner brings its type's own pipeline, and a failure never undoes the partner", () => {
  const route = read("app/api/app/partners/route.ts");
  assert.match(route, /after\(\(\) => ensurePartnerTypePipeline\(pipelineFor, pipelineType\)\.catch\(/, "after the response, so the save is not held up");
  assert.ok(route.indexOf("ensurePartnerTypePipeline(pipelineFor") > route.indexOf("createPartnerWithLimits(tenantId"), "after the partner exists");
});

test("one default pipeline per type: an existing one is left as it is", () => {
  assert.match(lib, /\.eq\("tenant_id", tenantId\)\.eq\("partner_type", partnerType\)\.eq\("is_default", true\)\.maybeSingle\(\)/);
  assert.match(lib, /if \(existing\) return \{ created: false/);
  assert.match(lib, /createPipeline\(tenantId, \{ name: plan\.name, partner_type: partnerType, is_default: true \}\)/);
  // Two intakes racing: the loser of the one-default-per-type index reads the winner's pipeline.
  assert.match(lib, /const raced = await readTypePipeline\(tenantId, partnerType\);\n\s+if \(raced\) return \{ created: false/);
});

test("the board is two writes: the stages go in one insert, and a failed insert takes its empty pipeline with it", () => {
  const board = lib.slice(lib.indexOf("export async function ensurePartnerTypeBoard"), lib.indexOf("export async function finishPartnerTypePipeline"));
  assert.doesNotMatch(board, /createStage\(/, "no longer three round trips per stage");
  assert.match(board, /from\("tenant_pipeline_stages"\)\.insert\(rows as never\)/);
  assert.match(board, /position: index/);
  assert.match(board, /from\("tenant_pipelines"\)\.delete\(\)\.eq\("id", pipeline\.id\)\.eq\("tenant_id", tenantId\)/);
});

test("a partner from before the per-type pipelines gets its board when its first lead arrives (walk 2026-11-20)", () => {
  const service = read("lib/agentTemplates/service.ts").replace(/\r\n/g, "\n");
  const create = service.slice(service.indexOf("export async function createPartnerLead"));
  const ensure = create.indexOf("await ensurePartnerTypePipelineForIntake({ tenantId, partnerId, userId }, partnerType)");
  assert.ok(ensure > 0, "every partner lead passes through it");
  assert.ok(ensure < create.indexOf("await resolvePartnerEntryStage(tenantId, partnerType)"), "before the lead is filed, so it is filed on the type's board");
  const intake = lib.slice(lib.indexOf("export async function ensurePartnerTypePipelineForIntake"));
  assert.match(intake, /const board = await ensurePartnerTypeBoard\(scope\.tenantId, partnerType\)/, "the board inline: it is two writes");
  assert.match(intake, /after\(run\)/, "the slow after-sale rules after the response");
  assert.match(intake, /boardsSeen\.has\(seenKey\)\) return/, "once: later leads skip the read");
  assert.match(intake, /console\.error\("\[partner pipeline\] intake board", error\)/, "a failure never fails the lead");
  assert.match(lib, /from\("partners"\)\.select\("created_by"\)\.eq\("tenant_id", tenantId\)\.eq\("id", partnerId\)/, "service-role read under the tenant");
});

test("the stages are LA-1.9's for each type, so the legacy stage names still resolve", () => {
  for (const name of ["New Transfer", "Incomplete Transfer", "Pending Approval", "Submitted", "Did Not Qualify", "Form Lead", "Call Lead", "Qualified - Needs Conversion", "Converted", "Disqualified - Do Not Call", "Referred", "Contacted", "Qualified", "Not Interested"]) {
    assert.match(lib, new RegExp(`name: "${name}"`), name);
    assert.match(seed, new RegExp(`'${name}'`), `${name} is a seeded stage`);
  }
});

test("sold cards go on after the sale: open and won stages join the starter after-sale rules", () => {
  assert.match(lib, /made\.filter\(\(stage\) => stage\.stage_type !== "lost"\)/);
  assert.match(lib, /for \(const stageId of stageIds\) await addStageToStarterRules\(scope, stageId\)/);
  assert.match(lib, /if \(partnerType === "publisher"\) await ensureDefaultPublisherDispositionMappings\(scope\.tenantId, pipelineId\)/);
  assert.match(lib, /if \(board\.created\) await finishPartnerTypePipeline\(scope, partnerType, board\.pipelineId, board\.stageIds\)/, "a new partner's board still gets them");
  assert.doesNotMatch(lib, /#[0-9a-f]{6}/i, "colours come from the palette");
});
