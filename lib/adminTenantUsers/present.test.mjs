import test from "node:test";
import assert from "node:assert/strict";

import { csvCell, lastSeenLabel, memberState, membersCsv, seatCallout, sortMembers } from "./present.ts";

const base = {
  id: "u1", name: "Priya Raman", email: "priya@example.test", status: "active", role: "producer",
  invitedAt: "2026-09-01T10:00:00Z", acceptedAt: "2026-09-02T10:00:00Z", lastSeenAt: null, lastLoginAt: null,
  inviteExpiresAt: null, signIns30d: 3, seat: "active", revocable: false, stale: false,
};

test("the board's variant: full, with two invites, in words", () => {
  const callout = seatCallout({ held: 12, invited: 2, max: 12 });
  assert.equal(callout.tone, "warning");
  assert.equal(callout.title, "Every seat is taken, and two of them are invites");
  assert.equal(callout.body, "An invite holds a seat from the moment it is sent. Two of these twelve have never been accepted, which is why the owner cannot invite a thirteenth person.");
});

test("the other variants say what is true", () => {
  assert.equal(seatCallout({ held: 5, invited: 0, max: 5 }).title, "Every seat is taken");
  assert.equal(seatCallout({ held: 3, invited: 1, max: 5 }).title, "Two of five seats are free");
  assert.equal(seatCallout({ held: 7, invited: 0, max: 5 }).tone, "error");
  assert.match(seatCallout({ held: 7, invited: 0, max: 5 }).body, /three seats are freed/);
  assert.equal(seatCallout({ held: 4, invited: 0, max: null }).title, "This plan does not limit seats");
  assert.match(seatCallout({ held: 10, invited: 1, max: 10 }).body, /cannot invite an eleventh person/);
});

test("state and last-seen cells use the board's wording", () => {
  assert.deepEqual(memberState({ ...base, seat: "invited", acceptedAt: null, revocable: true, invitedAt: "2026-09-09T12:00:00Z" }), { label: "Invited 9 Sep", tone: "info", note: null });
  assert.equal(memberState({ ...base, seat: null, status: "deactivated" }).label, "Deactivated");
  assert.equal(memberState({ ...base, seat: "suspended", status: "suspended" }).label, "Suspended");
  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.equal(lastSeenLabel({ lastSeenAt: "2026-09-24T11:56:00Z", lastLoginAt: null }, now), "4 min");
  assert.equal(lastSeenLabel({ lastSeenAt: "2026-09-24T11:00:00Z", lastLoginAt: null }, now), "1 hr");
  assert.equal(lastSeenLabel({ lastSeenAt: null, lastLoginAt: null }, now), "Never");
});

test("owners first, invites after working members, no-seat people last", () => {
  const rows = sortMembers([
    { ...base, id: "gone", seat: null, status: "deactivated" },
    { ...base, id: "inv", seat: "invited", acceptedAt: null, revocable: true },
    { ...base, id: "own", role: "owner" },
    { ...base, id: "pro" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["own", "pro", "inv", "gone"]);
});

test("the CSV neutralises formulas and quotes every cell", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell('say "hi"'), `"say ""hi"""`);
  const csv = membersCsv([base], (role) => role.toUpperCase());
  assert.match(csv, /^"Name","Email"/);
  assert.match(csv, /"priya@example\.test","PRODUCER","Active","Yes"/);
});
