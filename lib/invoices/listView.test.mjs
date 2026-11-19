// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  daysOverdue, filterInvoices, invoiceViewParams, invoicesCsv, issuedRange, overdueAge,
  overdueAgeCounts, parseInvoiceView, DEFAULT_INVOICE_VIEW,
} from "./listView.ts";
import { likelyReason, reconciliationFacts, reconciliationRows, reconLensOf } from "./reconcile.ts";
import { inCreditNoteLens, matchesCreditNoteSearch, parseCreditNoteLens } from "./creditNotesView.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const row = (patch) => ({
  id: "i1", number: "INV-1001", tenant_id: "t1", tenant_name: "Ellery & Fields", status: "issued", total_cents: 29900,
  provider_total_cents: null, reconciliation: "pending", issued_at: "2026-11-01T00:00:00Z", due_at: "2026-11-01T00:00:00Z",
  paid_at: null, created_at: "2026-11-01T00:00:00Z", ...patch,
});

test("the view reads the lens, its aliases and the API's boolean spelling from the address", () => {
  assert.equal(parseInvoiceView(new URLSearchParams("lens=overdue")).lens, "overdue");
  assert.equal(parseInvoiceView(new URLSearchParams("lens=dont-match")).lens, "mismatched");
  assert.equal(parseInvoiceView(new URLSearchParams("mismatched=1")).lens, "mismatched");
  assert.equal(parseInvoiceView({ lens: "nonsense" }).lens, "all");
  assert.equal(parseInvoiceView({ status: "overdue" }).status, "overdue");
  assert.equal(parseInvoiceView({ status: "bogus" }).status, "all");
  assert.equal(parseInvoiceView(new URLSearchParams("age=60%2B")).age, "60+");
  assert.equal(parseInvoiceView({ customer: "t9" }).tenant, "t9");
  assert.deepEqual(invoiceViewParams(DEFAULT_INVOICE_VIEW), { lens: null, q: null, tenant: null, status: null, issued: null, age: null });
});

test("overdue age buckets: 0–30, 31–60, 60+", () => {
  const late = (days) => row({ status: "overdue", due_at: new Date(NOW - days * 86_400_000).toISOString() });
  assert.equal(overdueAge(late(16), NOW), "0-30");
  assert.equal(overdueAge(late(31), NOW), "31-60");
  assert.equal(overdueAge(late(61), NOW), "60+");
  assert.equal(overdueAge(row({ status: "paid" }), NOW), null);
  assert.equal(daysOverdue(row({ status: "paid" }), NOW), null);
  assert.deepEqual(overdueAgeCounts([late(3), late(40), late(90), late(120)], NOW), { "0-30": 1, "31-60": 1, "60+": 2 });
});

test("filters, the lens and the issued window combine", () => {
  const rows = [
    row({ id: "a", status: "overdue", due_at: "2026-09-01T00:00:00Z" }),
    row({ id: "b", reconciliation: "mismatched", provider_total_cents: 24900, issued_at: "2026-10-05T00:00:00Z" }),
    row({ id: "c", tenant_id: "t2", tenant_name: "Blair Test", number: "INV-0990", status: "paid" }),
  ];
  const view = (patch) => ({ ...DEFAULT_INVOICE_VIEW, ...patch });
  assert.deepEqual(filterInvoices(rows, view({ lens: "overdue" }), NOW).map((r) => r.id), ["a"]);
  assert.deepEqual(filterInvoices(rows, view({ lens: "overdue", age: "0-30" }), NOW).map((r) => r.id), []);
  assert.deepEqual(filterInvoices(rows, view({ lens: "mismatched" }), NOW).map((r) => r.id), ["b"]);
  assert.deepEqual(filterInvoices(rows, view({ q: "blair" }), NOW).map((r) => r.id), ["c"]);
  assert.deepEqual(filterInvoices(rows, view({ issued: "last-month" }), NOW).map((r) => r.id), ["b"]);
  const { from, to } = issuedRange("this-month", NOW);
  assert.equal(new Date(from).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(new Date(to).toISOString(), "2026-12-01T00:00:00.000Z");
});

test("the CSV guards formula-like names and writes dollars", () => {
  const csv = invoicesCsv([row({ tenant_name: "=HYPERLINK(1)" })], NOW);
  assert.match(csv, /^"Invoice","Customer"/);
  assert.match(csv, /"'=HYPERLINK\(1\)"/);
  assert.match(csv, /"299.00"/);
});

test("likely reasons from lines and coupons", () => {
  const base = { total_cents: 29900, discount_cents: 0, lines: [{ kind: "plan", label: "Agency", amount_cents: 24900 }, { kind: "addon", label: "Seats", amount_cents: 5000 }] };
  assert.equal(likelyReason({ ...base, provider_total_cents: null }), "no_charge");
  assert.equal(likelyReason({ ...base, provider_total_cents: 24900 }), "addon_here_only");
  assert.equal(likelyReason({ ...base, provider_total_cents: 20000 }), "discount_at_provider");
  assert.equal(likelyReason({ total_cents: 19900, discount_cents: 5000, lines: [], provider_total_cents: 24900 }), "discount_here_only");
  assert.equal(likelyReason({ total_cents: 19900, discount_cents: 0, lines: [], provider_total_cents: 24900 }), "provider_charged_more");
});

test("reconciliation rows: open rows count, explained rows are settled", () => {
  const invoices = [
    { id: "i1", number: "INV-1042", tenant_id: "t1", tenant_name: "Admin Team", status: "paid", total_cents: 29900, discount_cents: 0, provider_total_cents: 24900, provider_payment_id: "pay_1", issued_at: null, lines: [] },
    { id: "i2", number: "INV-1038", tenant_id: "t2", tenant_name: "QA", status: "issued", total_cents: 14900, discount_cents: 0, provider_total_cents: null, provider_payment_id: null, issued_at: null, lines: [] },
  ];
  const payments = [{ id: "p1", tenant_id: "t3", tenant_name: "Rowan", amount_cents: 24900, provider_charge_id: "ch_1", paid_at: "2026-11-01T00:00:00Z" }];
  const explanations = [{ invoice_id: "i2", payment_id: null, note: "Comped", explained_by_name: "Sam", created_at: "2026-11-10T00:00:00Z" }];
  const rows = reconciliationRows(invoices, payments, explanations);
  assert.deepEqual(rows.map(reconLensOf), ["mismatched", "settled", "provider"]);
  assert.equal(rows[2].differenceCents, -24900);
  assert.deepEqual(reconciliationFacts(rows), { mismatched: 1, differenceCents: 5000, billedMoreOn: 1, providerOnly: 1, settled: 1 });
});

test("credit note lenses and search", () => {
  const note = (patch) => ({ id: "n", number: "CN-0001", status: "succeeded", amount_cents: 100, reason_text: null, requested_by: "a1", created_at: "", reconciliation_state: "reconciled", tenants: { name: "Admin Team" }, invoice: { id: "i", number: "INV-1042" }, ...patch });
  assert.equal(parseCreditNoteLens("pending"), "approval");
  assert.equal(parseCreditNoteLens("??"), "all");
  assert.ok(inCreditNoteLens(note({ status: "pending_approval" }), "approval"));
  assert.ok(inCreditNoteLens(note({ reconciliation_state: "provider_pending" }), "reconciliation"));
  assert.ok(matchesCreditNoteSearch(note({}), "inv-1042"));
  assert.ok(!matchesCreditNoteSearch(note({}), "zzz"));
});
