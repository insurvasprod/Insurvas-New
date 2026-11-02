// The control foundation (owner 2026-11-02, docs/design/UI-CONSISTENCY.md §6c): every native dropdown and
// date field opens the app's own panel, everywhere, with one closed look. Source contracts, so no later
// change quietly brings the browser's grey list back. DB-free and network-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the layer is mounted once, in the root layout, so every plane and dialog has it", () => {
  assert.match(code("app/layout.tsx"), /<NativeControls \/>/);
});

test("a pick goes through the real control, so its form and React's onChange see it", () => {
  const layer = code("components/ui/native-controls.tsx");
  assert.match(layer, /Object\.getOwnPropertyDescriptor\(proto, "value"\)\?\.set\?\.call\(el, value\)/);
  assert.match(layer, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(layer, /dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
});

test("it replaces the browser's list and calendar, keeps phones native, and honours an opt-out", () => {
  const layer = code("components/ui/native-controls.tsx");
  assert.match(layer, /event\.preventDefault\(\); \/\/ no browser list|event\.preventDefault\(\);\s*next\.el\.focus\(\);/);
  assert.match(layer, /matchMedia\("\(pointer: coarse\)"\)\.matches\) return;/, "a touch screen keeps its own picker");
  assert.match(layer, /dataset\.native === "keep"/);
  assert.match(layer, /el\.multiple \|\| el\.size > 1/, "a multi-select or list box is never touched");
  assert.match(layer, /el\.type === "date"/);
  assert.match(layer, /el\.type === "datetime-local"/);
  assert.match(layer, /\(!min \|\| value >= min\) && \(!max \|\| value <= max\)/, "a date field's min and max are honoured");
  assert.match(layer, /el\.closest\(CONTAINERS\)/, "inside a dialog the panel opens inside it");
});

test("one closed look for every dropdown and date field", () => {
  const css = read("app/globals.css");
  assert.match(css, /select:not\(\[multiple\]\):not\(\[size\]\) \{\n  -webkit-appearance: none;\n  appearance: none;/);
  assert.match(css, /input:is\(\[type="date"\], \[type="datetime-local"\]\)::-webkit-calendar-picker-indicator \{ display: none; \}/);
});
