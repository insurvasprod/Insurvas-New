import { test } from "node:test";
import assert from "node:assert/strict";

import { canAddPeople, canChangeRole, canPost, canRemove, nextOwner, sortMembers } from "./groupRules.ts";

const m = (userId, role, extra = {}) => ({ userId, role, canAddMembers: false, addedAt: `2026-10-28T10:0${userId.length}:00Z`, ...extra });
const owner = m("o", "owner");
const admin = m("aa", "admin");
const admin2 = m("bbb", "admin");
const member = m("cccc", "member");
const viewer = m("ddddd", "viewer");

test("viewers read only; members write", () => {
  assert.equal(canPost(viewer), false);
  assert.equal(canPost(member), true);
  assert.equal(canPost(undefined), false);
});

test("a member adds people only with the switch on", () => {
  assert.equal(canAddPeople(member), false);
  assert.equal(canAddPeople({ ...member, canAddMembers: true }), true);
  assert.equal(canAddPeople({ ...viewer, canAddMembers: true }), false);
  assert.equal(canAddPeople(admin), true);
});

test("removal: nobody removes the owner; only the owner removes an admin; anyone but the owner may leave", () => {
  assert.equal(canRemove(admin, owner), false);
  assert.equal(canRemove(admin, admin2), false);
  assert.equal(canRemove(owner, admin), true);
  assert.equal(canRemove(admin, member), true);
  assert.equal(canRemove(member, viewer), false);
  assert.equal(canRemove(member, member), true);
  assert.equal(canRemove(owner, owner), false);
});

test("roles: only the owner makes or unmakes admins; nobody becomes owner by a role change", () => {
  assert.equal(canChangeRole(owner, member, "admin"), true);
  assert.equal(canChangeRole(admin, member, "admin"), false);
  assert.equal(canChangeRole(admin, member, "viewer"), true);
  assert.equal(canChangeRole(admin, admin2, "member"), false);
  assert.equal(canChangeRole(owner, member, "owner"), false);
  assert.equal(canChangeRole(admin, admin, "member"), false);
});

test("the owner's seat passes to the longest-standing admin, then member", () => {
  assert.equal(nextOwner([owner, member, admin2, admin], "o").userId, "aa");
  assert.equal(nextOwner([owner, viewer, member], "o").userId, "cccc");
  assert.equal(nextOwner([owner], "o"), null);
  assert.deepEqual(sortMembers([viewer, member, owner]).map((x) => x.role), ["owner", "member", "viewer"]);
});
