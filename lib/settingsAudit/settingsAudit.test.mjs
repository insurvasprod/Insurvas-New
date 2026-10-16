import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { AUDITED_SECTIONS, actorLine, changeLine, settingsAuditCsv } from "./constants.ts";
import { NOT_CONSUMER } from "../compliance/dataSubjectMap.ts";

// LA-8.8 (Notion sprint) acceptance criteria that a test can hold. The database half was rehearsed
// against Postgres (scratchpad rehearse-la88.mjs: 9/9) — the guard, the triggers, the backfill.

const read = (file) => fs.readFileSync(file, "utf8");
const MIGRATION = read("supabase/migrations/20261015360000_la_8_8_settings_audit.sql");

test("all five hubs write settings_audit with the same shape", () => {
  const hubs = {
    "LA-7.9 accounting": /after insert on public\.accounting_setting_change\s+for each row execute function public\.settings_audit_from_change_table\('accounting'\)/,
    "LA-6.8 compliance": /after insert on public\.compliance_setting_change\s+for each row execute function public\.settings_audit_from_change_table\('compliance'\)/,
    "LA-5.11 retention": /after insert on public\.retention_setting_change\s+for each row execute function public\.settings_audit_from_change_table\('retention'\)/,
    "LA-3.17 sales": /after insert or update on public\.tenant_sales_settings[\s\S]{0,80}settings_audit_sales_settings\(\)/,
    "LA-3.17 carriers": /after insert or update on public\.tenant_carrier_settings[\s\S]{0,80}settings_audit_carrier_columns\('sales-carriers'/,
    "LA-4.17 operating": /after insert or update on public\.carrier_operating_settings[\s\S]{0,80}settings_audit_carrier_columns\('carrier-rules'/,
    "LA-4.17 rules": /after insert on public\.carrier_retention_rule[\s\S]{0,80}settings_audit_carrier_rule\(\)/,
  };
  for (const [hub, pattern] of Object.entries(hubs)) assert.match(MIGRATION, pattern, hub);
  // One writer: every capture goes through record_settings_audit.
  assert.equal((MIGRATION.match(/perform public\.record_settings_audit\(/g) ?? []).length, 4);
  // Each section key a hub writes is named for the viewer.
  for (const key of ["accounting", "compliance", "retention", "sales-preferences", "sales-carriers", "carrier-rules"]) assert.ok(AUDITED_SECTIONS.some((s) => s.key === key), key);
});

test("the label is snapshotted and the role is the one held at the time", () => {
  assert.match(MIGRATION, /setting_label text not null/);
  assert.match(MIGRATION, /actor_role text,/);
  // Read from tenant_users when the row is written, stored, never joined later.
  assert.match(MIGRATION, /select tu\.role::text into v_role from public\.tenant_users tu where tu\.tenant_id = p_tenant_id and tu\.user_id = v_actor;/);
  const service = read("lib/settingsAudit/service.ts");
  assert.match(service, /settingLabel: row\.setting_label/);
  assert.match(service, /actorRole: row\.actor_role/);
  assert.doesNotMatch(service, /tenant_users[^\n]*role/, "the viewer must not re-read today's role");
});

test("UPDATE and DELETE fail for every role, the tenant admin's included", () => {
  assert.match(MIGRATION, /revoke update, delete, truncate on public\.settings_audit from service_role;/);
  assert.match(MIGRATION, /revoke all on public\.settings_audit from public, anon, authenticated;/);
  assert.match(MIGRATION, /before update or delete on public\.settings_audit\s+for each row execute function public\.settings_audit_is_append_only\(\)/);
  assert.match(MIGRATION, /before truncate on public\.settings_audit/);
  // No route writes, edits or deletes it.
  for (const file of ["app/api/app/settings-audit/route.ts", "app/api/app/settings-audit/last/route.ts", "lib/settingsAudit/service.ts"]) {
    assert.doesNotMatch(read(file), /\.(insert|update|delete|upsert)\(|export async function (POST|PUT|PATCH|DELETE)/, file);
  }
});

test("LA-6.6's retention purge can never remove a settings_audit row", () => {
  const retention = read("supabase/migrations/20261015150000_la_6_6_retention.sql");
  assert.doesNotMatch(retention, /settings_audit|_setting_change/);
  // The purge's record types are a fixed list a rule must name; none of them is the audit log.
  const types = /constraint retention_rule_type check \(record_type in \(([^)]*)\)/.exec(retention)[1];
  assert.doesNotMatch(types, /audit|setting/);
  // Even a rule written to reach it would be refused by the table itself (append-only trigger), and
  // a data-subject deletion leaves it alone.
  assert.ok(NOT_CONSUMER.includes("settings_audit"));
});

test("a non-admin sees only their own entries; the full log is 403", () => {
  const route = read("app/api/app/settings-audit/route.ts");
  assert.match(route, /if \(!owner && !q\.mine\) return NextResponse\.json\([^)]*\{ status: 403 \}\)/);
  assert.match(route, /onlyActor: q\.mine \? auth\.context\.userId : undefined/);
  assert.match(read("app/api/app/settings-audit/last/route.ts"), /requireTenant\(\["owner"\]\)/);
  assert.match(read("app/app/(shell)/profile/page.tsx"), /<SettingsHistory mine \/>/);
});

test("the viewer filters by section, user, dates and change type, and each row opens the setting", () => {
  const viewer = read("components/app/settings/settings-history.tsx");
  for (const param of ["section", "actor", "type", "from", "to"]) assert.match(viewer, new RegExp(`params\\.set\\("${param}"`), param);
  assert.match(viewer, /sectionHref\(section\)/);
  const service = read("lib/settingsAudit/service.ts");
  assert.match(service, /order\("occurred_at", \{ ascending: false \}\)/);
});

test("the CSV is exactly the filtered set, and safe to open in a spreadsheet", () => {
  const entries = [
    { id: "1", sectionKey: "retention", settingKey: "high_band_floor", settingLabel: "High band floor", oldValue: "50", newValue: "75", changeType: "update", actorUserId: "u", actorName: "Umar Masood", actorRole: "owner", occurredAt: "2026-10-02T09:51:00Z", source: "ui", reason: null },
    { id: "2", sectionKey: "accounting", settingKey: "x", settingLabel: "=HYPERLINK(\"evil\")", oldValue: null, newValue: "overhead", changeType: "create", actorUserId: null, actorName: null, actorRole: null, occurredAt: "2026-10-03T14:22:00Z", source: "migration", reason: null },
  ];
  const lines = settingsAuditCsv(entries).trim().split("\r\n");
  assert.equal(lines.length, 1 + entries.length);
  assert.match(lines[1], /"High band floor","50","75","Changed","Umar Masood","owner"/);
  assert.match(lines[2], /"'=HYPERLINK\(""evil""\)"/);
  assert.equal(changeLine(entries[0]), "50 → 75");
  assert.equal(actorLine(entries[0]), "Umar Masood (owner)");
  assert.match(read("app/api/app/settings-audit/route.ts"), /settingsAuditCsv\(entries\)/);
});

test("every in-page settings section shows who last changed something there, for the owner", () => {
  assert.match(read("components/app/settings/primitives.tsx"), /\{meta\.history && meta\.id && <SectionLastChanged sectionKey=\{meta\.id\} \/>\}/);
  assert.match(read("components/app/agent-settings-tabs.tsx"), /id: active\.id, history: role === "owner"/);
  assert.match(read("components/app/settings/last-changed.tsx"), /href=\{`\/app\/settings\?history=\$\{encodeURIComponent\(sectionKey\)\}#settings-history`\}/);
});

test("the LA-8 screens write the settings history through the one writer (owner decision 2026-10-15)", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const routes = {
    "app/api/app/agency-profile/route.ts": "business-identity",
    "app/api/app/agency-profile/logo/route.ts": "business-identity",
    "app/api/app/partner-support-contact/route.ts": "business-identity",
    "app/api/app/team/route.ts": "team-access",
    "app/api/app/team/[userId]/route.ts": "team-access",
    "app/api/app/team/[userId]/deactivate/route.ts": "team-access",
    "app/api/app/team/[userId]/reactivate/route.ts": "team-access",
    "app/api/app/team/[userId]/timezone/route.ts": "team-access",
    "app/api/app/team/[userId]/licensed-states/route.ts": "team-access",
    "app/api/app/team/[userId]/invite/route.ts": "team-access",
    "app/api/app/billing/route.ts": "billing",
    "app/api/app/api-keys/route.ts": "integrations",
    "app/api/app/api-keys/[id]/route.ts": "integrations",
    "app/api/app/api-keys/[id]/rotate/route.ts": "integrations",
    "app/api/app/webhooks/route.ts": "integrations",
    "app/api/app/webhooks/[id]/route.ts": "integrations",
    "app/api/app/calling-windows/route.ts": "calling-windows",
    "app/api/app/pipelines/route.ts": "pipelines",
    "app/api/app/pipelines/[id]/route.ts": "pipelines",
    "app/api/app/pipelines/[id]/stages/route.ts": "pipelines",
    "app/api/app/pipelines/[id]/stages/[stageId]/route.ts": "pipelines",
    "app/api/app/pipelines/[id]/stages/reorder/route.ts": "pipelines",
    "app/api/app/pipelines/dispositions/route.ts": "dispositions",
    "app/api/app/dispositions/config/route.ts": "dispositions",
  };
  for (const [file, section] of Object.entries(routes)) {
    const source = read(file);
    assert.match(source, /recordSettingsChanges\(/, `${file} records nothing`);
    assert.ok(source.includes(`section: "${section}"`), `${file} records under the wrong section`);
    assert.ok(AUDITED_SECTIONS.some((s) => s.key === section), `${section} is not in the history's filter`);
  }
  // One writer: the database function, so the role held then is read the same way everywhere.
  assert.match(read("lib/settingsAudit/record.ts"), /db\.rpc\("record_settings_audit", \{/);
  // The tax ID only as its last four.
  assert.match(read("app/api/app/agency-profile/route.ts"), /key: "taxIdLast4", label: "Tax ID", mask: \(value: unknown\) => \(value \? `ending \$\{value\}` : null\)/);
});

test("LA-8 audit: the route-hosted hubs show who last changed them, like the in-page sections", () => {
  for (const [file, key, ownerOnly] of [
    ["app/app/(shell)/accounting-settings/page.tsx", "accounting", true],
    ["app/app/(shell)/carrier-rules/page.tsx", "carrier-rules", true],
    ["app/app/(shell)/compliance/settings/page.tsx", "compliance", false],
  ]) {
    const page = read(file);
    assert.match(page, /import \{ SectionLastChanged \} from "@\/components\/app\/settings\/last-changed";/, file);
    // The line reads the owner-only log, so only the owner sees it (compliance settings is owner-only already).
    assert.match(page, new RegExp(`${ownerOnly ? '\{guard\.role === "owner" && ' : ""}<SectionLastChanged sectionKey="${key}" />`), file);
    assert.ok(AUDITED_SECTIONS.some((s) => s.key === key), key);
  }
});
