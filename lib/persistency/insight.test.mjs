// LA-4.7 – 4.9 · the lapse date, the paged book, the Persistency page and one policy's money.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("4.7: the status date moves only when the status does, and the backfill keeps updated_at", () => {
  const sql = read("supabase/migrations/20261002120000_la_4_7_policy_status_changed_at.sql");
  assert.match(sql, /disable trigger tenant_policies_updated_at;[\s\S]*?update public\.tenant_policies[\s\S]*?enable trigger tenant_policies_updated_at;/);
  assert.match(sql, /elsif new\.status is distinct from old\.status then\s+new\.status_changed_at := now\(\);/);
  assert.match(sql, /new\.status_changed_at := old\.status_changed_at;/, "an edit cannot move the date by sending one");
  assert.match(sql, /before insert or update on public\.tenant_policies/);
  assert.doesNotMatch(sql, /set_config|\bset (local )?app\./i, "no session settings on the pooler");
});

test("4.7: the book is read in pages, and the lapse date falls back to the last edit before the column", () => {
  const service = read("lib/ledger/service.ts");
  // The paging itself is readPaged's, with a behaviour test over a 2,500-row book (lib/supabase/readPaged.test.mjs).
  assert.match(service, /readPaged<BookPolicyRow>\(\(from, to\) =>/);
  assert.match(service, /\.range\(from, to\)/);
  assert.match(service, /\.eq\("tenant_id", tenantId\)/, "a service-role read is filtered by tenant");
  assert.match(service, /if \(result\.error && isSchemaGap\(result\.error\)\) result = await read\(COLUMNS_V1\);/);
  assert.match(service, /return row\.status_changed_at \?\? row\.updated_at;/);
  assert.match(service, /if \(row\.status !== "lapsed" && row\.status !== "cancelled"\) return null;/);
});

test("4.8: persistency is gated, registered and scoped to the producer; its screen is Book scorecards", () => {
  const route = read("app/api/app/persistency/route.ts");
  assert.match(route, /requireFeatureRole\("cohort_persistency", roles\)/);
  assert.match(route, /roleCanViewCommission\(auth\.context\.role, auth\.context\.userId, producerUserId\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /"app\/api\/app\/persistency\/route\.ts", featureKey: "cohort_persistency", allowedRoles: \["owner", "producer", "bookkeeper"\]/);
  // The screen is Book scorecards › Persistency now (2026-10-08); the API above stays for integrations.
  assert.match(read("app/app/(shell)/persistency/page.tsx"), /redirect\("\/app\/book-scorecards\?view=persistency"\)/);
  const service = read("lib/persistency/service.ts");
  assert.match(service, /\.filter\(\(row\) => input\.canView\(row\.created_by \?\? undefined\)\)/);
  // Every service-role read in this file filters by tenant (the paged reader, and leadSourceOf's
  // issued-record read and its vendor-or-campaign read).
  const reads = [...service.matchAll(/\.from\((?:table|"[a-z_]+")\)\.select\([^)]*\)([^;\n]*)/g)].map((match) => match[1]);
  assert.equal(reads.length, 3, "the reads are all found");
  for (const tail of reads) assert.match(tail, /^\.eq\("tenant_id", tenantId\)/, `a read that does not start with the tenant filter: ${tail.slice(0, 60)}`);
});

test("4.9: one policy's page — same tenant, producer's own, assistants out, discrepancies for their roles", () => {
  const page = read("app/app/(shell)/policies/[id]/page.tsx");
  assert.match(page, /\.eq\("tenant_id", tenantId\)\.eq\("id", id\)\.maybeSingle\(\)/, "another workspace's id reads nothing");
  assert.match(page, /if \(!row\) notFound\(\);/);
  assert.match(page, /if \(!canView\(row\.created_by \?\? undefined\)\) notFound\(\);/, "a producer opens only their own");
  assert.match(page, /\["owner", "producer", "bookkeeper"\]\.includes\(guard\.role\)/, "an assistant sees no money");
  assert.match(page, /seesDiscrepancies = hasFeature\(guard\.entitlement, "discrepancy_report"\) && \["owner", "bookkeeper"\]\.includes\(guard\.role\)/);
  assert.match(page, /entry\.policyId === row\.id/);
  assert.match(page, /lead source \$\{leadSource\}/);
  assert.match(read("components/app/policies-workspace.tsx"), /href=\{`\/app\/policies\/\$\{policy\.id\}`\}/);
});

test("4.9: one policy's page reads that policy's records only, and never shows a failed read as 'none'", () => {
  const page = read("app/app/(shell)/policies/[id]/page.tsx");
  // Not the whole tenant's ledger, findings and sources filtered afterwards.
  assert.doesNotMatch(page, /getStatementLedger\(/);
  assert.match(page, /getPolicyStatementLines\(tenantId, row\)/);
  assert.match(page, /listDiscrepancies\(tenantId, \{ policyId: row\.id \}\)/);
  assert.doesNotMatch(page, /\.catch\(\(\) => \(\{ available: false, items: \[\] \}\)\)/, "a failed read is not 'no discrepancy'");
  assert.match(page, /discrepanciesFailed && \([\s\S]*?could not be loaded just now/);
  const statements = read("lib/ledger/statementService.ts");
  assert.match(statements, /export async function getPolicyStatementLines[\s\S]*?\.eq\("tenant_id", tenantId\)\.eq\("policy_id", policy\.id\)/, "one query: this tenant, this policy");
  const discrepancies = read("lib/discrepancies/service.ts");
  assert.match(discrepancies, /if \(options\.policyId\) query = query\.eq\("policy_id", options\.policyId\);/);
  assert.match(discrepancies, /db\(\)\.from\("tenant_commission_discrepancies"\)\.select\(columns\)\.eq\("tenant_id", tenantId\)/, "still this tenant's only");
  const sources = read("lib/persistency/service.ts");
  const one = sources.slice(sources.indexOf("export async function leadSourceOf"), sources.indexOf("export async function getPersistencyReport"));
  assert.doesNotMatch(one, /readSources\(/, "one policy's source does not read every source in the tenant");
  assert.match(one, /\.eq\("tenant_id", tenantId\)\.ilike\("policy_number", `%\$\{key\.split\(""\)\.join\("%"\)\}%`\)\.limit\(50\)/);
  assert.match(one, /sourceKey\(row\.policy_number\) === key/, "a candidate is confirmed with the report's own normalisation");
  assert.match(one, /return SOURCE_UNAVAILABLE;/);
});

test("4.10: every route in the Ledger plan reads for a read-only account and refuses it every write", () => {
  // Not a hand-kept list: every route registered under the five Ledger-plan features, so a new
  // route under them is checked the day it is added.
  const policy = read("lib/entitlements/agentApiPolicy.ts");
  const files = [...new Set([...policy.matchAll(/sourceFile: "([^"]+)", featureKey: "(book_of_business|statement_ingestion|commission_ledger|discrepancy_report|appointment_vault)"/g)].map((match) => match[1]))];
  assert.ok(files.length >= 45, `the Ledger-plan routes are found (${files.length})`);
  // POSTs that carry a body but write no data: a preview, and the record that a letter was printed
  // (an audit row a read-only account may leave; printing is reading).
  const READS_AS_POST = new Set(["app/api/app/statements/preview/route.ts", "app/api/app/templates/preview/route.ts", "app/api/app/discrepancies/letter/route.ts", "app/api/app/discrepancies/letter/pdf/route.ts"]);
  let handlers = 0;
  for (const file of files) {
    const source = read(file).replace(/\r\n/g, "\n");
    for (const [, method, body] of source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b[^{]*\{([\s\S]*?)\n\}/g)) {
      handlers += 1;
      const gate = body.match(/requireFeatureRole\(([\s\S]*?)\);/)?.[1] ?? body.match(/requireFeature\(([\s\S]*?)\);/)?.[1];
      assert.ok(gate, `${file} ${method} is gated`);
      const write = /write:\s*true/.test(gate);
      if (method === "GET") assert.equal(write, false, `${file} GET stays readable for a read-only account`);
      else if (READS_AS_POST.has(file)) assert.equal(write, false, `${file} ${method} writes nothing, so read-only may use it`);
      else assert.equal(write, true, `${file} ${method} refuses a read-only account`);
    }
  }
  assert.ok(handlers >= 70, `every handler was checked (${handlers})`);
  for (const file of READS_AS_POST) {
    assert.doesNotMatch(read(file), /\.(insert|update|upsert|delete)\(|\.rpc\(/, `${file} really writes no data`);
  }
});

test("4.10: a read-only (suspended) account can read every Book of Business route, and every write refuses it", () => {
  const routes = [
    "app/api/app/statements/route.ts", "app/api/app/statements/[id]/route.ts", "app/api/app/statements/[id]/lines/route.ts",
    "app/api/app/statements/[id]/file/route.ts", "app/api/app/statements/unmatched/route.ts", "app/api/app/discrepancies/route.ts",
    "app/api/app/discrepancies/[id]/route.ts", "app/api/app/persistency/route.ts", "app/api/app/policies/route.ts", "app/api/app/ledger/route.ts",
  ];
  let handlers = 0;
  for (const file of routes) {
    const source = read(file);
    for (const [, method, body] of source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
      const gate = body.match(/requireFeatureRole\(([^;]*)\);/)?.[1] ?? "";
      assert.ok(gate, `${file} ${method} is gated`);
      if (method === "GET") assert.doesNotMatch(gate, /write: true/, `${file} GET stays readable`);
      else assert.match(gate, /\{ write: true \}/, `${file} ${method} refuses a read-only account`);
      handlers += 1;
    }
  }
  // 17 since LA-4.5: GET on one discrepancy, PATCH (bulk decisions) on the list.
  assert.equal(handlers, 17, "every handler in these files was checked");
  // Printing a dispute letter is reading: a read-only account prints, so its record is not a write.
  const letter = read("app/api/app/discrepancies/letter/route.ts");
  assert.match(letter, /export async function POST[\s\S]*?requireFeatureRole\("discrepancy_report", roles\);/);
  assert.doesNotMatch(letter, /write: true/);
  for (const page of ["app/app/(shell)/statements/page.tsx", "app/app/(shell)/statements/[id]/page.tsx", "app/app/(shell)/discrepancies/page.tsx", "app/app/(shell)/ledger/page.tsx"]) {
    assert.match(read(page), /const readOnly = guard\.entitlement\.access === "read_only";/, `${page} knows it is read-only`);
  }
  // LA-4.10 pass: the other Ledger-plan screens say why they cannot be changed, not just hide it.
  assert.match(read("app/app/(shell)/policies/page.tsx"), /readOnly/, "Policies disables Add and Import with a notice");
  const appointments = read("app/app/(shell)/appointments/page.tsx");
  assert.match(appointments, /canEdit=\{guard\.role === "owner" && guard\.entitlement\.access === "full"\}/);
  assert.match(appointments, /readOnlyReason=\{guard\.entitlement\.access === "read_only" \? "Your account is read-only/);
  assert.match(read("components/app/carrier-appointments-page.tsx"), /\{readOnlyReason && <p role="status"/);
  // Settings (carrier library, contract levels, licences…): every panel is disabled in one place.
  assert.match(read("app/app/(shell)/settings/page.tsx"), /readOnly=\{guard\.entitlement\.access === "read_only"\}/);
  const tabs = read("components/app/agent-settings-tabs.tsx");
  assert.match(tabs, /readOnly && !READ_ONLY_EXEMPT\.has\(active\.id\)[\s\S]*?<fieldset disabled aria-disabled="true"/, "one fieldset disables every control in the panel");
  assert.match(tabs, /const READ_ONLY_EXEMPT = new Set\(\["billing"\]\);/, "billing stays usable: it is how the account is put right");
});
