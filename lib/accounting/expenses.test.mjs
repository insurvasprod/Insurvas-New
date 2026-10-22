// LA-7.3 (Notion sprint, Module 7 — Accounting) · platform and tool expenses.
// Run with: node --experimental-strip-types --test lib/accounting/expenses.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACQUISITION_CONSEQUENCE, acquisitionFor, DEFAULT_ACQUISITION, entryTypeFor, EXPENSE_CATEGORIES, readDefaults } from "./expensesCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015220000_la_7_3_expenses.sql";

test("all eight categories exist in code and database, each booking as one ledger type", () => {
  assert.deepEqual([...EXPENSE_CATEGORIES], ["software", "telephony", "data_services", "insurance", "professional_fees", "licensing", "office", "other"]);
  const sql = read(MIGRATION);
  assert.match(sql, new RegExp(`category in \\(${EXPENSE_CATEGORIES.map((c) => `'${c}'`).join(", ")}\\)`));
  assert.deepEqual(EXPENSE_CATEGORIES.map(entryTypeFor), ["tool_subscription", "tool_subscription", "tool_subscription", "insurance", "professional_fee", "professional_fee", "tool_subscription", "tool_subscription"]);
  // The TS mapping and the SQL one are the same mapping.
  assert.match(sql, /when 'insurance' then 'insurance'\n\s+when 'professional_fees' then 'professional_fee'\n\s+when 'licensing' then 'professional_fee'\n\s+else 'tool_subscription'/);
});

test("acquisition defaults by category, is overridable per expense, and the override is visible", () => {
  assert.deepEqual(acquisitionFor("telephony", DEFAULT_ACQUISITION), { isAcquisitionCost: true, overridden: false });
  assert.deepEqual(acquisitionFor("insurance", DEFAULT_ACQUISITION), { isAcquisitionCost: false, overridden: false });
  assert.deepEqual(acquisitionFor("insurance", DEFAULT_ACQUISITION, true), { isAcquisitionCost: true, overridden: true });
  assert.deepEqual(acquisitionFor("telephony", DEFAULT_ACQUISITION, true), { isAcquisitionCost: true, overridden: false }, "choosing the default is not an override");
  // The agency's own defaults win over the shipped ones.
  assert.deepEqual(acquisitionFor("office", readDefaults({ office: true, nonsense: false })), { isAcquisitionCost: true, overridden: false });
  assert.equal(readDefaults({ software: "yes" }).software, true, "a malformed value falls back to the shipped default");
  // The shipped defaults in code are the migration's column default.
  const sql = read(MIGRATION);
  const m = /'(\{"software": true[^']*\})'::jsonb/.exec(sql);
  assert.deepEqual(JSON.parse(m[1]), DEFAULT_ACQUISITION);
  assert.equal(ACQUISITION_CONSEQUENCE, "Acquisition costs divide into cost per policy. Overhead does not.");
  assert.match(read("components/app/accounting/expenses-board.tsx"), /\{ACQUISITION_CONSEQUENCE\}/);
  assert.match(read("components/app/accounting/expenses-board.tsx"), /Overrides the category default/);
});

test("a recurring template makes unconfirmed instances that book nothing until confirmed", () => {
  const sql = read(MIGRATION);
  const gen = sql.slice(sql.indexOf("create or replace function public.generate_recurring_expenses"), sql.indexOf("do $$\nbegin\n  if exists (select 1 from pg_extension"));
  assert.match(gen, /'unconfirmed', t\.is_acquisition_cost/);
  assert.doesNotMatch(gen, /cost_entry|record_cost_entry/, "generation never touches the ledger");
  assert.match(sql, /on conflict \(parent_expense_id, incurred_on\) where parent_expense_id is not null do nothing;/);
  const confirm = sql.slice(sql.indexOf("create or replace function public.confirm_expense"), sql.indexOf("create or replace function public.void_expense"));
  assert.match(confirm, /if x\.status <> 'unconfirmed' then/);
  assert.match(confirm, /v_entry := public\.record_cost_entry\(/);
  assert.match(sql, /perform cron\.schedule\('la7-recurring-expenses', '0 5 \* \* \*'/);
});

test("changing a template reaches future instances only; a booked expense is history", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /An instance copies the template as it is\n-- when the instance is made/);
  assert.match(sql, /raise exception 'A confirmed expense is history: void it and enter it again\.'/);
  assert.match(sql, /raise exception 'An expense is never removed: void it, or end a recurring one\.'/);
  assert.match(sql, /revoke delete, truncate on public\.expense from service_role;/);
});

test("no expense is attributed to a campaign or a policy", () => {
  const sql = read(MIGRATION);
  const table = sql.slice(sql.indexOf("create table if not exists public.expense ("), sql.indexOf("create unique index if not exists expense_one_per_period"));
  assert.doesNotMatch(table, /campaign_id|policy_number|vendor_id/);
  const confirm = sql.slice(sql.indexOf("create or replace function public.confirm_expense"), sql.indexOf("create or replace function public.void_expense"));
  assert.doesNotMatch(confirm, /campaign_id|policy_number/);
});

test("receipts are tenant-scoped behind 60-second links; owner and bookkeeper only", () => {
  const store = read("lib/accounting/expenseStore.ts");
  assert.match(store, /const path = `\$\{tenantId\}\/expenses\/\$\{id\}\/\$\{crypto\.randomUUID\(\)\}-\$\{safeName\}`;/);
  assert.match(store, /if \(!path \|\| !path\.startsWith\(`\$\{tenantId\}\/expenses\/\$\{id\}\/`\)\)/);
  assert.match(store, /createSignedUrl\(path, 60\)/);
  for (const f of ["app/api/app/accounting/expenses/route.ts", "app/api/app/accounting/expenses/[id]/route.ts"]) {
    assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "bookkeeper"], f);
    assert.match(read(f), /requireFeatureRole\("profit_and_loss", ROLES/, f);
  }
});
