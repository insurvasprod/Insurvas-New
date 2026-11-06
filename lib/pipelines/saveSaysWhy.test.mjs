// Settings › Pipelines & outcomes (owner 2026-11-05: "Save changes doesn't work"): Callout no longer draws on the
// page, so a save blocked by a problem (a stage or outcome with no name, two stages with one name) or a failed
// save looked like a dead button. Save now stays pressable, opens what needs fixing, and the reason sits beside it.
// Run with: node --test lib/pipelines/saveSaysWhy.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "components/app/settings/pipelines-outcomes.tsx"), "utf8").replace(/\r\n/g, "\n");

test("Save is never disabled by a problem, only by having nothing to save or a save in flight", () => {
  assert.match(page, /onClick=\{\(\) => void save\(\)\} disabled=\{!dirty \|\| saving\}/);
  assert.doesNotMatch(page, /disabled=\{!dirty \|\| saving \|\| problems\.length > 0\}/);
});

test("pressing Save with a problem opens the item to fix and says why", () => {
  assert.match(page, /if \(problems\.length\) \{[\s\S]*?setPicked\(\{ kind: "stage", id: unnamedStage\.id \}\)[\s\S]*?notify\.block\(problems\[0\]\);/);
});

test("the reason a save can't go through, or failed, is drawn beside Save, not as a Callout", () => {
  assert.match(page, /\{saveError \?\? \(dirty && problems\.length \? problems\[0\] :/);
  assert.doesNotMatch(page, /\{problems\.length > 0 && dirty && <Callout/);
  assert.doesNotMatch(page, /\{saveError && <Callout/);
});
