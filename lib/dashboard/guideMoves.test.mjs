// Run with: npm test
//
// Guided setup (owner, 2026-11-12/13): every Get set up step has a script of moves, each naming the control
// by its label, and the guide moves on when the person acts. DB-free: pure functions and source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { guideMovesFor, guideShotsFor, isRequiredStep, resolveMove, scriptedGuideSteps, shotLabel } from "./guideMoves.ts";
import { isSetupStepKey, setupChecklistForState } from "./checklist.ts";

test("every scripted step is a real setup step", () => {
  for (const key of scriptedGuideSteps()) assert.ok(isSetupStepKey(key), `${key} is not a setup step`);
});

test("every owner step has moves, and only the last may wait for its fact", () => {
  const steps = setupChecklistForState("pending").steps;
  assert.ok(steps.length > 10);
  for (const step of steps) {
    const moves = guideMovesFor(step);
    assert.ok(moves.length > 0, step.key);
    moves.forEach((move, index) => {
      assert.ok(move.say.length > 0, `${step.key} move ${index + 1} says something`);
      if (move.advance === "done") assert.equal(index, moves.length - 1, `${step.key}: "done" is only the last move`);
    });
  }
});

test("every move target exists as a data-guide on a screen", () => {
  const files = [
    "components/app/settings/contracting-setup.tsx", "components/app/campaign-workspace.tsx", "components/app/lead-import-workspace.tsx",
    "components/app/partners-workspace.tsx", "components/app/team-settings.tsx", "components/app/calling-window-settings.tsx",
    "components/app/assignment-workspace.tsx", "components/app/settings/pipelines-outcomes.tsx", "components/app/queue-sla-settings.tsx",
    "components/app/dialer-workspace.tsx", "components/app/inbound/inbound-home.tsx", "components/app/statement-import.tsx",
    "components/app/book-import.tsx", "components/app/book/setup/files-in-import-dialog.tsx", "components/app/agency/hierarchy-manager-dialog.tsx",
    "components/app/settings/agency-contact.tsx", "components/app/retention/retention-settings-board.tsx", "components/app/accounting/accounting-settings-board.tsx",
    "components/app/settings/sales/disclosures.tsx", "components/app/compliance/compliance-settings.tsx",
  ].map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");
  for (const key of scriptedGuideSteps()) {
    for (const move of guideMovesFor({ key, instruction: "" })) {
      for (const target of [move.target, move.until].filter(Boolean)) {
        const needle = target.startsWith("#") ? `id="${target.slice(1)}"` : `data-guide="${target}"`;
        assert.ok(files.includes(needle), `${key}: no ${needle}`);
      }
      if (move.advance === "appear") assert.ok(move.until, `${key}: an "appear" move names what appears`);
    }
  }
});

test("Ready to sell is required; Fine-tune later is optional", () => {
  const steps = setupChecklistForState("pending").steps;
  assert.equal(isRequiredStep(steps.find((step) => step.key === "carriers")), true);
  assert.equal(isRequiredStep(steps.find((step) => step.key === "outcomes")), false);
});

test("arriving mid-way jumps to the first later move whose control is on screen", () => {
  const moves = guideMovesFor({ key: "states", instruction: "" });
  const on = (targets) => (target) => targets.includes(target);
  assert.equal(resolveMove(moves, 0, on(["carriers-setup-next"])), 0, "stays while its own control is there");
  assert.equal(resolveMove(moves, 0, on(["states-setup-list", "states-setup-finish"])), 1, "the set-up is already on its states step");
  assert.equal(resolveMove(moves, 1, on([])), 1, "nothing there yet: waits");
});

test("every move has its picture for the Docs page (R4 D3), and clicks name their control", () => {
  for (const key of scriptedGuideSteps()) {
    const moves = guideMovesFor({ key, instruction: "" });
    assert.equal(guideShotsFor(key).length, moves.length, `${key}: one picture per move`);
    for (const move of moves) assert.ok(move.shot, `${key}: "${move.say}" has a picture`);
  }
  assert.equal(shotLabel("Click Next: Set Up States"), "Next: Set Up States");
  assert.equal(shotLabel("Fill in the company, then click Add publisher"), "Add publisher");
  assert.equal(shotLabel("Click Set up on your sales pipeline"), "Set up");
  assert.equal(shotLabel("Tick each carrier you're contracted with"), null);
});
