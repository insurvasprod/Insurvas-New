// The table foundation (owner 2026-11-02, docs/design/UI-CONSISTENCY.md §6b), as source contracts so no
// later change quietly undoes it: every TableCard fills to the screen's foot when it ends the page and
// spreads its columns evenly; a PagedTableCard fits its page to that room; a list's own switches sit on
// the Refresh line. DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("every TableCard lays itself out: a column that fills, with the layout helper in its table area", () => {
  const card = code("components/ui/table-card.tsx");
  assert.match(card, /"m-glass flex flex-col rounded-lg border border-border"/, "a column, so the footer sits on the bottom line");
  assert.match(card, /<div className=\{cn\("flex-1 overflow-x-auto", bodyClassName\)\}>\{children\}<TableCardLayout \/><\/div>/, "the table takes the room, accepts a body layout, and the helper rides in it");
});

test("the layout fills only a card that ends the page (or has just a footnote under it), and never narrows a column below its content", () => {
  const layout = code("components/ui/table-card-layout.tsx");
  assert.match(layout, /if \(!box\) return isLast\(card, stop\) \? window\.innerHeight - bottomGap\(\) : null;/, "outside a merged page, a card with something below it keeps its height");
  // Owner 2026-11-02 ("remove that scroll"): a footnote under the card in a merged page's column (Files'
  // legend) takes its room from the card, so card and footnote end on the rail's foot together.
  assert.match(layout, /return after > 0 && after <= FOOTNOTE_MAX \? foot - after : null;/, "a real block below keeps the card's height");
  assert.match(code("components/ui/use-fitting-page-size.ts"), /const line = fillLine\(card\) \?\? window\.innerHeight - bottomGap\(\);/, "the shared page-size hook pages to the same line");
  assert.match(layout, /card\.style\.minHeight = `\$\{room\}px`/);
  assert.match(layout, /if \(total >= room - 1\) \{ table\.style\.tableLayout = ""; return; \}/, "a table too wide for the card scrolls as before");
  assert.match(layout, /const big = open\.filter\(\(index\) => natural\[index\] > share\);/, "a column wider than its share keeps its width");
  assert.match(layout, /table\.dataset\.even === "off"/, "a table can opt out");
});

test("a PagedTableCard fits its page to the room left, and keeps 10 where it is not the page's last block", () => {
  const paged = code("components/ui/paged.tsx");
  assert.match(paged, /const fitted = useCardPageSize\(holder, total, PAGE\);/);
  assert.match(paged, /if \(line === null\) return fallback;/);
  assert.doesNotMatch(paged, /Math\.min\(pageSize, PAGE\)/, "the old 10-row cap is gone");
});

test("a list's own switches sit on the Refresh line", () => {
  // Round 7 (mockups-r7 4·A): Producer pay's month is a select on the title line, in the address; its list keeps
  // its total and Refresh on the Refresh line.
  const recon = code("components/app/agency/reconciliation-board.tsx");
  assert.match(recon, /<DataToolbar actions=\{<>[^]*?owed to[^]*?<RefreshButton /, "the total owed beside Refresh");
});
