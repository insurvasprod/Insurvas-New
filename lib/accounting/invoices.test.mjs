// LA-7.2 (Notion sprint, Module 7 — Accounting) · lead cost and vendor invoice capture.
// Run with: node --experimental-strip-types --test lib/accounting/invoices.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { comparisonSummary, fromTemplate, invoiceTotals, lineAmount, previousMonth, templateInputs, unattributed } from "./invoicesCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015210000_la_7_2_vendor_invoices.sql";

test("one invoice, many campaigns: attribution sits on the line", () => {
  const sql = read(MIGRATION);
  const line = sql.slice(sql.indexOf("create table if not exists public.vendor_invoice_line"), sql.indexOf("create index if not exists vendor_invoice_line_invoice_idx"));
  assert.match(line, /campaign_id uuid references public\.tenant_campaigns\(id\)/);
  const header = sql.slice(sql.indexOf("create table if not exists public.vendor_invoice ("), sql.indexOf("create unique index if not exists vendor_invoice_number_vendor"));
  assert.doesNotMatch(header, /campaign_id/, "the invoice itself has no campaign");
  assert.match(sql, /'campaign_id', l\.campaign_id,/, "each line's campaign reaches its ledger entry");
});

test("approving writes one negative lead cost per line, dated by the line's period or else the invoice date", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /for l in select \* from public\.vendor_invoice_line where invoice_id = i\.id and amount_cents > 0/);
  assert.match(sql, /'entry_type', 'lead_cost', 'amount_cents', -l\.amount_cents,\n\s+'incurred_on', coalesce\(l\.period_start, i\.invoice_date\)/);
  assert.match(sql, /'invoice_id', i\.id,/);
  assert.match(sql, /the lines add up to % cents but the subtotal is % cents/);
});

test("paid sets paid_on on the invoice and its entries and nothing else; void reverses and deletes nothing", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /v_n := public\.mark_cost_entries_paid\(p_tenant_id, v_ids, p_paid_on\);/);
  assert.match(sql, /perform public\.reverse_cost_entry\(p_tenant_id, e\.id, 'Invoice ' \|\| i\.invoice_number \|\| ' voided: '/);
  assert.match(sql, /raise exception 'An invoice is never removed; void it instead\.'/);
  assert.match(sql, /revoke delete, truncate on public\.vendor_invoice from service_role;/);
  assert.match(sql, /raise exception 'An approved invoice is history: void it and enter it again\.'/);
  // Approving, paying and voiding are the writers' alone, and their flag is cleared before they return.
  for (const fn of ["approve_vendor_invoice", "mark_vendor_invoice_paid", "void_vendor_invoice"]) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
    const end = body.indexOf("\n$$;");
    assert.match(body.slice(0, end), /perform set_config\('app\.vendor_invoice_writer', 'on', true\);[\s\S]*perform set_config\('app\.vendor_invoice_writer', '', true\);/, fn);
  }
});

test("the comparison counts from deal flow, LA-6.2 rejects and LA-2.19 credits — the agency's own records", () => {
  const sql = read(MIGRATION);
  const fn = sql.slice(sql.indexOf("create or replace function public.vendor_invoice_comparison"), sql.indexOf("-- ─── approve"));
  assert.match(fn, /from public\.deal_flow d/);
  assert.match(fn, /from public\.transfer_verdict v where v\.tenant_id = \$1 and v\.partner_id = \$2 and v\.verdict = ''reject''/);
  assert.match(fn, /from public\.lead_claims c[\s\S]*c\.status in \('accepted', 'partial'\)/);
  assert.match(fn, /from public\.agent_lead_import_batches b/);
  assert.match(fn, /our_cents := case when countable then v_acc::bigint \* l\.unit_price_cents - v_cents else l\.amount_cents end;/);
});

test("a difference beyond tolerance flags the invoice and never blocks approval; the tolerance is the agency's", () => {
  const rows = [
    { countable: true, invoicedCents: 639000, ourCents: 585000, differenceCents: -54000 },
    { countable: false, invoicedCents: 70000, ourCents: 70000, differenceCents: 0 },
  ];
  assert.deepEqual(comparisonSummary(rows, 5000), { invoicedCents: 709000, ourCents: 655000, differenceCents: -54000, flagged: true, toleranceCents: 5000, uncountedLines: 1 });
  assert.equal(comparisonSummary(rows, 60000).flagged, false);
  const sql = read(MIGRATION);
  assert.match(sql, /select coalesce\(\(select s\.invoice_tolerance_cents from public\.accounting_settings s where s\.tenant_id = p_tenant_id\), 5000\) into v_tol;/);
  assert.match(sql, /flagged = abs\(v_diff\) > v_tol/);
  assert.doesNotMatch(sql.slice(sql.indexOf("create or replace function public.approve_vendor_invoice")), /raise exception[^;]*(differ|toleran)/i, "no refusal on a difference");
});

test("unattributed lines are counted and visible, never absorbed", () => {
  assert.deepEqual(unattributed([{ campaignId: "c1", amountCents: 100 }, { campaignId: null, amountCents: 70000 }, { campaignId: null, amountCents: 5 }]), { lines: 2, amountCents: 70005 });
  assert.match(read("components/app/accounting/invoices-board.tsx"), /not attributed to a campaign: counted in your costs, not in any campaign&apos;s cost per policy/);
});

test("a recurring template pre-fills a monthly invoice to three fields", () => {
  const t = { id: "t", name: "Apex monthly", vendorId: null, partnerId: "p", taxCents: 0, lines: [{ description: "Live transfers", campaignId: "c", leadType: "live_transfer", unitPriceCents: 9000 }] };
  assert.deepEqual(templateInputs(t), ["invoiceNumber", "invoiceDate", "quantity0"]);
  const inv = fromTemplate(t, { invoiceNumber: " APX-0826 ", invoiceDate: "2026-09-02", quantities: [71] });
  assert.equal(inv.invoiceNumber, "APX-0826");
  assert.deepEqual([inv.periodStart, inv.periodEnd], ["2026-08-01", "2026-08-31"]);
  assert.equal(inv.totalCents, 639000);
  assert.equal(inv.lines[0].campaignId, "c");
  // A flat fee line needs no quantity: still within three fields for a one-transfer-line template.
  assert.deepEqual(templateInputs({ lines: [...t.lines, { description: "Setup", campaignId: null, leadType: "other", unitPriceCents: 0, amountCents: 5000 }] }), ["invoiceNumber", "invoiceDate", "quantity0"]);
  assert.deepEqual(previousMonth("2026-01-15"), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(previousMonth("2028-03-01"), { start: "2028-02-01", end: "2028-02-29" });
});

test("line maths is integer cents; the server recomputes totals, never trusting the browser's", () => {
  assert.equal(lineAmount({ quantity: 71, unitPriceCents: 9000 }), 639000);
  assert.equal(lineAmount({ quantity: 2000, unitPriceCents: 50, amountCents: 99999 }), 99999);
  assert.deepEqual(invoiceTotals([{ quantity: 3, unitPriceCents: 333 }, { quantity: 1, unitPriceCents: 1, amountCents: 1 }], 15), { subtotalCents: 1000, taxCents: 15, totalCents: 1015 });
  const store = read("lib/accounting/invoiceStore.ts");
  assert.match(store, /const t = invoiceTotals\(input\.lines, input\.taxCents\);/);
  assert.doesNotMatch(read("lib/accounting/invoiceSchemas.ts"), /subtotal_cents|total_cents/, "the request carries no totals");
});

test("the document is tenant-scoped, behind a 60-second signed link", () => {
  const store = read("lib/accounting/invoiceStore.ts");
  assert.match(store, /const path = `\$\{tenantId\}\/invoices\/\$\{id\}\/\$\{crypto\.randomUUID\(\)\}-\$\{safeName\}`;/);
  assert.match(store, /if \(!path \|\| !path\.startsWith\(`\$\{tenantId\}\/invoices\/\$\{id\}\/`\)\)/);
  assert.match(store, /createSignedUrl\(path, 60\)/);
  assert.match(read(MIGRATION), /values \('accounting-files', 'accounting-files', false,/);
});

test("owner and bookkeeper only, on every invoice route", () => {
  for (const f of ["app/api/app/accounting/invoices/route.ts", "app/api/app/accounting/invoices/[id]/route.ts", "app/api/app/accounting/invoices/[id]/document/route.ts", "app/api/app/accounting/invoice-templates/route.ts"]) {
    assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "bookkeeper"], f);
    assert.match(read(f), /const ROLES = \["owner", "bookkeeper"\] as const;/, f);
    assert.match(read(f), /requireFeatureRole\("profit_and_loss", ROLES/, f);
  }
  assert.match(read("app/app/(shell)/invoices/page.tsx"), /if \(!actAsPage\(guard, \["owner", "bookkeeper"\]\)\)/);
});
