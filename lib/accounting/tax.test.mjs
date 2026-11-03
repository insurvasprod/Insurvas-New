// LA-7.8 (Notion sprint, Module 7 — Accounting) · 1099s and tax-ready exports.
// Run with: node --experimental-strip-types --test lib/accounting/tax.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contractorReport, maskTaxId, normaliseTaxId, TAX_NOTICE } from "./taxCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";
import { la7Files } from "./la7Files.mjs";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015270000_la_7_8_tax.sql";
const payee = (name, paid, profile) => ({ payeeType: "partner", payeeId: name, displayName: name, paidCents: paid, profile });

test("contractor totals are on paid_on, not incurred_on", () => {
  const fn = read(MIGRATION).slice(read(MIGRATION).indexOf("create or replace function public.contractor_payments"));
  assert.match(fn, /c\.paid_on >= make_date\(p_year, 1, 1\) and c\.paid_on < make_date\(p_year \+ 1, 1, 1\)/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("$$;")), /incurred_on/);
});

test("over the threshold and not exempt requires a 1099; under is excluded and counted; exempt shows its reason; missing details are the actionable line", () => {
  const r = contractorReport([
    payee("Apex Communications LLC", 7184000, { legalName: "Apex Communications LLC", taxIdType: "ein", taxIdLast4: "4471", w9OnFile: true, exemptReason: null }),
    payee("M. Okafor", 1840000, { legalName: null, taxIdType: "ssn", taxIdLast4: "8815", w9OnFile: false, exemptReason: null }),
    payee("DataLeads Inc", 2100000, { legalName: "DataLeads Inc", taxIdType: "none", taxIdLast4: null, w9OnFile: false, exemptReason: "corporation" }),
    payee("Tiny vendor", 15000, null),
  ], 200000);
  assert.equal(r.requiringCount, 2);
  assert.equal(r.missingCount, 1);
  assert.deepEqual(r.rows.find((x) => x.displayName === "M. Okafor").missing, ["W-9", "legal name"]);
  assert.equal(r.rows.find((x) => x.displayName === "DataLeads Inc").exempt, "corporation");
  assert.equal(r.rows.find((x) => x.displayName === "DataLeads Inc").requires, false);
  assert.deepEqual(r.under.map((x) => x.displayName), ["Tiny vendor"]);
  assert.equal(r.rows[0].nameOnForm, "Apex Communications LLC", "the legal name is what goes on the form");
  // The threshold is the agency's setting ($2,000 default for 2026), never a constant in the report.
  assert.match(read(MIGRATION), /add column if not exists tax_1099_threshold_cents bigint not null default 200000/);
});

test("tax IDs are encrypted at rest, masked by default, and a reveal writes one audit row first", () => {
  assert.equal(maskTaxId("ein", "4471"), "EIN ••••4471");
  assert.equal(maskTaxId("ssn", null), "—");
  assert.deepEqual(normaliseTaxId("ein", "12-3454471"), { value: "123454471", last4: "4471" });
  assert.ok("error" in normaliseTaxId("ssn", "1234"));
  const store = read("lib/accounting/taxStore.ts");
  assert.match(store, /const enc = encryptSensitive\(n\.value, \{ tenantId, applicationId: id, fieldKey: FIELD \}\);/);
  const reveal = store.slice(store.indexOf("export async function revealTaxId"), store.indexOf("export type CategoryRow"));
  assert.ok(reveal.indexOf('from("payee_tax_reveal_log").insert') < reveal.indexOf("decryptSensitive("), "logged before it is decrypted");
  assert.match(reveal, /if \(!settings\.viewerRoles\.includes\(role\)\) throw new TaxError/);
  const sql = read(MIGRATION);
  assert.match(sql, /revoke select on public\.payee_tax_profile from tenant_app;/);
  assert.doesNotMatch(sql.match(/grant select \(([^)]*)\) on public\.payee_tax_profile to tenant_app/)[1], /ciphertext/);
  assert.match(sql, /revoke update on public\.payee_tax_reveal_log from service_role;/, "the reveal log is append-only");
  assert.match(sql, /add column if not exists tax_id_viewer_roles text\[\] not null default array\['owner'\]::text\[\]/);
  assert.doesNotMatch(read("app/api/app/accounting/tax/route.ts"), /metadata: \{[^}]*tax_id: b\.tax_id/, "the tax ID never reaches the audit row");
});

test("every type maps to a bucket; overrides win and are visible per line", () => {
  const sql = read(MIGRATION);
  for (const t of ["advance", "earned", "override", "held", "chargeback", "reversal", "fee", "advance_interest"]) assert.match(sql, new RegExp(`'commission_entry_type', '${t}'`), t);
  for (const t of ["lead_cost", "partner_payout", "producer_split", "platform_fee", "tool_subscription", "insurance", "professional_fee", "refund", "adjustment"]) assert.match(sql, new RegExp(`'cost_entry_type', '${t}'`), t);
  for (const t of ["software", "telephony", "data_services", "insurance", "professional_fees", "licensing", "office", "other"]) assert.match(sql, new RegExp(`'expense_category', '${t}'`), t);
  assert.match(sql, /select coalesce\(t\.tax_category, d\.tax_category, 'other'\)/);
  assert.match(read("components/app/accounting/tax-board.tsx"), /yours \(default: \{TAX_CATEGORY_LABELS\[m\.defaultCategory\]\}\)/);
});

test("the export: totals, transactions and contractors, XLSX and CSV, each opening with the notice", () => {
  const store = read("lib/accounting/taxStore.ts");
  assert.match(store, /Totals: \[\.\.\.header,/);
  assert.match(store, /Transactions: \[\.\.\.header,/);
  assert.match(store, /Contractors: \[\.\.\.header,/);
  assert.match(store, /const header = \[\[TAX_NOTICE\], \[`Summary of recorded transactions for \$\{year\}, \$\{settings\.basis\} basis\. Not a tax return\.`\],/);
  // LA-8.3: then who the figures are for — the legal name, the tax ID masked, the address — from the business identity.
  assert.match(store, /\[`\$\{payer\.legalName \?\? ""\} · \$\{payer\.taxIdType === "ssn" \? "SSN" : "EIN"\} \$\{maskTaxId\(payer\.taxIdType, payer\.taxIdLast4\)\}`\]/);
  assert.match(store, /wb\.xlsx\.writeBuffer\(\)/);
  assert.match(store, /if \(format === "csv"\)/);
});

test("the not-tax-advice notice renders on both screens and cannot be dismissed or edited", () => {
  assert.equal(TAX_NOTICE, "These figures come from the transactions you have recorded. They are not tax advice and have not been reviewed by an accountant. Check them before filing.");
  const board = read("components/app/accounting/tax-board.tsx");
  const notice = board.slice(board.indexOf("export function TaxNotice"), board.indexOf("function ProfileDialog"));
  assert.doesNotMatch(notice, /onClose|dismiss|useState|button/i);
  assert.match(board, /return \(\n\s+<>\n\s+<TaxNotice \/>/, "on the board (contractors, categories and export tabs)");
  assert.match(read("app/app/(shell)/tax/page.tsx"), /<TaxNotice \/>/, "and when the page cannot load");
  assert.doesNotMatch(read("supabase/migrations/20261015270000_la_7_8_tax.sql"), /tax_notice/, "no setting holds the notice");
});

test("no official form is generated and nothing is filed", () => {
  for (const f of la7Files()) assert.doesNotMatch(read(f), /irs\.gov\/(efile|fire)|e-?file|fire\.irs|1099-?NEC.*pdf|form1099/i, f);
  for (const f of ["app/api/app/accounting/tax/route.ts", "app/api/app/accounting/tax/export/route.ts"]) {
    assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "bookkeeper"], f);
  }
});
