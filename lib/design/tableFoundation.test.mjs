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

test("the layout fills only a card that ends the page, and never narrows a column below its content", () => {
  const layout = code("components/ui/table-card-layout.tsx");
  assert.match(layout, /if \(!isLast\(card, stop\)\) return null;/, "a card with something below it keeps its height");
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
  const recon = code("components/app/agency/reconciliation-board.tsx");
  assert.match(recon, /<DataToolbar actions=\{<><Segmented label="Period"[^]*?<RefreshButton /, "Last month / This month beside Refresh");
});
