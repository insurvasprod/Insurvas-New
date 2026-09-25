import test from "node:test";
import assert from "node:assert/strict";

import { invoiceMeta, membershipLabel } from "./adminFormat.ts";

test("a user's search row names their role and workspace, as the board draws it", () => {
  assert.equal(membershipLabel([{ role: "owner", tenants: { name: "Northline Insurance" } }], "r@x.test"), "Owner · Northline Insurance");
  assert.equal(
    membershipLabel([{ role: "producer", tenants: { name: "Northline" } }, { role: "owner", tenants: { name: "Bell & Vance" } }], null),
    "Producer · Northline +1 more",
  );
  assert.equal(membershipLabel([], "solo@x.test"), "solo@x.test · no workspace");
});

test("an invoice row reads as money and the date of its state", () => {
  assert.equal(
    invoiceMeta({ status: "paid", total_cents: 118800, currency: "usd", issued_at: "2026-09-01T00:00:00Z", paid_at: "2026-09-14T10:00:00Z" }),
    "$1,188.00 · paid 14 Sep",
  );
  assert.equal(
    invoiceMeta({ status: "overdue", total_cents: 5000, currency: "usd", issued_at: "2026-09-20T00:00:00Z", paid_at: null }),
    "$50.00 · overdue · issued 20 Sep",
  );
  assert.equal(invoiceMeta({ status: "draft", total_cents: null, currency: null, issued_at: null, paid_at: null }), "draft");
});

test("an issued invoice names its date once, not twice", () => {
  assert.equal(
    invoiceMeta({ status: "issued", total_cents: 80000, currency: "usd", issued_at: "2026-09-21T09:00:00Z", paid_at: null }),
    "$800.00 · issued 21 Sep",
  );
});
