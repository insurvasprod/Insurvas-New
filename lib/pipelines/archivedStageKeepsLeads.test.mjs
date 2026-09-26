/**
 * LA-1.9-6: archiving a stage that holds leads keeps those leads displaying and removes the stage
 * from every picker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const views = read("components", "app", "pipeline-views.tsx");
const workspace = read("components", "app", "lead-workspace.tsx");
const leadDetail = read("lib", "leadWorkspace", "service.ts");

test("the grouped list keeps an archived stage's leads, after the live stages and labelled", () => {
  assert.match(views, /\.\.\.pipeline\.stages\.filter\(\(stage\) => stage\.is_archived\)\.sort/);
  assert.match(views, /\$\{stage\.is_archived \? " \(archived\)" : ""\}/);
  assert.match(views, /\)\.filter\(\(group\) => group\.items\.length > 0\);/, "an archived stage with no leads is not shown");
});

test("the table names an archived stage instead of calling it Unmapped; the board keeps its column", () => {
  assert.match(workspace, /entry\.stage\.is_archived \? `\$\{entry\.stage\.name\} \(archived\)` : entry\.stage\.name/);
  assert.match(workspace, /const unmapped = leads\.filter\(\(lead\) => !live\.has\(lead\.stage_id\)\);/);
});

test("pickers offer live stages only; the lead page still reads the archived stage it sits on", () => {
  assert.match(leadDetail, /\.eq\("id", lead\.stage_id\)\.maybeSingle\(\)/);
  assert.match(leadDetail, /\.eq\("pipeline_id", lead\.pipeline_id\)\.eq\("is_archived", false\)\.order\("position"\)/);
  assert.match(views, /const live = pipeline\.stages\.filter\(\(stage\) => !stage\.is_archived\)/, "quick-move options");
  assert.match(workspace, /filterStages = useMemo[\s\S]{0,200}!entry\.stage\.is_archived/);
});
