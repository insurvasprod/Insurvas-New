import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { closerBoard, estimateCents, figures, inDays, isAccepted, monthToDate, payoutBasis, reach, stageCounts } from "./typeOverview.ts";
import { anyStoredCampaign, groupByCampaign, isCallStage } from "./campaignsCore.ts";
import { ownPipelineChoices } from "./pipelineChoices.ts";

const row = (over) => ({ submittedAt: "2026-11-10T15:00:00", status: "unclaimed", disposition: null, stageId: "s1", submittedBy: { id: "u1", name: "Maria L." }, ...over });

test("accepted means the agency took it: not waiting, expired or dropped", () => {
  assert.equal(isAccepted({ status: "unclaimed" }), false);
  assert.equal(isAccepted({ status: "expired" }), false);
  assert.equal(isAccepted({ status: "dropped" }), false);
  for (const status of ["claimed", "la_active", "completed"]) assert.equal(isAccepted({ status }), true, status);
});

test("this month against the same days of last month, short months included", () => {
  assert.deepEqual(monthToDate("2026-11-18"), { from: "2026-11-01", to: "2026-11-18", previousFrom: "2026-10-01", previousTo: "2026-10-18" });
  assert.deepEqual(monthToDate("2026-03-31"), { from: "2026-03-01", to: "2026-03-31", previousFrom: "2026-02-01", previousTo: "2026-02-28" });
  assert.deepEqual(monthToDate("2026-01-05").previousFrom, "2025-12-01");
});

test("an estimate is a per-item rate times a count the partner can see, never a revenue share", () => {
  const counts = figures([row({ status: "claimed" }), row({ status: "completed", disposition: "sold" }), row({ status: "unclaimed" })]);
  assert.deepEqual(counts, { submitted: 3, accepted: 2, sold: 1, held: 1 });
  assert.equal(payoutBasis("per_transfer", counts), 2);
  assert.equal(payoutBasis("per_lead", counts), 3);
  assert.equal(payoutBasis("per_sale", counts), 1);
  assert.equal(estimateCents({ payoutModel: "per_transfer", rateCents: 3000, ratePctBp: null }, counts), 6000);
  assert.equal(estimateCents({ payoutModel: "revenue_share", rateCents: null, ratePctBp: 1800 }, counts), null, "no estimate of the agency's commission");
  assert.equal(estimateCents(null, counts), null);
});

test("the funnel is the own pipeline's stages, in order, and reach drops lost stages", () => {
  const stages = [
    { id: "a", pipelineId: "own", name: "Referred", position: 0, stageType: "open" },
    { id: "d", pipelineId: "own", name: "Submitted", position: 3, stageType: "won" },
    { id: "x", pipelineId: "other", name: "New Transfer", position: 0, stageType: "open" },
    { id: "b", pipelineId: "own", name: "Contacted", position: 1, stageType: "open" },
    { id: "c", pipelineId: "own", name: "Qualified", position: 2, stageType: "open" },
    { id: "e", pipelineId: "own", name: "Not Interested", position: 4, stageType: "lost" },
  ];
  const counts = stageCounts(stages, [{ stageId: "a" }, { stageId: "b" }, { stageId: "c" }, { stageId: "c" }, { stageId: "d" }, { stageId: "e" }, { stageId: "x" }]);
  assert.deepEqual(counts.map((stage) => stage.name), ["Referred", "Contacted", "Qualified", "Submitted", "Not Interested"], "another type's stage never appears");
  assert.deepEqual(reach(counts).map((stage) => [stage.name, stage.count]), [["Referred", 5], ["Contacted", 4], ["Qualified", 3], ["Submitted", 1]]);
});

test("the closer leaderboard ranks by sent, with accepted beside it", () => {
  const board = closerBoard([row({ status: "claimed" }), row({}), row({ submittedBy: { id: "u2", name: "Ken T." }, status: "completed" })]);
  assert.deepEqual(board.map((entry) => [entry.name, entry.sent, entry.accepted]), [["Maria L.", 2, 1], ["Ken T.", 1, 1]]);
});

test("inDays counts the viewer's own calendar days, inclusive", () => {
  const rows = [row({ submittedAt: "2026-11-01T00:30:00" }), row({ submittedAt: "2026-10-31T23:30:00" })];
  assert.equal(inDays(rows, "2026-11-01", "2026-11-18").length, 1);
});

test("campaigns group by the stored campaign, else by how the lead arrived", () => {
  const groups = groupByCampaign([
    { campaign: "FE Facebook Nov", viaLink: true, status: "completed", disposition: "sold", stageName: "Converted" },
    { campaign: "fe facebook nov", viaLink: true, status: "claimed", disposition: null, stageName: "Call Lead" },
    { campaign: null, viaLink: false, status: "unclaimed", disposition: null, stageName: "Form Lead" },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.leads, group.form, group.call, group.contacted, group.converted, group.stored]), [
    ["FE Facebook Nov", 2, 1, 1, 2, 1, true],
    ["Portal form", 1, 1, 0, 0, 0, false],
  ]);
  assert.equal(anyStoredCampaign(groups), true);
  assert.equal(anyStoredCampaign(groupByCampaign([{ campaign: null, viaLink: false, status: "unclaimed", disposition: null, stageName: null }])), false);
  assert.equal(isCallStage("Call Lead"), true);
  assert.equal(isCallStage("Pickup - Needs Callback"), false);
});

test("the pipeline picker names only the partner's own pipelines", () => {
  const choices = [{ id: "pub", name: "Publisher transfers" }, { id: "mkt", name: "Marketing leads" }, { id: "aff", name: "Affiliate referrals" }, { id: "custom", name: "Holiday push" }];
  assert.deepEqual(ownPipelineChoices(choices, "mkt", new Set()).map((choice) => choice.name), ["Marketing leads"]);
  assert.deepEqual(ownPipelineChoices(choices, "mkt", new Set(["custom"])).map((choice) => choice.name), ["Marketing leads", "Holiday push"]);
  assert.deepEqual(ownPipelineChoices(choices, null, new Set(["pub"])).map((choice) => choice.name), ["Publisher transfers"]);
});

test("the pipeline read narrows the agency's pipelines before answering", async () => {
  const service = await readFile("lib/partnerLeads/service.ts", "utf8");
  assert.match(service, /const pipelines = await partnerPipelineChoices\(db, tenantId, partnerId, agencyPipelines, ownPipelineId\)/);
  assert.match(service, /\.from\("lead_queue"\)\.select\("id"\)\.eq\("tenant_id", tenantId\)\.eq\("partner_id", partnerId\)\.eq\("pipeline_id", choice\.id\)\.limit\(1\)/);
});

test("the typed home never shows the agency's commission or a rejected number", async () => {
  const home = await readFile("components/partner/partner-type-overview.tsx", "utf8");
  assert.doesNotMatch(home, /commissionCents|basisCents|agent_floor/);
  assert.match(home, /label="Compliance rejects" value=\{data\.rejected == null \? "—" : n\(data\.rejected\)\}/, "a count only");
  assert.match(home, /revenue share · on your statement/, "a revenue share shows its rate");
});
