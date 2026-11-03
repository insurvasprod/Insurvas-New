// A plan picked on the pricing page is not asked for again (manager review, 2026-10-28, 03:43).
// signup_selections always has a plan, so "chosen" is its own column (20261028210000). These read the
// source: the queries are server-only and talk to the database.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("the column exists and starts empty for the default plan", () => {
  const sql = read("supabase/migrations/20261028210000_signup_plan_chosen_at.sql");
  assert.match(sql, /add column if not exists plan_chosen_at timestamptz;/);
  assert.doesNotMatch(sql, /update public\.signup_selections/, "existing rows are not guessed: their owners see the chooser once");
});

test("it is set only when the person picked the plan", () => {
  assert.match(read("app/api/public/signup/route.ts"), /if \(input\.planCode\) await markPlanChosen\(created\.tenant_id\);/);
  assert.match(read("app/api/public/signup/google/route.ts"), /if \(google\.plan && plan\.code === google\.plan\) await markPlanChosen\(created\.tenant_id\);/);
  const queries = read("lib/signup/planChoiceQueries.ts");
  assert.match(queries, /Could not save your plan[^\n]*\n[^\n]*\n\s*await markPlanChosen\(tenantId\);/, "saving the chooser marks it");
});

test("reading it falls back to 'not chosen' when the column is missing", () => {
  const queries = read("lib/signup/planChoiceQueries.ts");
  assert.match(queries, /chosen: !chosen\.error && Boolean\(/);
  assert.match(queries, /if \(error && !notApplied\(error\)\) console\.error\("\[plan choice\] plan_chosen_at not saved"/);
});
