// Run with: npm test
//
// The v3 shared components (docs/design/foundation-v3/SPEC-foundation-components.md) as source
// contracts: the button shape, the stat card's surface, the filter slot, and the promise that the
// old StatStrip/StatTile stay untouched while pages move to StatRow/StatCard one by one.
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("buttons have 8px corners at every size (UI-CONSISTENCY §5a)", () => {
  const button = code("components/ui/button.tsx");
  assert.doesNotMatch(button, /rounded-full/, "Button must not be pill-shaped; marketing CTAs opt in with their own class");
  assert.match(button, /inline-flex[^"]*\brounded-md\b/, "the base class sets rounded-md (8px)");
});

test("the stat card draws its surface from the gloss tokens and names no colour", () => {
  const card = code("components/ui/stat-card.tsx");
  assert.match(card, /export function StatRow\b/);
  assert.match(card, /export function StatCard\b/);
  assert.doesNotMatch(card, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "colours come from tokens");
  assert.doesNotMatch(card, /\btrend\b|Sparkline/, "the v3 card has no trend chart (decision 2026-10-27)");

  const css = read("app/globals.css");
  const rules = css.slice(css.indexOf(".m-stat-card {"), css.indexOf("/* ── Glass + glow layer"));
  for (const token of ["--gloss-top", "--gloss-bottom", "--gloss-sheen", "--gloss-rim", "--gloss-shadow", "--gloss-foot", "--stat-icon-top"]) {
    assert.ok(rules.includes(`var(${token})`), `.m-stat-card rules must read ${token}`);
  }
  assert.match(rules, /prefers-reduced-motion: no-preference/, "the hover lift is off under reduced motion");
});

test("StatStrip and StatTile are untouched: no glossy surface leaked into them", () => {
  const stat = code("components/ui/stat.tsx");
  assert.match(stat, /m-stat-strip m-glass/, "StatStrip keeps its strip and glass");
  assert.doesNotMatch(stat, /m-stat-card|--gloss-/, "the gloss belongs to StatCard only");
  assert.match(stat, /goodWhen\?: "up" \| "down" \| "neither"/, "DeltaChip accepts goodWhen=\"neither\"");
});

test("the table card renders filters between the toolbar and the table", () => {
  const card = code("components/ui/table-card.tsx");
  const toolbar = card.indexOf("{toolbar}");
  const filters = card.indexOf("{filters}");
  const body = card.indexOf("{children}");
  assert.ok(toolbar > -1 && filters > toolbar && body > filters, "order must be toolbar → filters → table");

  const toolbarFile = code("components/ui/data-toolbar.tsx");
  assert.match(toolbarFile, /export function FilterPanel\b/);
  assert.match(toolbarFile, /export function ActiveFilters\b/);
  assert.match(toolbarFile, /aria-controls=\{controls\}/, "FilterButton points at its panel");
});

test("page titles use the display face", () => {
  assert.match(code("components/ui/page-header.tsx"), /<h1[^>]*var\(--font-display\)/);
});
