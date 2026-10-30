import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { partnerBoardStages } from "./board.ts";

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const pipelines = [{ id: OWN, name: "Marketing leads" }, { id: OTHER, name: "Publisher transfers" }];
const stage = (id, pipeline_id, name, position, stage_type = "open", is_archived = false) => ({ id, pipeline_id, name, position, stage_type, color: "#2563eb", is_archived });
const stages = [
  stage("own-2", OWN, "Call Lead", 1),
  stage("own-1", OWN, "Form Lead", 0),
  stage("own-won", OWN, "Converted", 6, "won"),
  stage("own-old", OWN, "Old stage", 7, "open", true),
  stage("other-1", OTHER, "New Transfer", 0),
  stage("other-dq", OTHER, "Returned to Partner - DQ", 2, "lost"),
];

test("LA-1.17: the board's columns are the partner's own pipeline stages, in order, even when empty", () => {
  const columns = partnerBoardStages({ defaultPipelineId: OWN, pipelines, stages, counts: [{ stageId: "own-1", pipelineId: OWN, stageName: "new", leadCount: 3 }] });
  assert.deepEqual(columns.map((column) => column.name), ["Form Lead", "Call Lead", "Converted"]);
  assert.deepEqual(columns.map((column) => column.leadCount), [3, 0, 0]);
  assert.ok(columns.every((column) => column.pipelineName === "Marketing leads"));
});

test("another pipeline holding the partner's leads follows, with only its occupied stages", () => {
  const columns = partnerBoardStages({ defaultPipelineId: OWN, pipelines, stages, counts: [
    { stageId: "other-dq", pipelineId: OTHER, stageName: "new", leadCount: 3 },
    { stageId: "own-1", pipelineId: OWN, stageName: "new", leadCount: 1 },
  ] });
  assert.deepEqual(columns.map((column) => `${column.pipelineName}/${column.name}`), [
    "Marketing leads/Form Lead", "Marketing leads/Call Lead", "Marketing leads/Converted",
    "Publisher transfers/Returned to Partner - DQ",
  ]);
});

test("an archived stage is a column only while it holds a lead; a stageless lead still gets one", () => {
  const columns = partnerBoardStages({ defaultPipelineId: OWN, pipelines, stages, counts: [
    { stageId: "own-old", pipelineId: OWN, stageName: "new", leadCount: 2 },
    { stageId: "new", pipelineId: "default", stageName: "new", leadCount: 1 },
  ] });
  assert.ok(columns.some((column) => column.id === "own-old" && column.leadCount === 2));
  assert.equal(columns.at(-1).name, "New");
  assert.equal(columns.at(-1).leadCount, 1);
});

test("a stage whose pipeline the tenant-scoped read did not return is never a column", () => {
  const columns = partnerBoardStages({ defaultPipelineId: OWN, pipelines: [pipelines[0]], stages, counts: [] });
  assert.ok(columns.every((column) => column.pipelineId === OWN));
});

test("no own pipeline: the pipelines the leads are in are the board", () => {
  const columns = partnerBoardStages({ defaultPipelineId: null, pipelines, stages, counts: [{ stageId: "other-1", pipelineId: OTHER, stageName: "new", leadCount: 4 }] });
  assert.deepEqual(columns.map((column) => column.name), ["New Transfer"]);
});

test("the board draws the shared lanes, and keeps the agency's stage on the card", async () => {
  // Reversed on 2026-10-30 (tasks/partner-pipeline/plan.md). LA-1.17 made the columns the agency's
  // own stages; the counters above them speak the shared lanes, and the two contradicted each other
  // on screen — "Claimed 1" over a column headed "New lead". The columns are now the lanes, so the
  // figures and the board are generated from one source and cannot disagree.
  const board = await readFile("components/partner/partner-lead-pipeline.tsx", "utf8");
  const home = await readFile("components/partner/partner-portal-overview.tsx", "utf8");

  // The columns are the lanes, in the counters' order.
  assert.match(board, /boardColumns\(/, "the board's columns come from lib/partnerLeads/view.ts");
  assert.match(board, /data-stage=\{column\.key\}/);

  // Nothing of the agency's own vocabulary is lost: the stage name is still on every card, still a
  // column in the table, and still a filter.
  assert.match(board, /row\.stageName/, "the agency's stage name stays on the card");
  assert.match(board, /filters\.stage_id/, "and stays filterable");

  // 80aa5e60 took the stage map off the partner home (movable tiles); its figures link to the board.
  assert.match(home, /const PIPELINE = "\/partner\/pipeline"/);

  // The server still builds the agency's stages: they feed the card line, the table and the filter.
  const service = await readFile("lib/partnerLeads/service.ts", "utf8");
  assert.match(service, /partnerBoardStages\(/);
  assert.match(service, /from\("tenant_pipelines"\)\.select\("id, name"\)\.eq\("tenant_id", tenantId\)/, "pipeline names are read tenant-scoped");
});
