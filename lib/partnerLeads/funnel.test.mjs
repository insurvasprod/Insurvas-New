import test from "node:test";
import assert from "node:assert/strict";

import { partnerFunnel } from "./funnel.ts";

const stage = (id, position, stageType, leadCount, pipelineId = "p1") => ({ id, pipelineId, pipelineName: pipelineId === "p1" ? "Final expense" : "Medicare", name: id, position, stageType, color: "", isArchived: false, leadCount });

test("a stage's figure is its leads plus every lead further on; lost leads drop out after Sent", () => {
  const funnel = partnerFunnel([stage("New", 1, "open", 10), stage("Contacted", 2, "open", 30), stage("Quoted", 3, "open", 5), stage("Sold", 4, "won", 7), stage("Lost", 5, "lost", 8)]);
  assert.deepEqual(funnel.steps.map((s) => [s.label, s.count]), [["Sent", 60], ["New", 52], ["Contacted", 42], ["Quoted", 12], ["Sold", 7]]);
  assert.equal(funnel.lost, 8);
  assert.deepEqual(funnel.stuck, { stageId: "Contacted", label: "Contacted", count: 30 });
  assert.equal(funnel.steps.at(-1).won, true);
});

test("only the busiest pipeline is drawn, and the funnel says it is partial", () => {
  const funnel = partnerFunnel([stage("A", 1, "open", 2), stage("B", 1, "open", 9, "p2")]);
  assert.equal(funnel.pipelineName, "Medicare");
  assert.equal(funnel.partial, true);
});

test("no stages, or nothing waiting, gives an empty map and no stuck stage", () => {
  assert.deepEqual(partnerFunnel([]).steps, []);
  assert.equal(partnerFunnel([stage("Sold", 1, "won", 3)]).stuck, null);
});
