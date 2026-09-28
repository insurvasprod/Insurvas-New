import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isApplicationOutcome, outcomeDescription } from "./applicationOutcome.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const stage = (over = {}) => ({ id: "s-won", name: "Submitted", stage_type: "won", pipeline_id: "p1", pipeline_name: "Live transfers", ...over });

test("an application is read from the mapped stage and the outcome's flags, never a key", () => {
  assert.equal(isApplicationOutcome({ label: "Application submitted", closes_as: "completed", counts_as_work_completed: true }, stage()), true);
  // An open stage still records an application when the outcome counts as work completed.
  assert.equal(isApplicationOutcome({ label: "Sent to underwriting", closes_as: "completed", counts_as_work_completed: true }, stage({ stage_type: "open" })), true);
  // A won stage makes it one even if the flag was never set.
  assert.equal(isApplicationOutcome({ label: "Sold", closes_as: "completed", counts_as_work_completed: false }, stage()), true);
  assert.equal(isApplicationOutcome({ label: "Not interested", closes_as: "completed", counts_as_work_completed: false }, stage({ stage_type: "lost" })), false);
  assert.equal(isApplicationOutcome({ label: "Callback", closes_as: "completed", counts_as_work_completed: false }, stage({ stage_type: "open" })), false);
  // A dropped close is never an application.
  assert.equal(isApplicationOutcome({ label: "Call dropped", closes_as: "dropped", counts_as_work_completed: true }, stage()), false);
});

test("the option description says where the lead lands and how the transfer closes", () => {
  const current = { stageId: "s-new", pipelineId: "p1" };
  assert.equal(outcomeDescription({ label: "x", closes_as: "completed", counts_as_work_completed: false }, stage(), current), "Moves the lead to Submitted");
  assert.equal(outcomeDescription({ label: "x", closes_as: "dropped", counts_as_work_completed: false }, stage({ name: "Incomplete Transfer" }), current), "Closes the transfer · moves to Incomplete Transfer");
  assert.equal(outcomeDescription({ label: "x", closes_as: "completed", counts_as_work_completed: false }, stage({ id: "s-new", name: "New Transfer" }), current), "Keeps the lead in New Transfer");
  assert.equal(outcomeDescription({ label: "x", closes_as: "completed", counts_as_work_completed: false }, stage({ pipeline_id: "p2", pipeline_name: "Sold" }), current), "Moves the lead to Submitted in Sold");
});

test("the server refuses an application outcome before anything is written", async () => {
  const route = await read("app/api/app/inbound/disposition/route.ts");
  const gateAt = route.indexOf("await assertApplicationOutcomeVerified(");
  const completeAt = route.indexOf("await completeDisposition(");
  assert.ok(gateAt > 0 && completeAt > gateAt, "the verification gate must run before completeDisposition");
  assert.match(route, /"verification_incomplete"/);

  const gate = await read("lib/dispositions/applicationGate.ts");
  assert.match(gate, /isApplicationOutcome\(outcome, outcome\.mapped_stage\)/);
  assert.match(gate, /new DispositionError\(\s*"verification_incomplete"/);
  for (const key of ["application_submitted", "sent_to_underwriting"]) assert.ok(!gate.includes(key), `the gate names ${key}`);

  // The wizard keeps "Record outcome" open: it does not decide the gate itself.
  const wizard = await read("components/app/disposition-wizard.tsx");
  assert.ok(!/application_submitted|sent_to_underwriting/.test(wizard));
  assert.doesNotMatch(wizard, /disabled=\{[^}]*needs_verification/);
});

test("only mapped outcomes are offered, and the old false copy is gone", async () => {
  const route = await read("app/api/app/inbound/disposition/route.ts");
  assert.match(route, /listMappedOutcomes\(tenantId\)/);
  const wizard = await read("components/app/disposition-wizard.tsx");
  assert.match(wizard, /wizard\.outcomeOptions/);
  assert.match(wizard, /\/app\/settings#dispositions/);
  assert.doesNotMatch(wizard, /call recording/i);
  assert.doesNotMatch(wizard, /What recording this will do/);
  assert.doesNotMatch(wizard, /disclosures/i);
  // UI consistency standard (2026-09-28): no explainer copy under the wizard's panels.
  assert.doesNotMatch(wizard, /Your answer decides the next question/);
  assert.doesNotMatch(wizard, /Check the outcome before you record it/);
});
