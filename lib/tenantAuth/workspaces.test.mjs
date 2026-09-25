import test from "node:test";
import assert from "node:assert/strict";
import { describeWorkspaces, isUsableMembership, pickLoginMembership } from "./workspaces.ts";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

test("a single membership signs in exactly as before, accepted or not", () => {
  assert.equal(pickLoginMembership([{ tenant_id: A, role: "owner", accepted_at: null }])?.tenant_id, A);
  assert.equal(pickLoginMembership([{ tenant_id: A, role: "producer", accepted_at: "2026-01-01T00:00:00Z" }])?.tenant_id, A);
});

test("with several, login opens the oldest accepted membership, every time", () => {
  const rows = [
    { tenant_id: B, role: "producer", accepted_at: "2026-05-01T00:00:00Z" },
    { tenant_id: A, role: "owner", accepted_at: "2026-02-01T00:00:00Z" },
    { tenant_id: C, role: "owner", accepted_at: null },
  ];
  assert.equal(pickLoginMembership(rows)?.tenant_id, A);
  assert.equal(pickLoginMembership([...rows].reverse())?.tenant_id, A);
});

test("unknown roles never sign in, and two unaccepted invitations are not a choice", () => {
  assert.equal(pickLoginMembership([{ tenant_id: A, role: "ghost", accepted_at: "2026-01-01T00:00:00Z" }]), null);
  assert.equal(pickLoginMembership([{ tenant_id: A, role: "owner", accepted_at: null }, { tenant_id: B, role: "owner", accepted_at: null }]), null);
  assert.equal(pickLoginMembership([]), null);
});

test("a pending invitation is not a workspace you can switch into", () => {
  assert.equal(isUsableMembership({ tenant_id: A, role: "owner", accepted_at: null }), false);
  assert.equal(isUsableMembership({ tenant_id: A, role: "owner", accepted_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(isUsableMembership({ tenant_id: A, role: "ghost", accepted_at: "2026-01-01T00:00:00Z" }), false);
});

test("the list is by name, marks where you are, and keeps the current one even if unaccepted", () => {
  const list = describeWorkspaces([
    { tenant_id: B, role: "producer", accepted_at: "2026-05-01T00:00:00Z", tenant_name: "Northline Insurance" },
    { tenant_id: A, role: "owner", accepted_at: null, tenant_name: "Harbor Group" },
    { tenant_id: C, role: "owner", accepted_at: null, tenant_name: "Invited Elsewhere" },
  ], A);
  assert.deepEqual(list.map((w) => [w.name, w.current, w.roleLabel]), [
    ["Harbor Group", true, "Owner"],
    ["Northline Insurance", false, "Producer"],
  ]);
});
