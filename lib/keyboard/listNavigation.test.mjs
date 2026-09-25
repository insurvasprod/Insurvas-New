import test from "node:test";
import assert from "node:assert/strict";
import { isTypingTarget, listKeyDirection, nextListIndex } from "./listNavigation.ts";

test("J moves down and K moves up, in either case, and nothing else is a list key", () => {
  assert.equal(listKeyDirection({ key: "j" }), "next");
  assert.equal(listKeyDirection({ key: "J" }), "next");
  assert.equal(listKeyDirection({ key: "k" }), "previous");
  assert.equal(listKeyDirection({ key: "K" }), "previous");
  assert.equal(listKeyDirection({ key: "l" }), null);
  assert.equal(listKeyDirection({ key: "/" }), null);
});

test("a modifier turns J and K into somebody else's shortcut", () => {
  assert.equal(listKeyDirection({ key: "k", metaKey: true }), null);
  assert.equal(listKeyDirection({ key: "k", ctrlKey: true }), null);
  assert.equal(listKeyDirection({ key: "j", altKey: true }), null);
});

test("from outside the list J lands on the first row and K on the last", () => {
  assert.equal(nextListIndex(-1, 5, "next"), 0);
  assert.equal(nextListIndex(-1, 5, "previous"), 4);
});

test("movement stops at the ends instead of wrapping", () => {
  assert.equal(nextListIndex(0, 3, "previous"), 0);
  assert.equal(nextListIndex(2, 3, "next"), 2);
  assert.equal(nextListIndex(1, 3, "next"), 2);
  assert.equal(nextListIndex(1, 3, "previous"), 0);
});

test("an empty list has nowhere to go", () => {
  assert.equal(nextListIndex(-1, 0, "next"), -1);
  assert.equal(nextListIndex(0, 0, "previous"), -1);
});

test("keystrokes into fields are typing, not movement", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "textarea" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
});
