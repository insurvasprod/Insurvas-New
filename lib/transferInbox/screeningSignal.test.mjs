import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SCREENING_FILTER_OPTIONS, screeningSignal } from "./constants.ts";

const label = (input) => screeningSignal(input).label;

test("the inbox's screening pill, in order of precedence", () => {
  assert.equal(label({ screeningOutcome: "dnc", preflightStatus: "already_customer", duplicateWarning: true }), "Needs review");
  assert.equal(screeningSignal({ screeningOutcome: "dnc" }).tone, "error");
  assert.equal(label({ screeningOutcome: "internal_dq", preflightStatus: "new_household" }), "Duplicate");
  assert.equal(label({ screeningOutcome: "clear", preflightStatus: "spoken_before" }), "Duplicate");
  assert.equal(label({ screeningOutcome: "clear", preflightStatus: "already_customer" }), "Duplicate");
  assert.equal(label({ screeningOutcome: "clear", preflightStatus: "new_household", duplicateWarning: true }), "Duplicate");
  assert.equal(screeningSignal({ screeningOutcome: "internal_dq" }).tone, "warning");
  assert.equal(label({ screeningOutcome: "clear", preflightStatus: "new_household", duplicateWarning: false }), "DNC clear");
  assert.equal(screeningSignal({ screeningOutcome: "clear" }).tone, "success");
  assert.equal(label({ screeningOutcome: "not_checked", preflightStatus: "not_checked" }), "Not checked");
  assert.equal(label({ screeningOutcome: "" }), "Not checked");
  assert.equal(label({ screeningOutcome: null }), "Not checked");
});

test("the screening filter offers the values the data actually holds", async () => {
  const check = await readFile(new URL("../../supabase/migrations/20260902160000_la_1_5_screening_service.sql", import.meta.url), "utf8");
  const stored = check.match(/screening_outcome in \(([^)]*)\)/)?.[1].split(",").map((value) => value.trim().replace(/'/g, "")) ?? [];
  assert.deepEqual([...SCREENING_FILTER_OPTIONS.map((option) => option.value)].sort(), [...stored, "not_checked"].sort());
});

test("the service labels every row, and Agent Floor keeps the fields it already read", async () => {
  const service = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(service, /screening: screeningSignal\(\{ screeningOutcome: row\.screening_outcome, preflightStatus: row\.preflight_status, duplicateWarning: row\.duplicate_warning \}\)/);
  for (const field of ["screeningOutcome: row.screening_outcome", "screeningWarning: row.screening_warning", "duplicateWarning: row.duplicate_warning", "preflightStatus: row.preflight_status"]) assert.ok(service.includes(field), field);
});
