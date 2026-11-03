// LA-7.9 (Notion sprint, Module 7 — Accounting) · accounting settings.
// Run with: node --experimental-strip-types --test lib/accounting/settings.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ACCOUNTING_DEFAULTS, COLUMNS, diff, fromRow, LOCKED } from "./settingsCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const la7Sql = readdirSync(join(root, "supabase/migrations")).filter((f) => /_la_7_/.test(f)).map((f) => read(`supabase/migrations/${f}`)).join("\n");

test("every setting has one column, and the defaults in code are the migrations' column defaults", () => {
  for (const [key, column] of Object.entries(COLUMNS)) {
    // Declared by "add column" in a later task, or in the table itself (7.2).
    const m = new RegExp(`\\n\\s+(?:add column if not exists )?${column} (bigint|integer|text\\[\\]|text|boolean|jsonb)(?: not null)?(?: default\\s+([^,;\\n]+))?`).exec(la7Sql);
    assert.ok(m, `${column} is a column`);
    const sqlDefault = m[2]?.trim();
    const code = ACCOUNTING_DEFAULTS[key];
    if (column === "acquisition_defaults") assert.deepEqual(JSON.parse(/add column if not exists acquisition_defaults jsonb not null default\s+'(\{[^']*\})'::jsonb/.exec(la7Sql)[1]), code);
    else if (sqlDefault === undefined) assert.equal(code, null, `${column} has no default`);
    else if (column === "tax_id_viewer_roles") assert.deepEqual(code, ["owner"]);
    else if (/^'/.test(sqlDefault)) assert.equal(`'${code}'`, sqlDefault, column);
    else if (/^(true|false)$/.test(sqlDefault)) assert.equal(String(code), sqlDefault, column);
    else assert.equal(code, Number(sqlDefault), column);
  }
});

test("a missing or malformed row reads as the defaults; the owner can always see tax IDs", () => {
  assert.deepEqual(fromRow(null), ACCOUNTING_DEFAULTS);
  const r = fromRow({ default_basis: "weird", persistency_month: 7, sample_threshold: "x", tax_id_viewer_roles: ["bookkeeper"], payout_auto_publish: "yes" });
  assert.equal(r.defaultBasis, "accrual");
  assert.equal(r.persistencyMonth, 9);
  assert.equal(r.sampleThreshold, 10);
  assert.deepEqual(r.taxIdViewerRoles, ["owner"]);
  assert.equal(r.payoutAutoPublish, false, "auto-publish only on an explicit true");
  assert.equal(ACCOUNTING_DEFAULTS.payoutAutoPublish, false, "auto-publish defaults off");
});

test("no LA-7 store hard-codes a threshold, horizon, cadence or tax figure: they read the settings", () => {
  for (const f of ["lib/accounting/pnlStore.ts", "lib/accounting/taxStore.ts", "lib/accounting/producerStore.ts", "lib/accounting/invoiceStore.ts"]) {
    const src = read(f);
    assert.match(src, /fromRow\(/, f);
    assert.doesNotMatch(src, /\?\? (5000|10|9|200000|21)\b|: 9\)|\b200000\b|"monthly"/, f);
  }
});

test("the locked limits are shown with their reason and cannot be set through the API", () => {
  assert.deepEqual(LOCKED.map((l) => l.key), ["recurring_confirmation", "bank_auto_apply", "no_outbound_payments", "tax_notice"]);
  for (const l of LOCKED) assert.ok(l.reason.length > 40, l.key);
  const route = read("app/api/app/accounting/settings/route.ts");
  assert.match(route, /\}\)\.strict\(\);/, "unknown fields are refused");
  const schema = route.slice(route.indexOf("const patch"), route.indexOf("}).strict();"));
  assert.doesNotMatch(schema, /recurring|confirm|auto_apply|notice|outbound/i, "no field for a locked limit");
  // Recurring confirmation is locked in the database too: an instance books only through confirm_expense.
  assert.match(read("supabase/migrations/20261015220000_la_7_3_expenses.sql"), /if x\.status <> 'unconfirmed' then/);
});

test("every change writes an audit row with old and new values; the owner changes, the bookkeeper reads", () => {
  assert.deepEqual(diff(ACCOUNTING_DEFAULTS, { ...ACCOUNTING_DEFAULTS, sampleThreshold: 15, defaultBasis: "cash" }).map((c) => [c.field, c.from, c.to]), [["default_basis", "accrual", "cash"], ["sample_threshold", 10, 15]]);
  const sql = read("supabase/migrations/20261015280000_la_7_9_accounting_settings.sql");
  assert.match(sql, /old_value jsonb,\n\s+new_value jsonb,\n\s+changed_by uuid not null,/);
  assert.match(sql, /revoke update, delete, truncate on public\.accounting_setting_change from service_role;/);
  const store = read("lib/accounting/settingsStore.ts");
  assert.match(store, /from\("accounting_setting_change"\)\.insert\(changes\.map\(\(c\) => \(\{ tenant_id: tenantId, field: c\.field, old_value: c\.from, new_value: c\.to, changed_by: by \}\)\)\)/);
  const route = read("app/api/app/accounting/settings/route.ts");
  assert.match(route, /const WRITE = \["owner"\] as const;/);
  assert.match(route, /requireFeatureRole\("profit_and_loss", WRITE, \{ write: true \}\)/);
  assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === "app/api/app/accounting/settings/route.ts")?.allowedRoles, ["owner", "bookkeeper"]);
});

test("changing a setting never rewrites recorded figures", () => {
  // Acquisition defaults apply to new expenses; a booked one keeps its flag (changed only one by one).
  assert.match(read("lib/accounting/expenseStore.ts"), /const acq = acquisitionFor\(input\.category, await acquisitionDefaults\(tenantId\), input\.isAcquisitionCost\);/);
  // Published payout runs keep the terms they were built with.
  assert.match(read("supabase/migrations/20261015240000_la_7_4_partner_payouts.sql"), /new\.terms_snapshot_json, new\.period_start/);
  // Settings never touch a run, an entry or a statement.
  assert.doesNotMatch(read("lib/accounting/settingsStore.ts"), /payout_run|cost_entry|expense"|vendor_invoice/);
});

test("owner-owned screens are linked, never edited here", () => {
  const board = read("components/app/accounting/accounting-settings-board.tsx");
  for (const href of ["/app/rate-card", "/app/publishers", "/app/campaigns"]) assert.ok(board.includes(`href="${href}"`), href);
  assert.doesNotMatch(read("app/api/app/accounting/settings/route.ts"), /partner_terms|commission_schedules|carrier_operating_settings|tenant_campaigns/);
});
