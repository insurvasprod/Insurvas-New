// Daily deal flow: the From/To inputs apply as they change, and applyFilter holds a reversed or
// incomplete range without applying it. The old Apply button warned; now a one-line inline message
// says why the range is not applied, for as long as it is not.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = (await readFile(new URL("../../components/app/deal-flow-workspace.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("a range applyFilter would ignore is explained inline, not dropped silently", () => {
  assert.match(component, /if \(!next\.from \|\| !next\.to \|\| next\.from > next\.to\) return;/, "applyFilter still holds an invalid range");
  assert.match(component, /const rangeProblem = !filters\.from \|\| !filters\.to \? "Choose both a From and a To date" : filters\.from > filters\.to \? "From must be on or before To" : null;/);
  assert.match(component, /\{rangeProblem && <span role="alert" className="[^"]*text-\[var\(--error-ink\)\][^"]*">\{rangeProblem\}<\/span>\}/);
  // It sits in the toolbar row, right after the To input.
  assert.ok(component.indexOf("{rangeProblem &&") > component.indexOf('aria-label="To"'));
  assert.ok(component.indexOf("{rangeProblem &&") < component.indexOf('aria-label="Filter by partner"'));
});
