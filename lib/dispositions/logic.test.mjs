import assert from "node:assert/strict";
import test from "node:test";
import { composeNote, isTerminal, nextNodeForAnswer } from "./logic.ts";

const node = { node_type: "choice", next_node_id: null, options: [{ option_key: "yes", next_node_id: "next" }, { option_key: "no", next_node_id: null }] };

test("the wizard follows configured option edges, not array positions", () => {
  assert.equal(nextNodeForAnswer(node, "yes"), "next");
  assert.equal(nextNodeForAnswer(node, "no"), null);
  assert.equal(isTerminal(node, "no"), true);
});

test("note fragments compose in walked order", () => {
  assert.equal(composeNote(["First.", "", "Second."]), "First. Second.");
});
