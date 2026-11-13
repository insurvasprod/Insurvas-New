// The "Table · Chart" switch's address (Reports round 7, owner pick 0·A, 2026-11-11): lib/reports/show.ts.
// Run with: node --experimental-strip-types --test lib/reports/show.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SHOW_MODES, SHOW_PARAM, isShowMode, showHref, showOf } from "./show.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("showOf reads ?show= from every shape a page has", () => {
  assert.deepEqual([...SHOW_MODES], ["table", "chart"]);
  assert.equal(SHOW_PARAM, "show");
  // A server page's awaited searchParams.
  assert.equal(showOf({ show: "table" }), "table");
  assert.equal(showOf({ show: ["table", "chart"] }), "table", "a repeated parameter takes its first value");
  assert.equal(showOf({ show: "chart" }, "table"), "chart");
  // URLSearchParams and useSearchParams().
  assert.equal(showOf(new URLSearchParams("tab=timing&show=table")), "table");
  assert.equal(showOf({ get: (name) => (name === "show" ? "chart" : null) }, "table"), "chart");
});

test("showOf falls back to the page's default, never to nothing", () => {
  assert.equal(showOf({}), "chart", "reports default to the chart");
  assert.equal(showOf({}, "table"), "table", "a drill defaults to the table");
  assert.equal(showOf(undefined, "table"), "table");
  assert.equal(showOf(null), "chart");
  assert.equal(showOf({ show: "pie" }), "chart", "an unknown value is the default");
  assert.equal(showOf({ show: "" }, "table"), "table");
  assert.equal(showOf(new URLSearchParams("show=TABLE")), "chart", "values are exact");
  assert.equal(isShowMode("table"), true);
  assert.equal(isShowMode("donut"), false);
  assert.equal(isShowMode(undefined), false);
});

test("showHref sets ?show= and keeps every other parameter", () => {
  assert.equal(showHref("/app/true-cpa", "table"), "/app/true-cpa?show=table");
  assert.equal(showHref("/app/true-cpa?tab=vendors&from=2026-10-01", "table", { carrier: "aflac" }), "/app/true-cpa?tab=vendors&from=2026-10-01&show=table&carrier=aflac");
  assert.equal(showHref("/app/x?show=chart&tab=a", "table"), "/app/x?show=table&tab=a", "replaces, never repeats");
  assert.equal(showHref("/app/x?tab=a&carrier=b", "chart", { carrier: null, page: "" }), "/app/x?tab=a&show=chart", "null or empty removes a parameter");
  assert.equal(showHref("/app/x?tab=a#rows", "table", { week: 3 }), "/app/x?tab=a&show=table&week=3#rows", "the hash stays last");
});

test("the helper is importable from a server page: plain TypeScript, no client code", () => {
  const source = read("lib/reports/show.ts");
  assert.doesNotMatch(source, /^["']use client["']/m, "a server page cannot call a function from a client module");
  assert.doesNotMatch(source, /from "react"|from "next\//, "no React and no Next in the helper");
});

test("the switch writes the address with the router and keeps the other parameters", () => {
  const source = read("components/ui/view-switch.tsx");
  assert.match(source, /^"use client";/, "the switch is a client island");
  assert.match(source, /export function ViewSwitch\(\{ fallback = "chart"/, "a report's default is the chart");
  assert.match(source, /new URLSearchParams\(query\.toString\(\)\)/, "starts from every parameter already in the address");
  assert.match(source, /params\.set\(SHOW_PARAM, mode\)/);
  assert.match(source, /router\.replace\(`\$\{pathname\}\?\$\{params\}`, \{ scroll: false \}\)/, "replaces in place, no scroll");
  assert.match(source, /showOf\(query, fallback\)/, "reads the address the way a server page does");
  assert.match(source, /SWITCH_FRAME/, "IconViewSwitch's boxed look, not a new style");
  assert.match(source, /export function useShow\(/);
});

test("the Reports frame puts the switch on the title line only when asked", () => {
  const page = read("components/app/reports/reports-page.tsx");
  assert.match(page, /show\?: ShowMode/, "an optional prop");
  assert.match(page, /switcher=\{show \? <Suspense fallback=\{null\}><ViewSwitch fallback=\{show\} \/><\/Suspense> : undefined\}/);
  assert.match(page, /import type \{ ShowMode \} from "@\/lib\/reports\/show";/, "only the type comes from the helper");
  const slot = read("components/app/reports/reports-slot.tsx");
  // Without a switch the corner slot is exactly what it was; with one, the switch sits before the view's buttons.
  assert.match(slot, /: <div id="reports-corner" className="flex items-center gap-2 empty:hidden" \/>\}/);
  assert.match(slot, /\{switcher\}<div id="reports-corner"/);
  assert.match(slot, /tabs=\{<div id="reports-lead"/, "the tabs stay on the title line (sub-page foundation, 2026-11-09)");
});
