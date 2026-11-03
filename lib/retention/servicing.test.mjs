// LA-5.4 (Notion sprint) · servicing requests, as plain rules, plus the migration's promises.
// Run with: node --experimental-strip-types --test lib/retention/servicing.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canStep, describeChange, fieldChanges, NEXT_STEPS, REQUEST_FOR_FIX, REQUEST_TYPES, ServicingRuleError, STATUSES, unprovableText } from "./servicing.ts";
import { PLATFORM_DEFAULT_SETTINGS as SETTINGS } from "./constants.ts";
import { buildQueue } from "./queue.ts";
import { TARGET_FIELDS } from "../ingestion/layout.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/20261014200000_la_5_4_servicing_requests.sql");

test("all four request types build the field changes the next file has to show", () => {
  assert.deepEqual(fieldChanges({ type: "draft_date_change", currentDraftDay: 3, targetDraftDay: 22 }), [{ field: "draft_day", from: "3", to: "22" }]);
  assert.deepEqual(fieldChanges({ type: "payment_method_change", currentMethod: "direct_express", toMethod: "bank_draft", accountLast4: null }), [{ field: "payment_method", from: "direct_express", to: "bank_draft" }]);
  assert.deepEqual(fieldChanges({ type: "payment_method_change", currentMethod: "bank_draft", toMethod: null, accountLast4: "4821" }), [{ field: "bank_account_last4", from: null, to: "4821" }]);
  assert.deepEqual(fieldChanges({ type: "bill_to_draft_conversion", targetDraftDay: 22 }), [{ field: "payment_method", from: "direct_bill", to: "bank_draft" }, { field: "draft_day", from: null, to: "22" }]);
  assert.deepEqual(fieldChanges({ type: "address_change", address: "  12  Oak St ", zip: "73301", state: "tx" }), [
    { field: "insured_address", from: null, to: "12 Oak St" }, { field: "insured_zip", from: null, to: "73301" }, { field: "insured_state", from: null, to: "TX" },
  ]);
});

test("a draft day is never above the 28th, and never the day it already is", () => {
  assert.throws(() => fieldChanges({ type: "draft_date_change", currentDraftDay: 3, targetDraftDay: 29 }), ServicingRuleError);
  assert.throws(() => fieldChanges({ type: "draft_date_change", currentDraftDay: 3, targetDraftDay: 0 }), ServicingRuleError);
  assert.throws(() => fieldChanges({ type: "draft_date_change", currentDraftDay: 22, targetDraftDay: 22 }), ServicingRuleError);
  assert.throws(() => fieldChanges({ type: "bill_to_draft_conversion", targetDraftDay: 31 }), ServicingRuleError);
  assert.match(sql, /target_draft_day between 1 and 28/);
});

test("only the last four digits of an account are ever recorded", () => {
  assert.throws(() => fieldChanges({ type: "payment_method_change", currentMethod: "bank_draft", toMethod: null, accountLast4: "123456789" }), ServicingRuleError);
  assert.throws(() => fieldChanges({ type: "payment_method_change", currentMethod: "bank_draft", toMethod: null, accountLast4: null }), ServicingRuleError);
});

test("a person moves a request forward; verified and failed are never a person's step", () => {
  for (const from of STATUSES) {
    assert.equal(canStep(from, "verified_in_file"), false, `${from} → verified`);
    assert.equal(canStep(from, "failed"), false, `${from} → failed`);
  }
  assert.equal(canStep("draft", "submitted"), true);
  assert.equal(canStep("submitted", "confirmed_by_carrier"), true);
  assert.equal(canStep("confirmed_by_carrier", "submitted"), false);
  assert.deepEqual(NEXT_STEPS.verified_in_file, []);
  assert.deepEqual(NEXT_STEPS.failed, []);
  // The database enforces the same: only the verifier may set verified_in_file or failed.
  assert.match(sql, /if new\.status in \('verified_in_file', 'failed'\) then\s+if not v_verifier/);
  assert.match(sql, /perform set_config\('app\.servicing_verifier', 'on', true\);/);
});

test("the save queue's fixes open the matching request; beneficiary, coverage and cancellation are not offered", () => {
  assert.equal(REQUEST_FOR_FIX.move_draft_date, "draft_date_change");
  assert.equal(REQUEST_FOR_FIX.convert_to_draft, "bill_to_draft_conversion");
  assert.equal(REQUEST_FOR_FIX.review_coverage, undefined);
  assert.deepEqual([...REQUEST_TYPES].sort(), ["address_change", "bill_to_draft_conversion", "draft_date_change", "payment_method_change"]);
  for (const word of ["beneficiary", "coverage_change", "cancellation"]) assert.doesNotMatch(sql, new RegExp(`'${word}'`));
});

test("a draft day can be mapped from a carrier file, so a draft-date change can be proven", () => {
  assert.ok(TARGET_FIELDS.policies.some((f) => f.key === "draft_day" && f.dataType === "integer"));
  // The verifier reads it from the snapshot's extra fields.
  assert.match(sql, /v_snap\.extra->'fields'->>v_field/);
});

test("a field the file can't show waits and says so; it never fails and is never verified", () => {
  assert.equal(unprovableText(["draft_day"], "Americo"), "Americo's file doesn't show the draft day, so this can't be verified from it.");
  assert.equal(unprovableText([], "Americo"), null);
  // In the verifier: a null value is unprovable, and only a mismatch past the deadline fails.
  assert.match(sql, /if v_have is null then\s+v_all_match := false;\s+v_unprovable := v_unprovable \|\| to_jsonb\(v_field\);/);
  assert.match(sql, /if v_mismatch_field is not null and current_date > v_deadline then/);
});

test("a failure alerts whoever asked, and the self-check runs the job once and rolls it back", () => {
  assert.match(sql, /insert into public\.agent_notifications .*'servicing_failed'/s);
  assert.match(sql, /raise exception using errcode = 'P0099';\s+exception when sqlstate 'P0099' then null;/);
  assert.match(sql, /revoke delete, truncate on public\.servicing_request from service_role, tenant_app;/);
});

test("how a change reads", () => {
  assert.equal(describeChange({ field: "draft_day", from: "3", to: "22" }), "Draft day 3 → 22");
  assert.equal(describeChange({ field: "payment_method", from: "direct_bill", to: "bank_draft" }), "Payment method direct bill → bank draft");
  assert.equal(describeChange({ field: "insured_zip", from: null, to: "73301" }), "ZIP → 73301");
});

const card = (over = {}) => ({ key: "c|1", score: 80, band: "critical", confidence: "high", status: "active", daysPastDue: 0, boardReason: null, lastAttempt: null, hold: null, atRiskCents: 40000, nextDraftDays: 5, monthsSinceIssue: 2, failedFix: null, ...over });

test("a failed fix puts the policy back on the save queue first, whatever its band, confidence or hold — never over an emergency", () => {
  const q = buildQueue([
    card({ key: "sure" }),
    card({ key: "failed-low", band: "low", score: 10, confidence: "low", failedFix: "The draft date change was sent on 2 Oct…", hold: { kind: "dismiss", until: null, score: 90 } }),
    card({ key: "failed-past-due", failedFix: "…", daysPastDue: 4 }),
  ], SETTINGS, "2026-10-14");
  assert.deepEqual(q.cards.map((c) => c.key), ["failed-low", "sure"]);
});
