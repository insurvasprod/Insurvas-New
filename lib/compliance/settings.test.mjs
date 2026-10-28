// LA-6.8 (Notion sprint, Module 6 — Compliance) · compliance settings.
// Run with: node --experimental-strip-types --test lib/compliance/settings.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const STORE = "lib/compliance/settingsStore.ts";
const MIGRATION = "supabase/migrations/20261015170000_la_6_8_compliance_settings.sql";

test("litigator and internal-DNC checks cannot be disabled: there is no setting for them", () => {
  const store = read(STORE);
  assert.match(store, /lockedGateChecks: \["tcpa_litigator", "internal_dnc"\]/);
  assert.doesNotMatch(store, /"gate\.(litigator|tcpa|internalDnc|internal_dnc)"/);
  // An attempt to set one falls to the default branch and is refused.
  assert.match(store, /default:\n\s+\/\/ Includes any attempt to switch off a locked gate check: there is no such setting\.\n\s+throw new SettingsError\("That is not a setting you can change\.", 400\);/);
  for (const f of readdirSync(join(root, "supabase/migrations")).filter((n) => /la_6_/.test(n))) assert.doesNotMatch(read(`supabase/migrations/${f}`), /gate_check_(litigator|tcpa|internal)/, f);
});

test("the deletion hold cannot go below the platform floor; the owner always may delete and report", () => {
  const store = read(STORE);
  assert.match(store, /case "deletion\.holdDays": return intIn\(value, PLATFORM_CAPS\.deletionHoldFloorDays, 45, "The deletion hold"\);/);
  assert.match(store, /deletionHoldFloorDays: 3,/);
  assert.match(read("supabase/migrations/20261015140000_la_6_5_consumer_deletion.sql"), /check \(deletion_hold_days between 3 and 45\)/);
  assert.match(store, /if \(!v\.includes\("owner"\)\) throw new SettingsError\("The tenant admin always may\.", 400\);/);
  assert.match(read(MIGRATION), /check \('owner' = any\(deletion_performer_roles\) and deletion_performer_roles <@ array\['owner', 'producer'\]\)/);
});

test("never-delete rows are locked: the do-not-call rule cannot be edited to any other action", () => {
  const store = read(STORE);
  assert.match(store, /if \(PLATFORM_CAPS\.neverDelete\.includes\(input\.recordType as "internal_dnc"\)\) throw new SettingsError\("Do-not-call entries are never deleted\. That rule is locked\.", 400\);/);
  assert.match(store, /if \(!\(ACTIONS as readonly string\[\]\)\.includes\(input\.action\) \|\| input\.action === "never_delete"\)/);
  assert.match(read("supabase/migrations/20261015150000_la_6_6_retention.sql"), /constraint retention_rule_dnc check \(record_type <> 'internal_dnc' or action = 'never_delete'\)/);
  assert.match(read("components/app/compliance/compliance-settings.tsx"), /<StatusChip tone="neutral">Locked: never deleted<\/StatusChip>/);
});

test("every change writes an audit row with old and new values", () => {
  const store = read(STORE);
  for (const fn of ["saveSettings", "setDeadline", "saveTenantRule", "deleteTenantRule", "placeHoldLogged", "releaseHoldLogged"]) {
    const at = store.indexOf(`export async function ${fn}`);
    assert.ok(at > 0, fn);
    const body = store.slice(at, store.indexOf("\n}\n", at));
    assert.match(body, /logChange\(|saveTenantRule\(|rpc\("compliance_settings_save"/, `${fn} audits`);
  }
  // LA-6 audit (13): the settings row and its change rows are one transaction, never save-then-log.
  const save = store.slice(store.indexOf("export async function saveSettings"), store.indexOf("\n}\n", store.indexOf("export async function saveSettings")));
  assert.match(save, /rpc\("compliance_settings_save"/);
  assert.doesNotMatch(save, /from\("compliance_settings"\)\.upsert|logChange\(/);
  const fix = read("supabase/migrations/20261015630000_la_6_legal_risk_fixes.sql");
  assert.match(fix, /insert into public\.compliance_setting_change \(tenant_id, section, setting, old_value, new_value, changed_by\)/);
  assert.match(fix, /revoke all on function public\.compliance_settings_save\(uuid, uuid, jsonb, jsonb\) from public, anon, authenticated, tenant_app;/);
  assert.match(store, /old_value: from === undefined \? null : from, new_value: to === undefined \? null : to, changed_by: userId/);
  assert.match(read(MIGRATION), /revoke update, delete, truncate on public\.compliance_setting_change from service_role, tenant_app;/);
  assert.match(read("app/api/app/compliance/retention/holds/route.ts"), /placeHoldLogged|releaseHoldLogged/);
});

test("each consumer reads its setting on the server", () => {
  assert.match(read("lib/compliance/transferGate.ts"), /from\("compliance_settings"\)/);
  assert.match(read("lib/compliance/complaintStore.ts"), /from\("compliance_settings"\)\.select\("complaint_amber_days, complaint_red_days"\)/);
  assert.match(read("lib/compliance/dataSubjectStore.ts"), /from\("compliance_settings"\)\.select\("deletion_hold_days, deletion_methods"\)/);
  assert.match(read("app/api/app/compliance/deletions/[id]/route.ts"), /\.deletion\.performerRoles/);
  assert.match(read("lib/compliance/evidenceReport.ts"), /select\("report_gap_checks"\)/);
  assert.match(read("lib/compliance/evidenceReport.ts"), /select\("report_roles"\)/);
  assert.match(read("app/api/app/compliance/evidence/route.ts"), /mayGenerateReports\(tenantId, role\)/);
  assert.match(read("lib/compliance/dashboard.ts"), /select\("dashboard_hidden_tiles"\)/);
  assert.match(read("app/api/cron/compliance-monthly/route.ts"), /dashboard_monthly_email/);
});

test("no hard-coded deadline, retention period or threshold in LA-6 code (defaults live in the database and one DEFAULTS object)", () => {
  for (const f of ["lib/compliance/complaintStore.ts", "lib/compliance/retentionStore.ts", "lib/compliance/dataSubjectStore.ts", "lib/compliance/transferGate.ts", "lib/compliance/dashboard.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(1461|548|2557|365)\b/, `${f} hard-codes a retention period`);
    assert.doesNotMatch(src, /response_days:\s*\d|responseDays\s*=\s*\d/, `${f} hard-codes a complaint deadline`);
  }
});

test("a switched-off gap check reads as switched off, never as passed", () => {
  assert.match(read("lib/compliance/evidenceReport.ts"), /status: "undetermined" as const, calls: 0, first_at: null, last_at: null, detail: \{ reason: "Switched off in compliance settings\." \}/);
});

test("deadline coverage is shown with its consequence; owned-elsewhere settings are links, not editors", () => {
  const ui = read("components/app/compliance/compliance-settings.tsx");
  assert.match(ui, /\{c\.sentence\}/);
  assert.match(ui, /href="\/app\/settings#calling-windows"/);
  assert.match(ui, /href="\/app\/settings#sales-disclosures"/);
  // Owner, 2026-10-28: no agency Carrier rules page; the windows are named as Insurvas's.
  assert.match(ui, /Insurvas keeps each carrier&apos;s retention windows/);
  assert.match(ui, /NOT_LEGAL_ADVICE/);
  assert.doesNotMatch(ui, /calling_window_state_rules|tenant_calling_windows|application_disclosures/);
});

test("tenant admin only, enforced on the server", () => {
  assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === "app/api/app/compliance/settings/route.ts")?.allowedRoles, ["owner"]);
  assert.match(read("app/api/app/compliance/settings/route.ts"), /requireFeatureRole\("tcpa_checker", \["owner"\], \{ write: true \}\)/);
  assert.match(read("app/app/(shell)/compliance/settings/page.tsx"), /if \(guard\.role !== "owner"\)/);
});
