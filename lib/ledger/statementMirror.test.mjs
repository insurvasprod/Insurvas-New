// Statement lines match carrier-file policies through a mirror (owner 2026-11-19). Run with:
// node --experimental-strip-types --test lib/ledger/statementMirror.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mirrorExpectedRows, mirrorRow, mirrorStatus, numbersToMirror } from "./statementMirror.ts";
import { normalisePolicyNumber } from "./statementMatch.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("the carrier's status becomes a hand policy's four", () => {
  assert.equal(mirrorStatus("active"), "active");
  assert.equal(mirrorStatus("in_force"), "active");
  assert.equal(mirrorStatus("lapsed"), "lapsed");
  assert.equal(mirrorStatus("terminated"), "lapsed");
  assert.equal(mirrorStatus("declined"), "cancelled");
  assert.equal(mirrorStatus("approved_unpaid"), "pending");
  assert.equal(mirrorStatus(null), "active");
});

test("a mirror carries the carrier's values, the line's insured and the matched product family", () => {
  const row = mirrorRow(
    { policy_number: "AM-TL-55021", status_normalized: "active", issue_date: "2026-11-20", effective_date: "2026-11-21", annualised_premium_cents: "51000", product_code: "TERM 20 NS", agent_user_id: null },
    { carrierName: "Americo", insuredName: "Victor Alvarez", productName: "Term Life" },
  );
  assert.deepEqual(row, { policy_number: "AM-TL-55021", insured_name: "Victor Alvarez", carrier: "Americo", product: "Term Life", effective_date: "2026-11-20", annual_premium_cents: 51000, status: "active", source: "carrier_file" });
  const bare = mirrorRow({ policy_number: "X1", status_normalized: null, issue_date: null, effective_date: null, annualised_premium_cents: null, product_code: "PLAN Z", agent_user_id: null }, { carrierName: "Americo", insuredName: " ", productName: null });
  assert.equal(bare.product, "PLAN Z", "no family match: the carrier's own code");
  assert.equal(bare.insured_name, "Named in the carrier file");
  assert.equal(bare.annual_premium_cents, null);
});

test("only numbers the hand book lacks are looked up, once each", () => {
  const lines = [
    { policyNumber: "am-tl-55021", error: null },
    { policyNumber: "AM TL 55021", error: null },
    { policyNumber: "AM-LD-1", error: null },
    { policyNumber: null, error: null },
    { policyNumber: "BAD", error: "unreadable" },
  ];
  assert.deepEqual(numbersToMirror(lines, ["AM-LD-1"], normalisePolicyNumber), ["am-tl-55021"]);
});

test("the import writes mirrors, a preview never does, and the database can refuse them before the migration", () => {
  const service = read("lib/ledger/statementService.ts");
  const store = read("lib/ledger/statementMirrorStore.ts");
  assert.match(store, /export async function carrierPolicyMirrors\(tenantId: string, lines: ParsedStatementLine\[\], held: PolicyRow\[\], carrier: MatchCarrier, write: boolean/);
  assert.match(store, /if \(!write\) return rows\.map\(\(row\) => \(\{ id: `mirror:\$\{row\.policy_number\}`/, "a preview stands them in, writing nothing");
  assert.match(store, /\.from\("policy_current"\)[^\n]*\.eq\("tenant_id", tenantId\)\.eq\("carrier_id", carrier\.id\)/, "this tenant's carrier file, this carrier");
  assert.match(store, /if \(made\.error\.code !== "23514"\)/, "before the migration the source check refuses them, and the lines stay unmatched");
  assert.match(service, /const \{ carrierPolicyMirrors: mirrors \} = await import\("\.\/statementMirrorStore"\);/, "loaded only by the paths that write lines");
  assert.doesNotMatch(service, /from\("policy_current"\)/, "the statement reads producers reach never touch policy_current");
  assert.match(service, /prepared = await prepare\(tenantId, base, sha256, \{ actorUserId \}\);/, "the import writes");
  assert.match(service, /const prepared = await prepare\(tenantId, input, input\.fileSha256\);/, "the preview does not");
  assert.equal((service.match(/carrierPolicyMirrors\(tenantId, /g) ?? []).length, 3, "import (via prepare), re-match and typed-in lines");
  const migration = read("supabase/migrations/20261120100000_tenant_policies_carrier_file_source.sql");
  assert.match(migration, /check \(source in \('manual', 'csv', 'carrier_file'\)\)/);
});

test("a mirror is not a second policy: the book leaves it out, and one check judges it", () => {
  const neq = /\.neq\("source", "carrier_file"\)/;
  for (const file of ["lib/ingestion/policyBookStore.ts", "lib/billing/bookExport.ts", "lib/dashboard/compare.ts", "lib/dashboard/summaries.ts", "lib/dashboard/today.ts", "lib/ingestion/expectedCommissionStore.ts", "lib/search/service.ts", "app/api/app/policies/route.ts"]) {
    assert.match(read(file), neq, file);
  }
  const detection = read("lib/ingestion/discrepancyStore.ts");
  assert.match(detection, /\.eq\("source", "carrier_file"\)/);
  assert.match(detection, /expected: expected\.filter\(\(x\) => !judgedByStatements\.has\(`\$\{x\.carrier_id\}\|\$\{x\.policy_number\}`\)\)/, "the carrier-file check skips what statements judge");
  assert.match(read("app/app/(shell)/policies/[id]/page.tsx"), /if \(mirror\) redirect\(mirror\);/, "a mirror's page is its carrier policy's page");
});

test("the carrier policy's Money tab shows the mirror's statement lines and pay issues", () => {
  const ledger = read("lib/ingestion/commissionLedgerStore.ts");
  assert.match(ledger, /const rows = fromFiles\.length \? fromFiles : await mirrorStatementRows\(tenantId, carrierId, policyNumber\);/, "statement lines only when no commission file paid it");
  assert.match(ledger, /href: `\/app\/statements\/\$\{row\.statement_id\}`/, "a statement line opens its statement");
  const findings = read("lib/ingestion/policyPageStore.ts");
  assert.match(findings, /from\("tenant_commission_discrepancies"\)[^\n]*\.in\("policy_id", ids\)/, "the statement check's issues on the mirror");
  assert.match(findings, /href: `\/app\/discrepancies\/\$\{d\.id\}`/);
  const tab = read("components/app/book/policy/commissions-tab.tsx");
  assert.match(tab, /row\.entry\.href \?\? rowHref\(/);
  assert.match(tab, /row\.finding\.href \?\? /);
});

test("a mirror's Expected is the rate card's first year: the advance plus its balance", () => {
  const library = {
    carriers: [{ id: "am", code: "americo", name: "Americo" }],
    products: [{ code: "term_life", name: "Term Life" }],
    tenantCarriers: [{ carrier_id: "am", contract_level_bp: 10000, effective_from: "2026-01-01" }],
    commissionSchedules: [{ id: "y1", tenant_id: "t", carrier_id: "am", product_code: "term_life", contract_level_bp: 10000, policy_year: 1, rate_bp: 10000, effective_from: "2026-01-01", created_at: "2026-01-01" }],
    advanceRules: [{ id: "r1", carrier_id: "am", product_code: "term_life", advance_months: 9, advance_pct_bp: 7500, clawback_months: 9, clawback_type: "prorated", effective_from: "2026-01-01" }],
  };
  const victor = { id: "m1", policyNumber: "AM-TL-55021", insuredName: "Victor Alvarez", carrier: "Americo", product: "Term Life", effectiveDate: "2026-11-20", annualPremiumCents: 51000, status: "active", statusChangedAt: null, createdBy: null };
  assert.deepEqual(mirrorExpectedRows(victor, library), [{ policy_year: 1, confidence: "rate_card", expected_amount_cents: 51000, rate_bp_applied: 10000, advance_pct_bp: 7500, advance_months: 9, commission_trigger: "on_issue" }]);
  const [none] = mirrorExpectedRows(victor, { ...library, commissionSchedules: [] });
  assert.equal(none.confidence, "no_rate_card", "no rate: says why, as the tab's Add the Rate expects");
  assert.match(read("lib/ingestion/expectedCommissionStore.ts"), /rows: rows\.length \? rows : await mirrorExpected\(tenantId, carrierId, policyNumber\)/, "only when the carrier files expect nothing");
});
