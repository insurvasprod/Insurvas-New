// LA-4.4 – 4.6 · the stored discrepancies, the page, the letter and the dashboard figure.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("4.4: a refresh keeps a person's decision and never deletes a finding", () => {
  const service = read("lib/discrepancies/service.ts");
  const refresh = service.slice(service.indexOf("export async function refreshDiscrepancies"), service.indexOf("export async function refreshDiscrepanciesQuietly"));
  assert.match(refresh, /stored\.status === "resolved" \|\| stored\.status === "written_off"\)\) continue;/, "resolved and written-off are left as decided");
  assert.match(refresh, /!stored \|\| stored\.status === "cleared" \? "open" : stored\.status/, "new or cleared opens; open and disputed keep their status");
  assert.match(refresh, /upsert\(part, \{ onConflict: "tenant_id,fingerprint" \}\)/);
  assert.match(refresh, /\.update\(\{ status: "cleared"/, "a finding that no longer applies is cleared, not deleted");
  assert.doesNotMatch(service, /\.delete\(/);
  const sql = read("supabase/migrations/20261002110000_la_4_4_commission_discrepancies.sql");
  assert.match(sql, /unique \(tenant_id, fingerprint\)/);
  assert.match(sql, /revoke delete, truncate on public\.tenant_commission_discrepancies from service_role, tenant_app/);
  assert.match(sql, /A discrepancy''s identity cannot change/);
});

test("4.4: every statement change refreshes the findings, and a refresh never fails the change", () => {
  const statements = read("lib/ledger/statementService.ts");
  assert.equal((statements.match(/await refreshDiscrepanciesQuietly\(tenantId\);/g) ?? []).length, 4, "import (and re-process), decisions, void, typed lines");
  const service = read("lib/discrepancies/service.ts");
  assert.match(service, /export async function refreshDiscrepanciesQuietly[\s\S]*?catch \(error\)/);
  // A PDF still waiting for its lines is not coverage.
  assert.match(service, /filter\(\(row\) => row\.status !== "awaiting_entry"\)/);
});

test("4.5: the page, the routes and the letter are owner and bookkeeper only, and decisions are writes", () => {
  const page = read("app/app/(shell)/discrepancies/page.tsx");
  assert.match(page, /guardPage\("discrepancy_report"\)/);
  assert.match(page, /hasTenantPermission\(guard\.role, "statements\.view"\)/);
  assert.match(page, /<StatStrip label="Owed to you">/);
  const list = read("app/api/app/discrepancies/route.ts");
  assert.match(list, /requireFeatureRole\("discrepancy_report", roles\)/);
  const one = read("app/api/app/discrepancies/[id]/route.ts");
  assert.match(one, /requireFeatureRole\("discrepancy_report", roles, \{ write: true \}\)/);
  assert.match(one, /z\.enum\(SETTABLE_DISCREPANCY_STATUSES\)/, "cleared is never set by a person");
  assert.match(one, /"tenant\.discrepancy_status_changed"/);
  const letter = read("app/app/discrepancies/letter/page.tsx");
  assert.match(letter, /item\.carrierId === carrier && item\.status !== "cleared"/, "one carrier's findings only");
  assert.match(letter, /"tenant\.dispute_letter_generated"/);
  const menu = read("lib/menu/definition.ts");
  assert.match(menu, /key: "book\.discrepancies"[^\n]*built: true/);
  const policy = read("lib/entitlements/agentApiPolicy.ts");
  for (const route of ["discrepancies/route.ts", "discrepancies/[id]/route.ts"]) assert.ok(policy.includes(`app/api/app/${route}`), route);
});

test("4.6: the dashboard figure is one read of the stored rows, and says what to do before any statement", () => {
  const summaries = read("lib/dashboard/summaries.ts");
  const owed = summaries.slice(summaries.indexOf("async function owed("), summaries.indexOf("async function callbacks("));
  assert.match(owed, /owedToYou\(tenantId\)/);
  assert.doesNotMatch(owed, /getCommissionLedger|refreshDiscrepancies/, "no recompute on the dashboard");
  assert.match(owed, /caption: "import a statement"/);
  const service = read("lib/discrepancies/service.ts");
  assert.match(service, /export async function owedToYou[\s\S]*?\.in\("status", \["open", "disputed"\]\)/);
  const tiles = read("lib/dashboard/tiles.ts");
  assert.match(tiles, /key: "book\.owed"[\s\S]*?required_roles: \["owner", "bookkeeper"\]/);
});
