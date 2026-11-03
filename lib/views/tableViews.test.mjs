// Run with: npm test
//
// Saved views and row selection (2026-10-09): the pure half behind components/ui/saved-views.tsx
// and components/ui/bulk-bar.tsx. Saved views are per-browser for now (localStorage); these tests
// pin that a broken entry never breaks the control and that selection never keeps a row the list
// no longer shows.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addSavedView, canonicalView, matchView, parseSavedViews, pruneSelection, removeSavedView, sameView,
  selectionCoverage, serializeSavedViews, toggleAllSelected, toggleSelected, viewsStorageKey, MAX_SAVED_VIEWS,
} from "./tableViews.ts";

test("views live under one versioned key per list", () => {
  assert.equal(viewsStorageKey("leads.table"), "insurvas.views.v1:leads.table");
});

test("a partial built-in matches the page's full state; empty values filter nothing", () => {
  assert.ok(sameView({ scope: "mine" }, { scope: "mine", product: "", stage: null, missingOnly: false, tags: [] }));
  assert.ok(!sameView({ scope: "mine" }, { scope: "mine", product: "Term" }));
  assert.equal(canonicalView({ b: "2", a: "1" }), canonicalView({ a: "1", b: "2" }), "key order does not matter");
  assert.ok(sameView({ tags: ["b", "a"] }, { tags: ["a", "b"] }), "a multi-select is a set");
});

test("saved views round-trip through storage", () => {
  const views = addSavedView([], "  My overdue  ", { when: "overdue", day: "" }, "v1");
  const back = parseSavedViews(serializeSavedViews(views));
  assert.deepEqual(back, [{ id: "v1", name: "My overdue", state: { when: "overdue", day: "" } }]);
});

test("a broken or hand-edited entry reads as fewer views, never as an error", () => {
  assert.deepEqual(parseSavedViews(null), []);
  assert.deepEqual(parseSavedViews(""), []);
  assert.deepEqual(parseSavedViews("{not json"), []);
  assert.deepEqual(parseSavedViews("42"), []);
  const raw = JSON.stringify({ version: 1, views: [
    { id: "a", name: "Kept", state: { q: "x", nested: { no: true }, fn: null } },
    { id: "", name: "No id" },
    { id: "b", name: "   " },
    { id: "a", name: "Duplicate id" },
    "junk",
    { id: "c", name: "No state" },
  ] });
  assert.deepEqual(parseSavedViews(raw), [
    { id: "a", name: "Kept", state: { q: "x", fn: null } },
    { id: "c", name: "No state", state: {} },
  ]);
});

test("saving under an existing name replaces it; the list is capped; delete removes one", () => {
  let views = addSavedView([], "Mine", { scope: "mine" }, "1");
  views = addSavedView(views, "mine", { scope: "all" }, "2");
  assert.deepEqual(views.map((view) => [view.id, view.name]), [["2", "mine"]]);
  assert.deepEqual(addSavedView(views, "   ", { scope: "x" }, "3"), views, "an empty name adds nothing");
  for (let i = 0; i < MAX_SAVED_VIEWS + 5; i += 1) views = addSavedView(views, `v${i}`, { i: String(i) }, `id${i}`);
  assert.equal(views.length, MAX_SAVED_VIEWS);
  assert.equal(views.at(-1).name, `v${MAX_SAVED_VIEWS + 4}`, "newest kept");
  assert.equal(removeSavedView(views, views[0].id).length, MAX_SAVED_VIEWS - 1);
});

test("the current view is named by a built-in first, then by the person's own", () => {
  const builtIns = [{ id: "all", name: "All", state: {} }, { id: "mine", name: "Assigned to me", state: { scope: "mine" } }];
  const saved = [{ id: "s", name: "Mine again", state: { scope: "mine" } }, { id: "t", name: "Term", state: { product: "Term" } }];
  assert.equal(matchView({ scope: "", product: "" }, builtIns, saved)?.view.name, "All");
  assert.equal(matchView({ scope: "mine", product: "" }, builtIns, saved)?.view.name, "Assigned to me");
  assert.equal(matchView({ product: "Term" }, builtIns, saved)?.kind, "saved");
  assert.equal(matchView({ product: "Whole" }, builtIns, saved), null);
});

test("selection drops ids that leave the list, and keeps the same set when none did", () => {
  const selected = new Set(["a", "b", "c"]);
  assert.equal(pruneSelection(selected, ["a", "b", "c", "d"]), selected, "unchanged → same instance");
  assert.deepEqual([...pruneSelection(selected, ["a", "c"])], ["a", "c"]);
  assert.deepEqual([...pruneSelection(selected, [])], []);
});

test("toggle one, toggle all visible, and the header checkbox's three states", () => {
  assert.deepEqual([...toggleSelected(new Set(["a"]), "b")].sort(), ["a", "b"]);
  assert.deepEqual([...toggleSelected(new Set(["a"]), "a")], []);
  // Some of the page selected → select the rest; all selected → clear only the page.
  assert.deepEqual([...toggleAllSelected(new Set(["a", "x"]), ["a", "b"])].sort(), ["a", "b", "x"]);
  assert.deepEqual([...toggleAllSelected(new Set(["a", "b", "x"]), ["a", "b"])], ["x"]);
  assert.equal(selectionCoverage(new Set(), ["a"]), "none");
  assert.equal(selectionCoverage(new Set(["a"]), ["a", "b"]), "some");
  assert.equal(selectionCoverage(new Set(["a", "b"]), ["a", "b"]), "all");
  assert.equal(selectionCoverage(new Set(["a"]), []), "none");
});
