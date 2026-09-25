import assert from "node:assert/strict";
import test from "node:test";

import { setupChecklistForState, setupStepDefinitions } from "./checklist.ts";
import { ONBOARDING_COMPLETE_STATES } from "../signup/constants.ts";

test("the checklist is five labelled steps, and the definitions agree with it", () => {
  const checklist = setupChecklistForState("pending");
  assert.equal(checklist.total, 5);
  assert.equal(checklist.steps.length, 5);
  assert.equal(setupStepDefinitions().length, checklist.total);
  assert.ok(checklist.steps.every((step) => step.label.length > 0), "every step needs a label");
  assert.ok(checklist.steps.every((step) => step.key.length > 0), "every step needs a key");
});

/**
 * `tenants.onboarding_state` holds two spellings of the finished state. On 2026-09-22 the live
 * distribution was `complete` 383, `completed` 197, `ready_for_checkout` 5, `pending` 1.
 *
 * The checklist compared against `"completed"` alone, so the 383 tenants stored as `"complete"`
 * were told they had finished 0 of 5 setup steps — every step outstanding — indefinitely. These
 * tests fail if either spelling stops counting.
 */
test("both spellings of the finished state complete the checklist", () => {
  for (const state of ONBOARDING_COMPLETE_STATES) {
    const checklist = setupChecklistForState(state);
    assert.equal(checklist.complete, true, `${state} should be complete`);
    assert.equal(checklist.completed, checklist.total, `${state} should be ${checklist.total}/${checklist.total}`);
    assert.ok(
      checklist.steps.every((step) => step.complete),
      `${state} should mark every step complete`,
    );
  }
});

test("a tenant still in the middle of onboarding is not marked complete", () => {
  for (const state of ["pending", "business_profile", "ready_for_checkout", "awaiting_payment"]) {
    const checklist = setupChecklistForState(state);
    assert.equal(checklist.complete, false, `${state} should not be complete`);
    assert.equal(checklist.completed, 0, `${state} should report no completed steps`);
  }
});

test("every step points somewhere more specific than the settings index", () => {
  // The steps used to all point at `/app/settings`, which renders ten tabs.
  for (const step of setupChecklistForState("pending").steps) {
    assert.notEqual(step.path, "/app/settings", `${step.key} should name its tab or owning screen`);
    assert.ok(step.path.startsWith("/app/"), `${step.key} should be an in-app destination`);
  }
});
