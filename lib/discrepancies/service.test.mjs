// LA-4.4 – 4.6 · the stored discrepancies, the page, the letter and the dashboard figure.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("4.4: a refresh keeps a person's decision and never deletes a finding", () => {
  const service = read("lib/discrepancies/service.ts");
  const refresh = service.slice(service.indexOf("export async function refreshDiscrepancies"), service.indexOf("export async function refreshDiscrepanciesQuietly"));
  // The decisions themselves are planRefresh's, pure and tested in compute.test.mjs.
  assert.match(refresh, /const plan = planRefresh\(/);
  const compute = read("lib/discrepancies/compute.ts");
  assert.match(compute, /if \(row\.status === "resolved" \|\| row\.status === "written_off"\) \{\s+if \(finding\.owedCents < row\.owedCents \+ toleranceCents\) continue;/, "resolved and written-off are left as decided unless they get worse");
  assert.match(compute, /if \(!row \|\| row\.status === "cleared"\) \{/, "new or cleared opens; open and disputed keep their status");
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
  // Only a reviewed statement is evidence (2026-10-06): its coverage and its accepted lines. A PDF
  // waiting for its lines, or a statement still in review, says nothing yet about what was paid.
  assert.match(service, /const reviewed = new Set\(statements\.rows\.filter\(\(row\) => row\.status === "reviewed"\)\.map\(\(row\) => row\.id\)\);/);
  // An accepted line is money received wherever it sits; only the unreviewed days are left unjudged.
  assert.match(service, /const received: ReceivedEntry\[\] = entries\.rows\.map\(/);
  assert.match(service, /const coverage: CoveredPeriod\[\] = statements\.rows\.filter\(\(row\) => reviewed\.has\(row\.id\)\)\.map\(asPeriod\);/);
  assert.match(service, /const pending: CoveredPeriod\[\] = statements\.rows\.filter\(\(row\) => !reviewed\.has\(row\.id\)\)\.map\(asPeriod\);/, "and the days they cover are not judged yet");
});

test("4.5: the page, the routes and the letter are owner and bookkeeper only, and decisions are writes", () => {
  const page = read("app/app/(shell)/discrepancies/page.tsx");
  assert.match(page, /guardPage\("discrepancy_report"\)/);
  assert.match(page, /hasTenantPermission\(guard\.role, "statements\.view"\)/);
  // One list since 2026-10-08: the statement findings join the carrier ones, with their own decisions.
  assert.match(page, /handItems=\{hand\}/);
  assert.match(read("components/app/carrier-discrepancies.tsx"), /fetch\("\/api\/app\/discrepancies", \{ method: "PATCH"/);
  const list = read("app/api/app/discrepancies/route.ts");
  assert.match(list, /requireFeatureRole\("discrepancy_report", roles\)/);
  const one = read("app/api/app/discrepancies/[id]/route.ts");
  assert.match(one, /requireFeatureRole\("discrepancy_report", roles, \{ write: true \}\)/);
  assert.match(one, /z\.enum\(SETTABLE_DISCREPANCY_STATUSES\)/, "cleared is never set by a person");
  assert.match(one, /"tenant\.discrepancy_status_changed"/);
  const letter = read("app/app/discrepancies/letter/page.tsx");
  // One rule for what a letter lists, shared by the page that draws it and the route that audits it.
  assert.match(read("lib/discrepancies/service.ts"), /export function letterItems[\s\S]*?item\.carrierId === carrierId && item\.status !== "cleared"/, "one carrier's findings only, still applying");
  // The page and the PDF both draw getDisputeLetter: the same rows, the same total.
  const gathered = read("lib/discrepancies/letter.ts");
  assert.match(gathered, /const items = letterItems\(list\.items, carrier, wanted\);/);
  assert.match(gathered, /totalCents: items\.reduce\(\(sum, item\) => sum \+ item\.owedCents, 0\)/, "the total is the sum of the rows shown");
  assert.match(letter, /const letter = await getDisputeLetter\(/);
  assert.match(read("app/api/app/discrepancies/letter/pdf/route.ts"), /const letter = await getDisputeLetter\([\s\S]*?buildDisputeLetterPdf\(letter,/, "the PDF is built from the same letter");
  assert.match(letter, /statementMoney\(letter\.totalCents\)/);
  // 4.5: opening the letter writes nothing; Print records it, once per print.
  assert.doesNotMatch(letter, /audit\(|tenant\.dispute_letter_generated/, "no audit row on render or reload");
  const letterRoute = read("app/api/app/discrepancies/letter/route.ts");
  assert.match(letterRoute, /const items = letterItems\(list\.items, body\.data\.carrier, body\.data\.ids\);/);
  assert.match(letterRoute, /action: "tenant\.dispute_letter_generated"/);
  assert.match(read("components/app/dispute-letter-actions.tsx"), /fetch\("\/api\/app\/discrepancies\/letter", \{ method: "POST"[\s\S]*?window\.print\(\);/, "Print records, then prints");
  const menu = read("lib/menu/definition.ts");
  assert.match(menu, /key: "book\.discrepancies"[^\n]*built: true/);
  const policy = read("lib/entitlements/agentApiPolicy.ts");
  for (const route of ["discrepancies/route.ts", "discrepancies/[id]/route.ts", "discrepancies/letter/route.ts"]) assert.ok(policy.includes(`app/api/app/${route}`), route);
});

test("4.5 (option a): opening the page or reading the list never recomputes; every change to the facts does", () => {
  const page = read("app/app/(shell)/discrepancies/page.tsx");
  assert.doesNotMatch(page, /refreshDiscrepancies/, "the page only reads");
  const list = read("app/api/app/discrepancies/route.ts");
  assert.doesNotMatch(list, /refreshDiscrepancies|refresh=1/, "GET never writes");
  assert.match(list, /export async function PATCH[\s\S]*?requireFeatureRole\("discrepancy_report", roles, \{ write: true \}\)/, "bulk decisions are writes");
  // Statements already refresh after each change (4.4); policies, contracts and schedules now do too.
  for (const route of [
    "app/api/app/policies/route.ts",
    "app/api/app/policies/lapse-risk/signals/route.ts",
    "app/api/app/carrier-library/tenant-carriers/route.ts",
    "app/api/app/carrier-library/commission-schedules/route.ts",
    "app/api/app/carrier-library/advance-rules/route.ts",
  ]) {
    assert.match(read(route), /after\(\(\) => refreshDiscrepanciesQuietly\(tenantId\)\)/, `${route} refreshes the findings after its change`);
  }
  assert.equal((read("app/api/app/policies/route.ts").match(/after\(\(\) => refreshDiscrepanciesQuietly/g) ?? []).length, 2, "after creating and after editing a policy");
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

test("4.5 follow-up: a carrier's commissions address is saved per agency and starts every letter to it", () => {
  const sql = read("supabase/migrations/20261007110000_la_4_carrier_commission_contacts.sql");
  assert.match(sql, /primary key \(tenant_id, carrier_id\)/, "one address per carrier per agency");
  assert.match(sql, /using \(tenant_id = nullif\(\(select current_setting\('app\.tenant_id', true\)\), ''\)::uuid\)/, "tenant_app reads its own only");
  assert.match(sql, /revoke delete, truncate on public\.tenant_carrier_commission_contacts from service_role, tenant_app/);
  const route = read("app/api/app/discrepancies/carrier-contact/route.ts");
  assert.match(route, /export async function GET[\s\S]*?requireFeatureRole\("discrepancy_report", roles\);/, "reading the address is not a write");
  assert.match(route, /export async function PUT[\s\S]*?requireFeatureRole\("discrepancy_report", roles, \{ write: true \}\)/, "saving it is");
  assert.match(route, /action: "tenant\.carrier_commission_contact_saved"/);
  const service = read("lib/discrepancies/carrierContacts.ts");
  assert.match(service, /\.eq\("tenant_id", tenantId\)\.eq\("carrier_id", carrierId\)/, "a service-role read filtered by tenant");
  assert.match(service, /if \(isSchemaGap\(read\.error\)\) return \{ available: false, contact: null \};/, "before the migration the letter still works");
  const letter = read("app/app/discrepancies/letter/page.tsx");
  assert.match(letter, /savedAddress=\{letter\.savedRecipient\} canSave=\{canMarkDisputed && letter\.contactsAvailable\}/, "the saved address starts the letter; only a full account may save");
  assert.match(read("lib/discrepancies/letter.ts"), /savedRecipient: contact\.contact\?\.address \?\? null,/);
  const recipient = read("components/app/dispute-letter-actions.tsx");
  assert.doesNotMatch(recipient, /usePersistedState|localStorage/, "no longer one person's browser memory");
  assert.ok(recipient.includes('fetch("/api/app/discrepancies/carrier-contact", { method: "PUT"'), "saving goes through the gated route");
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/discrepancies\/carrier-contact\/route\.ts/);
});
