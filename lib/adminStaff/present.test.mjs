import test from "node:test";
import assert from "node:assert/strict";

import {
  LAST_SUPER_ADMIN_REFUSAL,
  SELF_REFUSAL,
  adminsFootnote,
  removesActiveSuperAdmin,
  roleFootnote,
  sortStaff,
  staffChangeRefusal,
  staffDate,
  staffDateTime,
  staffSummary,
} from "./present.ts";

const row = (over) => ({
  id: "a", email: "a@insurvas.test", name: "A", role: "support_agent", is_active: true,
  last_login_at: null, created_at: "2026-01-04T09:00:00Z", ...over,
});

test("the tiles count every role, and platform config shows in the Admins footnote only when there is one", () => {
  const rows = [
    row({ id: "1", role: "super_admin" }),
    row({ id: "2", role: "super_admin", is_active: false }),
    row({ id: "3", role: "billing_admin" }),
    row({ id: "4", role: "support_agent", is_active: false }),
  ];
  const summary = staffSummary(rows);
  assert.equal(summary.total, 4);
  assert.equal(summary.deactivated, 2);
  assert.equal(summary.superAdmins, 2);
  assert.equal(summary.activeSuperAdmins, 1);
  assert.equal(summary.billingAdmins, 1);
  assert.equal(summary.supportDeactivated, 1);
  assert.equal(adminsFootnote(summary), "2 deactivated");
  assert.equal(adminsFootnote(staffSummary([...rows, row({ id: "5", role: "platform_config" })])), "2 deactivated · 1 platform config");
  assert.equal(roleFootnote(0), "—");
  assert.equal(roleFootnote(1), "1 deactivated");
});

test("super admins first, then oldest first", () => {
  const sorted = sortStaff([
    row({ id: "old-support", created_at: "2026-01-01T00:00:00Z" }),
    row({ id: "new-super", role: "super_admin", created_at: "2026-06-01T00:00:00Z" }),
    row({ id: "old-super", role: "super_admin", created_at: "2026-02-01T00:00:00Z" }),
    row({ id: "new-billing", role: "billing_admin", created_at: "2026-03-01T00:00:00Z" }),
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ["old-super", "new-super", "old-support", "new-billing"]);
});

test("times are UTC with the zone written out, whatever the machine's zone", () => {
  assert.equal(staffDateTime("2026-09-22T08:40:55Z"), "22 Sep 2026 08:40:55 UTC");
  assert.equal(staffDateTime("2026-09-22T00:05:00Z"), "22 Sep 2026 00:05:00 UTC");
  assert.equal(staffDate("2026-01-04T23:59:00Z"), "4 Jan 2026");
  assert.equal(staffDateTime(null), null);
  assert.equal(staffDate("not a date"), null);
});

test("nobody changes their own account", () => {
  const me = row({ id: "me", role: "super_admin" });
  assert.equal(staffChangeRefusal({ actorId: "me", target: me, change: { is_active: false }, activeSuperAdmins: 3 }), SELF_REFUSAL);
  assert.equal(staffChangeRefusal({ actorId: "me", target: me, change: { role: "billing_admin" }, activeSuperAdmins: 3 }), SELF_REFUSAL);
});

test("the last active super admin can be neither deactivated nor demoted", () => {
  const last = row({ id: "b", role: "super_admin" });
  for (const change of [{ is_active: false }, { role: "support_agent" }, { role: "platform_config", is_active: true }]) {
    assert.ok(removesActiveSuperAdmin(last, change));
    assert.equal(staffChangeRefusal({ actorId: "me", target: last, change, activeSuperAdmins: 1 }), LAST_SUPER_ADMIN_REFUSAL);
    assert.equal(staffChangeRefusal({ actorId: "me", target: last, change, activeSuperAdmins: 2 }), null);
  }
});

test("changes that keep or add an active super admin are never refused by the last-one rule", () => {
  const deactivatedSuper = row({ id: "c", role: "super_admin", is_active: false });
  assert.equal(removesActiveSuperAdmin(deactivatedSuper, { role: "billing_admin" }), false);
  assert.equal(removesActiveSuperAdmin(deactivatedSuper, { is_active: true }), false);
  assert.equal(removesActiveSuperAdmin(row({ role: "billing_admin" }), { is_active: false }), false);
  assert.equal(removesActiveSuperAdmin(row({ role: "super_admin" }), { role: "super_admin" }), false);
  assert.equal(staffChangeRefusal({ actorId: "me", target: row({ id: "d" }), change: { role: "super_admin" }, activeSuperAdmins: 1 }), null);
});
