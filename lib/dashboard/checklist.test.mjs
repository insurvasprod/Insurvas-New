import { test } from "node:test";
import assert from "node:assert/strict";
import { setupChecklistForState, setupStepDefinitions } from "./checklist.ts";

test("unfinished onboarding keeps the five-step checklist actionable", () => {
  const checklist = setupChecklistForState("not_started");
  assert.equal(checklist.complete, false);
  assert.equal(checklist.completed, 0);
  assert.equal(checklist.total, 5);
  assert.equal(checklist.steps.every((step) => !step.complete), true);
  assert.equal(checklist.steps.every((step) => step.path === "/app/settings"), true);
  assert.equal(checklist.steps.every((step) => step.label.length > 0), true);
});

test("completed onboarding removes the checklist and marks every step complete", () => {
  const checklist = setupChecklistForState("completed");
  assert.equal(checklist.complete, true);
  assert.equal(checklist.completed, setupStepDefinitions().length);
  assert.equal(checklist.steps.every((step) => step.complete), true);
});
