// LA-3.23 acceptance criteria that are rules.
import test from "node:test";
import assert from "node:assert/strict";

const { targetSyncKey, shouldMove } = await import("./stageSync.ts");

const a = (attemptNo, status, outcome = null, hasQuote = true) => ({ attemptNo, status, outcome, hasQuote });

test("each application state maps to its stage", () => {
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "draft")] }), "quoted");
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "draft", null, false)] }), null);
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "ready")] }), "application_started");
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "submitted")] }), "submitted");
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "pending_carrier")] }), "pending_requirements");
  assert.equal(targetSyncKey({ caseStatus: "won", attempts: [a(1, "closed", "issued")] }), "issued");
});

test("a decline that opens attempt 2 returns the lead to Quoted; closing the case moves it to Lost", () => {
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "closed", "declined"), a(2, "draft", null, false)] }), "requoting");
  assert.equal(targetSyncKey({ caseStatus: "lost", attempts: [a(1, "closed", "declined")] }), "lost");
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "closed", "withdrawn")] }), "lost");
});

test("with two live attempts the stage tracks the more advanced one", () => {
  // Spouse on Submitted, primary still Quoted: the card sits at Submitted.
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "draft"), a(1, "submitted")] }), "submitted");
  // A decline on one while another sits at Submitted leaves the lead at Submitted.
  assert.equal(targetSyncKey({ caseStatus: "open", attempts: [a(1, "closed", "declined"), a(1, "submitted")] }), "submitted");
});

test("a manual drag wins; forward only except requoting and lost", () => {
  assert.deepEqual(shouldMove({ target: "submitted", currentKey: "quoted", lastHumanMoveAt: "2026-09-28T10:00:00Z", lastSyncAt: "2026-09-28T09:00:00Z" }), { move: false, reason: "manual_override" });
  assert.deepEqual(shouldMove({ target: "quoted", currentKey: "submitted", lastHumanMoveAt: null, lastSyncAt: null }), { move: false, reason: "backwards" });
  assert.deepEqual(shouldMove({ target: "requoting", currentKey: "submitted", lastHumanMoveAt: null, lastSyncAt: null }), { move: true, reason: null });
  assert.deepEqual(shouldMove({ target: "submitted", currentKey: "quoted", lastHumanMoveAt: null, lastSyncAt: null }), { move: true, reason: null });
});

const { currentSyncKey } = await import("./stageSync.ts");

test("a move made before the case opened is not an override; one made after it is", () => {
  // The dialer's disposition that led to the sale, then the case opened, then no sync yet.
  assert.deepEqual(shouldMove({ target: "quoted", currentKey: null, lastHumanMoveAt: "2026-09-28T09:00:00.000Z", lastSyncAt: null, caseOpenedAt: "2026-09-28T09:05:00.000Z" }), { move: true, reason: null });
  assert.deepEqual(shouldMove({ target: "submitted", currentKey: "quoted", lastHumanMoveAt: "2026-09-28T11:00:00.000Z", lastSyncAt: "2026-09-28T10:00:00.000Z", caseOpenedAt: "2026-09-28T09:05:00.000Z" }), { move: false, reason: "manual_override" });
  // A sync after the human move resumes syncing (the reconcile writes exactly that row).
  assert.deepEqual(shouldMove({ target: "submitted", currentKey: "quoted", lastHumanMoveAt: "2026-09-28T11:00:00.000Z", lastSyncAt: "2026-09-28T11:30:00.000Z", caseOpenedAt: "2026-09-28T09:05:00.000Z" }), { move: true, reason: null });
});

test("each mapped state moves the card exactly once: already there is not a move", () => {
  assert.deepEqual(shouldMove({ target: "submitted", currentKey: "submitted", lastHumanMoveAt: null, lastSyncAt: "2026-09-28T10:00:00.000Z" }), { move: false, reason: "already_there" });
  assert.deepEqual(shouldMove({ target: "requoting", currentKey: "requoting", lastHumanMoveAt: null, lastSyncAt: null }), { move: false, reason: "already_there" });
});

test("the card's stage reads back as the target when two keys share it", () => {
  const map = { quoted: "st-quoted", requoting: "st-quoted", submitted: "st-sub", pending_requirements: "st-sub" };
  assert.equal(currentSyncKey("st-quoted", map, "requoting"), "requoting");
  assert.equal(currentSyncKey("st-quoted", map, "submitted"), "quoted");
  assert.equal(currentSyncKey("st-sub", map, null), "pending_requirements");
  assert.equal(currentSyncKey("st-other", map, "quoted"), null);
  assert.equal(currentSyncKey(null, map, "quoted"), null);
});
