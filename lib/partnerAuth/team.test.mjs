import test from "node:test";
import assert from "node:assert/strict";

import { narrowTo, visibleSubmitters } from "./team.ts";

/**
 * "The admin account can see the leads for their team, while the user can only see their leads, so
 * nobody else's" (owner, 2 Nov) — on Daily deal flow. Each case is named for the wrong answer it
 * prevents, because the wrong answer here is one partner reading another's book.
 */

const ADMIN = { userId: "u-admin", role: "partner_admin" };
const OTHER_ADMIN = { userId: "u-admin-2", role: "partner_admin" };
const USER = { userId: "u-casey", role: "partner_user" };

const member = (id, adminId) => ({ user_id: id, role: "partner_user", partner_admin_user_id: adminId });
const adminRow = (id) => ({ user_id: id, role: "partner_admin", partner_admin_user_id: null });

/** One organisation: two admins with a report each, and one member nobody has assigned. */
const ORG = [
  adminRow("u-admin"),
  adminRow("u-admin-2"),
  member("u-casey", "u-admin"),
  member("u-devon", "u-admin"),
  member("u-remy", "u-admin-2"),
  member("u-orphan", null),
];

/* ── A partner user is their own team ────────────────────────────────────────────────────────── */

test("a partner user sees nobody but themselves", () => {
  assert.deepEqual(visibleSubmitters(USER, ORG), ["u-casey"]);
});

test("a partner user's teammates do not leak in through the membership list", () => {
  // The wrong answer: reading "same admin" as "same team you may see". Casey and Devon report to
  // the same admin; that makes them colleagues, not each other's readers.
  assert.ok(!visibleSubmitters(USER, ORG).includes("u-devon"));
});

/* ── An admin's team is theirs, and only theirs ──────────────────────────────────────────────── */

test("an admin sees their own reports and themselves", () => {
  assert.deepEqual(visibleSubmitters(ADMIN, ORG).sort(), ["u-admin", "u-casey", "u-devon"]);
});

test("an admin does not see another admin's report", () => {
  // The wrong answer: filtering on "is a member of this organisation" instead of "reports to me".
  assert.ok(!visibleSubmitters(ADMIN, ORG).includes("u-remy"));
});

test("an admin does not see another admin's own submissions", () => {
  // Admins are peers: the trigger keeps partner_admin_user_id null on every admin row, so there is
  // no chain that would sweep one admin into another's team.
  assert.ok(!visibleSubmitters(ADMIN, ORG).includes("u-admin-2"));
  assert.ok(!visibleSubmitters(OTHER_ADMIN, ORG).includes("u-admin"));
});

test("an unassigned member's deals reach no admin", () => {
  // The owner's decision (1 Nov, reaffirmed 2 Nov): nobody but themselves. If this ever flips to
  // "every admin", this test is the one to change — deliberately, not by accident.
  assert.ok(!visibleSubmitters(ADMIN, ORG).includes("u-orphan"));
  assert.ok(!visibleSubmitters(OTHER_ADMIN, ORG).includes("u-orphan"));
  assert.deepEqual(visibleSubmitters({ userId: "u-orphan", role: "partner_user" }, ORG), ["u-orphan"]);
});

test("an admin with no reports yet sees their own submissions, not the organisation", () => {
  // The wrong answer: an empty team read as "no filter". A new admin sees themselves.
  assert.deepEqual(visibleSubmitters(ADMIN, [adminRow("u-admin"), member("u-remy", "u-admin-2")]), ["u-admin"]);
});

/* ── The shape the caller depends on ─────────────────────────────────────────────────────────── */

test("the list always holds the viewer and is never empty", () => {
  // A caller turns this into .in("created_by", ids), where [] matches nothing — and invites the
  // next reader to treat "empty" as "unscoped".
  for (const viewer of [USER, ADMIN, OTHER_ADMIN]) {
    for (const members of [ORG, []]) {
      const ids = visibleSubmitters(viewer, members);
      assert.ok(ids.length > 0);
      assert.ok(ids.includes(viewer.userId));
    }
  }
});

test("a member listed twice appears once", () => {
  const ids = visibleSubmitters(ADMIN, [member("u-casey", "u-admin"), member("u-casey", "u-admin")]);
  assert.deepEqual(ids, ["u-admin", "u-casey"]);
});

test("an admin row that wrongly points at itself does not duplicate the admin", () => {
  // The trigger forbids self-assignment; this is what happens if it is ever dropped.
  assert.deepEqual(visibleSubmitters(ADMIN, [{ user_id: "u-admin", role: "partner_admin", partner_admin_user_id: "u-admin" }]), ["u-admin"]);
});

test("the caller's membership list is not mutated or reordered", () => {
  const members = [member("u-devon", "u-admin"), member("u-casey", "u-admin")];
  const before = JSON.stringify(members);
  visibleSubmitters(ADMIN, members);
  assert.equal(JSON.stringify(members), before);
});

/* ── narrowTo: narrow, never widen ───────────────────────────────────────────────────────────── */

test("asking for nobody in particular keeps the whole team", () => {
  const ids = ["u-admin", "u-casey"];
  assert.deepEqual(narrowTo(ids), ids);
  assert.deepEqual(narrowTo(ids, null), ids);
  assert.deepEqual(narrowTo(ids, undefined), ids);
  assert.deepEqual(narrowTo(ids, ""), ids);
  assert.deepEqual(narrowTo(ids, "   "), ids, "a blank filter is not a request for a blank person");
});

test("asking for one of your own people narrows to them", () => {
  assert.deepEqual(narrowTo(["u-admin", "u-casey", "u-devon"], "u-casey"), ["u-casey"]);
});

test("asking for somebody you may not see changes nothing", () => {
  // The attack: ?submitted_by=<another team's member>. Not an error — an error would confirm the
  // id exists — and never an addition.
  const ids = ["u-admin", "u-casey"];
  assert.deepEqual(narrowTo(ids, "u-remy"), ids);
  assert.deepEqual(narrowTo(ids, "u-orphan"), ids);
});

test("a partner user cannot widen past themselves with the filter", () => {
  assert.deepEqual(narrowTo(visibleSubmitters(USER, ORG), "u-devon"), ["u-casey"]);
});

test("narrowTo returns a copy, so the caller's list cannot be aliased", () => {
  const ids = ["u-admin", "u-casey"];
  const out = narrowTo(ids);
  out.push("u-remy");
  assert.deepEqual(ids, ["u-admin", "u-casey"]);
});
