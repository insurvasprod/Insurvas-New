import assert from "node:assert/strict";
import test from "node:test";

import { isLiveOwner, resolveEditTenant, tenantsLeftWithoutOwner } from "./ownerGuard.ts";

const A = "tenant-a";
const B = "tenant-b";

test("a tenant whose only other owner was soft-deleted is blocked (the audit case)", () => {
  const rows = [
    { tenant_id: A, status: "active" }, // the owner being deleted
    { tenant_id: A, status: "deleted" }, // a removed co-owner: not an owner any more
  ];
  assert.deepEqual(tenantsLeftWithoutOwner([A], rows), [A]);
});

test("a live co-owner — active, invited, suspended or inactive — lets the delete through", () => {
  for (const status of ["active", "pending_verification", "suspended", "inactive"]) {
    assert.deepEqual(tenantsLeftWithoutOwner([A], [{ tenant_id: A, status: "active" }, { tenant_id: A, status }]), [], status);
  }
});

test("each owned tenant is judged on its own owners", () => {
  const rows = [
    { tenant_id: A, status: "active" },
    { tenant_id: A, status: "active" },
    { tenant_id: B, status: "active" },
  ];
  assert.deepEqual(tenantsLeftWithoutOwner([A, B], rows), [B]);
});

test("an owner row with no readable status does not count", () => {
  assert.equal(isLiveOwner(null), false);
  assert.deepEqual(tenantsLeftWithoutOwner([A], [{ tenant_id: A, status: "active" }, { tenant_id: A, status: null }]), [A]);
});

test("an edit names its tenant when the user has more than one", () => {
  assert.deepEqual(resolveEditTenant([A, B], undefined), { error: "ambiguous" });
  assert.deepEqual(resolveEditTenant([A, B], B), { tenantId: B });
  assert.deepEqual(resolveEditTenant([A], "tenant-c"), { error: "not_member" });
  assert.deepEqual(resolveEditTenant([A], null), { tenantId: A });
  assert.deepEqual(resolveEditTenant([], undefined), { tenantId: null });
});
