import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { copyByName, mapChecks, matchByName, matchCount, statesByStage } = await import("./stageMapChecks.ts");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// The demo agency's Publisher transfers pipeline as it is live (2026-10-30), in board order.
const publisher = {
  id: "p1",
  name: "Publisher transfers",
  stages: [
    ["s1", "New Transfer", "open"], ["s2", "Did Not Qualify", "lost"], ["s3", "Declined Underwriting", "lost"],
    ["s4", "Pending Approval", "open"], ["s5", "Submitted", "won"], ["s6", "Issued", "open"],
  ].map(([id, name, stageType]) => ({ id, name, stageType })),
};
const live = { submitted: "s5", pending_requirements: "s4", issued: "s6", lost: "s3" };

test("the checks flag a later state placed before an earlier one, and a sale won before it is issued", () => {
  const checks = mapChecks(publisher, live);
  const by = Object.fromEntries(checks.map((c) => [c.key, c.text]));
  assert.match(by.pending_requirements, /comes before Submitted's \(Submitted\) on the board/);
  assert.match(by.submitted, /marked won, so the sale counts as won before it is issued \(Issued goes to Issued\)/);
  assert.equal(by.lost, undefined, "Lost on a lost stage is fine");
  assert.deepEqual(checks.map((c) => c.key), ["submitted", "pending_requirements"], "in the states' order");
});

test("Issued on a lost stage and Lost on a won stage are flagged; a clean map has nothing to check", () => {
  const by = Object.fromEntries(mapChecks(publisher, { issued: "s3", lost: "s5" }).map((c) => [c.key, c.text]));
  assert.match(by.issued, /Declined Underwriting is marked lost/);
  assert.match(by.lost, /Submitted is marked won/);
  assert.deepEqual(mapChecks(publisher, { quoted: "s1", submitted: "s4", issued: "s5", lost: "s3" }), []);
  assert.deepEqual(mapChecks(publisher, {}), []);
});

test("two states on one stage is not a step back", () => {
  assert.deepEqual(mapChecks(publisher, { quoted: "s1", application_started: "s1", requoting: "s1" }), []);
});

test("matching by name fills only exact names (case-insensitive) and never guesses", () => {
  const map = matchByName({ ...publisher, stages: [...publisher.stages, { id: "s7", name: " quoted ", stageType: "open" }] });
  assert.equal(map.submitted, "s5");
  assert.equal(map.issued, "s6");
  assert.equal(map.quoted, "s7");
  assert.equal(map.requoting, "s7", "back to quoting looks for Quoted (§6)");
  assert.equal(map.pending_requirements, null, "Pending Approval is not Pending requirements");
  assert.equal(matchCount(publisher), 2);
});

test("copying a map carries states by stage name and names the ones with no match", () => {
  const sales = { id: "p2", name: "Sales pipeline", stages: [{ id: "t1", name: "submitted", stageType: "won" }, { id: "t2", name: "Lost", stageType: "lost" }] };
  const { map, found, missing } = copyByName(publisher, live, sales, { quoted: "t2" });
  assert.deepEqual(found, ["submitted"]);
  assert.deepEqual(missing, ["pending_requirements", "issued", "lost"]);
  assert.equal(map.submitted, "t1");
  assert.equal(map.quoted, "t2", "what was there stays");
});

test("the board preview groups states by stage", () => {
  const placed = statesByStage({ quoted: "s1", requoting: "s1", issued: "s6", lost: null });
  assert.deepEqual(placed.get("s1"), ["quoted", "requoting"]);
  assert.deepEqual(placed.get("s6"), ["issued"]);
  assert.equal(placed.size, 2);
});

// Redesign 2026-10-30: what the screen and the server must keep doing.
test("Pipeline sync records to the settings history and Activity stays owner-only and read-only", () => {
  const lib = read("./stageMap.ts");
  assert.match(lib, /section: "sales-pipeline-sync"/);
  assert.match(lib, /recordSettingsChanges\(\{/);
  assert.match(read("../settingsAudit/constants.ts"), /key: "sales-pipeline-sync"/);
  const route = read("../../app/api/app/settings/sales/stage-map/activity/route.ts");
  assert.match(route, /requireFeatureRole\("applications", \["owner"\]\)/);
  // The two moves are owner writes; nothing else is.
  assert.match(route, /requireFeatureRole\("applications", \["owner"\], \{ write: true \}\)/);
  assert.doesNotMatch(route, /export async function (PUT|PATCH|DELETE)/);
  const check = read("../applications/stageSyncService.ts");
  const body = check.slice(check.indexOf("export async function pipelineSyncCheck"), check.indexOf("export async function reconcileLeadStage"));
  assert.doesNotMatch(body, /moveLead\(|\.update\(|\.insert\(|\.upsert\(|\.delete\(/, "Check cards moves nothing");
});

test("Move cards now follows the sync's rules: only due cards, never a held one, the owner as the actor", () => {
  const sync = read("../applications/stageSyncService.ts");
  const due = sync.slice(sync.indexOf("const isDue"), sync.indexOf("export async function pipelineSyncCheck"));
  assert.match(due, /state\.decision\?\.move/, "forward only and a person's move wins, as decided by shouldMove");
  assert.match(due, /!state\.unmapped && state\.targetUsable/);
  const bring = sync.slice(sync.indexOf("export async function bringPipelineUpToDate"));
  assert.match(bring, /state\.needsReconcile \|\| !isDue\(state\)\) continue;/);
  assert.match(bring, /actorUserId, applicationId: state\.targetApplicationId \}\)/, "the owner is the actor, and the attempt is named");
  assert.doesNotMatch(bring, /tenant_applications"\)\.update|\.from\("tenant_applications"\)/, "applications are never written");
  const ui = read("../../components/app/settings/sales/pipeline-sync-activity.tsx");
  assert.match(ui, /await confirmAction\(\{\n\s+title: `Move \$\{due\.length\}/, "it asks first");
  assert.match(ui, /disabled=\{Boolean\(busy\) \|\| dirty\}/, "not while the map has unsaved changes");
});

test("the screen keeps every feature: drafts per pipeline, leave guard, read-only, archived stage, pre-fill note", () => {
  const ui = read("../../components/app/settings/sales/pipeline-sync.tsx");
  const parts = read("../../components/app/settings/sales/pipeline-sync-parts.tsx");
  assert.match(ui, /<LeaveGuard dirty=\{view\.canEdit && dirty\}/);
  assert.match(ui, /<ReadOnlyNotice what="application stages" \/>/);
  assert.match(ui, /<SalesSetupPending what="Application stages" \/>/);
  assert.match(ui, /Filled in from \$\{dirtyNames\}'s stage names — nothing moves until you save\./);
  assert.match(ui, /pipeline_id: id, map: drafts\[id\]/);
  assert.match(parts, /A stage that was archived/);
  assert.match(parts, /export const UNMAPPED = "Doesn't move the card";/);
  assert.match(parts, /href=\{PIPELINES_HREF\}/);
});

// 20261030200000 (live 2026-10-30): every automatic move names the attempt behind it.
test("the history row names the attempt that moved the card", async () => {
  const { attemptForTarget } = await import("../applications/stageSync.ts");
  const a = (attemptNo, status, outcome = null, hasQuote = false) => ({ attemptNo, status, outcome, hasQuote });
  // Two live attempts: the submitted one leads, not the newer draft.
  assert.equal(attemptForTarget("submitted", [a(1, "submitted"), a(2, "draft", null, true)]), 0);
  // Back to quoting: the new live attempt after the decline.
  assert.equal(attemptForTarget("requoting", [a(1, "closed", "declined"), a(2, "draft")]), 1);
  // Lost: the last attempt.
  assert.equal(attemptForTarget("lost", [a(1, "closed", "declined"), a(2, "closed", "withdrawn")]), 1);
  assert.equal(attemptForTarget("issued", [a(1, "submitted")]), -1);
  const sync = read("../applications/stageSyncService.ts");
  assert.match(sync, /application_id: input\.applicationId \?\? null,/);
  assert.equal((sync.match(/applicationId: state\.targetApplicationId/g) ?? []).length, 3, "the sync, Put it back and Move cards now all pass it");
  assert.match(read("./stageMapActivity.ts"), /select\("lead_id, from_pipeline_id, from_stage_id, to_stage_id, actor_user_id, application_id, created_at"\)/);
});
