// Run with: npm test
//
// The look the owner fixed on 2026-10-30, as source contracts, so a merge cannot quietly undo it:
// "no matter who merges it, or whoever pushes some code, this will stay consistent".
//
//   - every page shows its trail and title (PageHeader), and the top bar does not name the page;
//   - the sidebar: bigger text, bare group icons (no tile) with the arrow on the right, child pages with a
//     plain 16px icon, no tree lines;
//   - one filter chip (ToggleChip, 36px) and one figure strip (the mockups' StatStrip);
//   - one card: the mockups' 16px card.
//
// DB-free and network-free: reads source text only. Change a rule here only with the owner's yes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("every page header shows the trail and the title", () => {
  const header = code("components/ui/page-header.tsx");
  assert.doesNotMatch(header, /sr-only/, "the title is never hidden again");
  assert.match(header, /<PageTrail title=\{title\} \/>/, "the trail comes from the menu when the page passes none");
  assert.match(header, /<h1 data-page-title/, "the title is the page's one h1");
  assert.doesNotMatch(header, /if \(visible\)/, "no branch that hides the title");
});

test("the top bar does not name the page", () => {
  assert.doesNotMatch(code("components/app/app-top-bar.tsx"), /TopBarCrumb|leading=\{/, "the agent bar draws no crumb");
  for (const bar of ["components/admin/admin-top-bar.tsx", "components/partner/partner-top-bar.tsx"]) {
    assert.doesNotMatch(code(bar), /TopBarTitleCrumb|leading=\{/, `${bar} draws no crumb`);
  }
  assert.equal(existsSync(join(process.cwd(), "components/app/nav/top-bar-title-crumb.tsx")), false);
  assert.match(code("app/app/(shell)/layout.tsx"), /<PageTrailProvider menu=\{menu\}>/, "the shell hands the menu to the trail");
});

/** The owner's sidebar block in globals.css: from its heading to the end of the file. */
function sidebarBlock() {
  const css = read("app/globals.css");
  const at = css.indexOf("/* ══ The sidebar, owner 2026-10-30");
  assert.ok(at > -1, "the owner's sidebar block is in globals.css");
  return { css, at, block: css.slice(at) };
}

test("the sidebar block is the last word on the menu's look", () => {
  const { css, at } = sidebarBlock();
  const later = css.slice(css.indexOf("══ */", at) + 5);
  // Nothing after the block may restyle the menu's rows or icons.
  const foreign = later.split("\n").filter((line) => /portal-agent-nav/.test(line) && !line.startsWith(".portal-agent .portal-agent-nav"));
  assert.deepEqual(foreign, [], "no sidebar rule after the owner's block");
});

test("the sidebar's sizes, bare icons and the arrow on the right", () => {
  const { block } = sidebarBlock();
  // Owner 2026-10-30, later the same day: "remove the box and leave only the icons", arrow on the right.
  assert.match(block, /\.portal-agent-nav-icon \{[^}]*width: 20px; height: 20px; padding: 0; border-radius: 0;[^}]*background: none;/, "group icons are bare 20px glyphs, no tile");
  assert.doesNotMatch(block, /rgba\(255, 255, 255, \.07\)/, "no icon tile");
  assert.match(block, /\.portal-agent-nav-disclosure > \.portal-agent-nav-chevron \{[^}]*order: 1; margin-left: auto;/, "the arrow sits at the right end of the row");
  assert.match(block, /stroke-width: 2;/);
  assert.match(block, /font-size: \.9375rem; font-weight: 600;/, "groups are 15px/600");
  assert.match(block, /\.portal-agent-nav-link-nested \{[^}]*font-size: \.875rem;/, "pages are 14px");
  // Owner 2026-10-30, later the same day: every page shows its own icon, a plain 16px glyph with no tile.
  assert.doesNotMatch(block, /\.portal-agent-nav-link-nested \.portal-agent-nav-icon \{ display: none; \}/, "pages keep their icons");
  assert.match(block, /\.portal-agent-nav-link-nested \.portal-agent-nav-icon \{\s*width: 16px; height: 16px; padding: 0; border-radius: 0; background: none;/, "a page's icon is a plain 16px glyph");
});

test("no tree lines in the sidebar", () => {
  const { css, block } = sidebarBlock();
  assert.doesNotMatch(css, /Sidebar sub-navigation as a tree/, "the tree block does not come back");
  assert.doesNotMatch(css, /portal-agent-nav-sublist[^{]*> li::before \{\s*content: ""/, "no elbow on a page");
  assert.match(block, /\.portal-agent-nav-sublist \{[^}]*border-left: 0 !important;/, "no guide line");
  assert.match(block, /> li::before \{ content: none; display: none; \}/, "elbows switched off");
});

test("one filter chip: 36px, 14px semibold, a count badge", () => {
  const chip = code("components/ui/toggle-chip.tsx");
  assert.match(chip, /"inline-flex h-9 items-center[^"]*rounded-md[^"]*text-sm font-semibold/);
  assert.match(chip, /count\?: number \| string;/);
});

test("one figure strip: the mockups' label, figure and line", () => {
  const stat = code("components/ui/stat.tsx");
  assert.match(stat, /text-xs font-bold leading-\[1\.33\] uppercase tracking-\[0\.06em\]/, "label 12px/700 0.06em");
  assert.match(stat, /m-figure text-2xl font-bold/, "figure 24px/700");
  const card = code("components/ui/stat-card.tsx");
  assert.match(card, /<StatStrip /, "StatRow is the strip");
  assert.match(card, /<StatTile/, "StatCard is the tile");
  assert.doesNotMatch(card, /m-stat-card/, "no glossy foundation card");
});

test("one card: the mockups' 16px card", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.m-glass:not\(\.rounded-full\) \{ border-radius: 16px; \}/);
  assert.match(css, /\.dark \.m-glass \{\s*background: linear-gradient\(160deg, rgba\(255, 255, 255, \.06\), rgba\(255, 255, 255, \.015\)\);/);
  assert.match(css, /\.dark \.m-glass:is\(\.border-border, :not\(\[class\*="border-"\]\)\) \{ border-color: rgba\(255, 255, 255, \.09\); \}/);
  assert.doesNotMatch(code("components/app/home/home-panel.tsx"), /m-stat-card/, "home panels are the same card");
});
