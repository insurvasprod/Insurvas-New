// Run with: node --experimental-strip-types --test lib/invoices/providerMatch.test.mjs
//
// The payment for a pay-online invoice used to be unrecognisable (plan_not_ours → a 500 for three
// days, the invoice never paid). These pin what makes it recognisable.
import { test } from "node:test";
import assert from "node:assert/strict";

import { invoiceMarker, localInvoiceIdFromNote, providerInvoiceRef, INVOICE_MARKER_PREFIX } from "./providerMatch.ts";

const ID = "0f1e2d3c-4b5a-4968-8776-655443322110";

test("the marker round-trips through the plan's internal notes", () => {
  assert.equal(invoiceMarker(ID), `${INVOICE_MARKER_PREFIX}${ID}`);
  assert.equal(localInvoiceIdFromNote(invoiceMarker(ID)), ID);
  assert.equal(localInvoiceIdFromNote(`Note by finance. ${invoiceMarker(ID.toUpperCase())}`), ID);
});

test("a note without the marker, or with a mangled id, names nothing", () => {
  assert.equal(localInvoiceIdFromNote("customer asked for net 30"), null);
  assert.equal(localInvoiceIdFromNote(`${INVOICE_MARKER_PREFIX}not-a-uuid`), null);
  assert.equal(localInvoiceIdFromNote(null), null);
});

test("a payment for one of our invoices is recognised from the plan notes", () => {
  const ref = providerInvoiceRef({ id: "pay_1", plan: { id: "plan_x", internal_notes: invoiceMarker(ID), metadata: null } });
  assert.deepEqual(ref, { localInvoiceId: ID, providerInvoiceId: null });
});

test("Whop's own invoice id is used when the payment carries one", () => {
  assert.deepEqual(providerInvoiceRef({ id: "pay_1", invoice: { id: "inv_abc123" } }), { localInvoiceId: null, providerInvoiceId: "inv_abc123" });
  assert.deepEqual(providerInvoiceRef({ id: "pay_1", invoice_id: "inv_Z9" }), { localInvoiceId: null, providerInvoiceId: "inv_Z9" });
  // Something that is not a Whop invoice id is not trusted as one.
  assert.equal(providerInvoiceRef({ id: "pay_1", invoice_id: "'; drop table" }), null);
});

test("a subscription payment (our plan metadata, no invoice) is not an invoice payment", () => {
  const data = { id: "pay_2", plan: { id: "plan_y", metadata: { insurvas_plan_id: "p", insurvas_billing_cycle: "monthly" } } };
  assert.equal(providerInvoiceRef(data), null);
  assert.equal(providerInvoiceRef(undefined), null);
});
