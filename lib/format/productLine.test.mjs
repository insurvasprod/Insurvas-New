import test from "node:test";
import assert from "node:assert/strict";
import { productLineLabel } from "./productLine.ts";

test("a product code reads as a product, in Title Case like every label", () => {
  assert.equal(productLineLabel("term_life"), "Term Life");
  assert.equal(productLineLabel("final_expense"), "Final Expense");
  assert.equal(productLineLabel("aca_health"), "ACA Health");
  assert.equal(productLineLabel("indexed_universal_life"), "Indexed Universal Life");
  assert.equal(productLineLabel("Term Life"), "Term Life");
  assert.equal(productLineLabel("term life"), "Term Life");
  assert.equal(productLineLabel("return_of_premium"), "Return of Premium");
  assert.equal(productLineLabel(""), "—");
  assert.equal(productLineLabel(null), "—");
});
