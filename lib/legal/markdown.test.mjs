// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLegalMarkdown } from "./markdown.ts";

test("headings are recognised at both levels", () => {
  const blocks = parseLegalMarkdown("# Terms\n\n## 1. Scope");
  assert.deepEqual(blocks, [
    { kind: "heading", level: 1, text: "Terms" },
    { kind: "heading", level: 2, text: "1. Scope" },
  ]);
});

test("wrapped lines join into one paragraph", () => {
  const blocks = parseLegalMarkdown("These terms are\nbetween us\nand you.");
  assert.deepEqual(blocks, [{ kind: "paragraph", text: "These terms are between us and you." }]);
});

test("a blank line starts a new paragraph", () => {
  const blocks = parseLegalMarkdown("First.\n\nSecond.");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].text, "Second.");
});

test("bullets group into one list, and a wrapped bullet stays one item", () => {
  const blocks = parseLegalMarkdown("- Account data: name,\n  and work email\n- Usage data");
  assert.deepEqual(blocks, [
    { kind: "list", items: ["Account data: name, and work email", "Usage data"] },
  ]);
});

test("a list ends at a blank line rather than swallowing what follows", () => {
  const blocks = parseLegalMarkdown("- One\n- Two\n\nA paragraph.");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "list");
  assert.equal(blocks[1].kind, "paragraph");
});

test("HTML in the source is never treated as markup", () => {
  // Legal text is authored through an admin form. If this parser produced HTML, the publish
  // screen would be a stored-XSS hole aimed at every customer who reads the terms.
  const blocks = parseLegalMarkdown('<script>alert(1)</script> and <b>bold</b>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(blocks[0].text, "<script>alert(1)</script> and <b>bold</b>");
});

test("empty content produces no blocks rather than throwing", () => {
  assert.deepEqual(parseLegalMarkdown(""), []);
  assert.deepEqual(parseLegalMarkdown("\n\n  \n"), []);
});
