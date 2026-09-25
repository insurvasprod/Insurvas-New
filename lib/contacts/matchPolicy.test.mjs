import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { dobConflict, isConfidentMatch, planForMatches } from "./matchPolicy.ts";

const match = (over = {}) => ({ score: 0.9, confidence: "high", matched_on: ["phone", "dob", "name"], dob: "1958-03-14", ...over });

test("auto-merge needs high confidence, both DOBs equal, and a phone or address match", () => {
  assert.equal(isConfidentMatch("1958-03-14", match()), true);
  assert.equal(isConfidentMatch("1958-03-14", match({ matched_on: ["address", "dob", "name"] })), true);
  assert.equal(isConfidentMatch("1958-03-14", match({ confidence: "medium" })), false, "medium never merges alone");
  assert.equal(isConfidentMatch(null, match()), false, "no incoming DOB");
  assert.equal(isConfidentMatch("1958-03-14", match({ dob: null })), false, "no existing DOB");
  assert.equal(isConfidentMatch("1958-03-14", match({ matched_on: ["dob", "name"] })), false, "DOB and name alone");
});

test("a DOB conflict caps a match at review whatever the score", () => {
  const spouse = match({ score: 0.95, dob: "1961-07-02", matched_on: ["phone", "address", "name"] });
  assert.equal(dobConflict("1958-03-14", spouse), true);
  assert.equal(isConfidentMatch("1958-03-14", spouse), false);
  const plan = planForMatches("1958-03-14", [spouse]);
  assert.equal(plan.auto, null);
  assert.equal(plan.queue.length, 1);
});

test("everything medium or high is queued; low is ignored; only the best may auto-merge", () => {
  const best = match();
  const second = match({ score: 0.7, confidence: "medium" });
  const low = match({ score: 0.5, confidence: "low" });
  const plan = planForMatches("1958-03-14", [best, second, low]);
  assert.equal(plan.auto, best);
  assert.deepEqual(plan.queue, [best, second]);
  const weakTop = planForMatches("1958-03-14", [match({ matched_on: ["dob", "name"] }), best]);
  assert.equal(weakTop.auto, null, "a qualifying runner-up does not merge past a better-scored doubt");
});

test("the SQL lead link applies the same auto-merge test", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/20260924326100_duplicate_check_functions.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("create or replace function public.link_leads_to_contacts"));
  assert.match(body, /m\.confidence = 'high'/);
  assert.match(body, /m\.dob = it\.dob/);
  assert.match(body, /it\.dob is not null/);
  assert.match(body, /'phone' = any\(m\.matched_on\) or 'address' = any\(m\.matched_on\)/);
  assert.match(body, /l\.contact_id is null/, "never overwrites a link");
  assert.doesNotMatch(body, /insert into public\.contacts/, "never creates a contact");
});

test("matching never returns a merged-away contact, and undo refuses when a later merge is in place", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/20260924326100_duplicate_check_functions.sql", import.meta.url), "utf8");
  const find = sql.slice(sql.indexOf("create or replace function public.find_contact_duplicates"), sql.indexOf("-- ── 2. merge_contacts"));
  assert.match(find, /from public\.contact_phones cp\s+join public\.contacts pc[\s\S]*?pc\.merged_into_id is null/);
  assert.match(find, /join public\.contacts c\s+on c\.id = ids\.id[\s\S]*?c\.merged_into_id is null/);
  const undo = sql.slice(sql.indexOf("create or replace function public.undo_contact_merge"), sql.indexOf("-- ── 4a."));
  assert.ok(undo.indexOf("for update;", undo.indexOf("from public.contacts")) < undo.indexOf("Undo the later merge first"), "locks the contacts before checking");
  assert.match(undo, /m\.reversed_at is null and m\.id <> log_row\.id/);
});
