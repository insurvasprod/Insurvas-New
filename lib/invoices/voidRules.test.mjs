// Run with: npm test
//
// Every invoice we currently hold is paid, so the API route's SUCCESS path cannot be exercised
// through the UI. The rule itself is pure, so it is tested here instead.
import { test } from "node:test";
import assert from "node:assert/strict";

import { voidRefusalReason, canViewInvoices, canVoidInvoices } from "./permissions.ts";

test("a paid invoice cannot be voided", () => {
  // The money moved. Voiding would leave our books disagreeing with the bank; the instrument for
  // undoing a paid invoice is a refund or a credit note.
  const reason = voidRefusalReason("paid");

  assert.ok(reason);
  assert.match(reason, /refund|credit note/i);
});

test("an already-void invoice is not voided twice", () => {
  assert.ok(voidRefusalReason("void"));
});

test("draft, issued, overdue and uncollectible invoices CAN be voided", () => {
  for (const status of ["draft", "issued", "overdue", "uncollectible"]) {
    assert.equal(voidRefusalReason(status), null, `${status} should be voidable`);
  }
});

test("a support_agent cannot open invoice screens at all", () => {
  // SA-3.3's acceptance criterion, stated as a test so it cannot quietly regress.
  assert.equal(canViewInvoices("support_agent"), false);
  assert.equal(canVoidInvoices("support_agent"), false);
});

test("platform_config is not a billing role either", () => {
  assert.equal(canViewInvoices("platform_config"), false);
});

test("super_admin and billing_admin can view and void", () => {
  for (const role of ["super_admin", "billing_admin"]) {
    assert.equal(canViewInvoices(role), true, role);
    assert.equal(canVoidInvoices(role), true, role);
  }
});
