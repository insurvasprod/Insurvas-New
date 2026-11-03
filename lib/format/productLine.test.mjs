import test from "node:test";
import assert from "node:assert/strict";
import { productLineLabel } from "./productLine.ts";

test("a product code reads as a product, in sentence case", () => {
  assert.equal(productLineLabel("term_life"), "Term life");
  assert.equal(productLineLabel("final_expense"), "Final expense");
  assert.equal(productLineLabel("aca_health"), "ACA health");
  assert.equal(productLineLabel("indexed_universal_life"), "Indexed universal life");
  assert.equal(productLineLabel("Term Life"), "Term life");
  assert.equal(productLineLabel(""), "—");
  assert.equal(productLineLabel(null), "—");
});
