/**
 * Reports › Hierarchy & overrides (round 7, owner pick 6 · B and C, 2026-11-11): the page's pure helpers, shared by
 * the server page, the store and the client board. No React, no Next, no "use client": a server page imports from
 * here freely.
 *
 * Address: `?month=2026-11` (the month; this month when absent), `?tab=missing|negative` (All when absent),
 * `?show=table|chart` (lib/reports/show.ts), and the filters a chart's links set: `?producer=<id>`,
 * `?manager=<id|owner>`, `?carrier=<id>`, `?q=`.
 */

import { csvCellMinimal } from "@/lib/csv/cell";

export const HIERARCHY_PATH = "/app/hierarchy";

export type HierarchyMonth = { key: string; label: string; long: string };
export type HierarchyTab = "all" | "missing" | "negative";
export const HIERARCHY_TABS: ReadonlyArray<{ key: HierarchyTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "missing", label: "Missing levels" },
  { key: "negative", label: "Negative spreads" },
];

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const thisMonth = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

function shift(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthOf(key: string): HierarchyMonth {
  const [y, m] = key.split("-").map(Number);
  return { key, label: SHORT[m - 1], long: `${LONG[m - 1]} ${y}` };
}

/** The month in the address, when it is a real month no later than this one; else this month. */
export function monthParam(raw: unknown, now = new Date()): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const current = thisMonth(now);
  return typeof value === "string" && MONTH_RE.test(value) && value <= current && value >= shift(current, -23) ? value : current;
}

export function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

/** `count` months, oldest first, ending with `key`. */
export function monthsEnding(key: string, count: number): HierarchyMonth[] {
  return Array.from({ length: count }, (_, i) => monthOf(shift(key, i - count + 1)));
}

/** The months the title line offers: this one and the eleven before it, newest first. */
export function monthOptions(now = new Date()): HierarchyMonth[] {
  return monthsEnding(thisMonth(now), 12).reverse();
}

export function tabParam(raw: unknown): HierarchyTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "missing" || value === "negative" ? value : "all";
}

/** The fields of an override row the view reads (OverrideRow, lib/agency/overrideStore.ts). */
export type HierarchyRow = {
  producerId: string; producerUserId: string; producerName: string; managerProducerId: string | null; managerName: string;
  carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null; spreadBps: number | null; overrideCents: number | null;
};

export const isMissing = (r: HierarchyRow) => r.producerLevelBps === null;
export const isNegative = (r: HierarchyRow) => r.spreadBps !== null && r.spreadBps < 0;
export const inTab = (r: HierarchyRow, tab: HierarchyTab) => tab === "all" || (tab === "missing" ? isMissing(r) : isNegative(r));

export type HierarchyFilters = { producer?: string; manager?: string; carrier?: string; q?: string };

/** The rows the filters keep (the tab is applied apart, so the tabs can count). `manager=owner`: reports to the owner. */
export function filterRows<R extends HierarchyRow>(rows: readonly R[], f: HierarchyFilters): R[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) =>
    (!f.producer || r.producerId === f.producer) &&
    (!f.manager || (f.manager === "owner" ? r.managerProducerId === null : r.managerProducerId === f.manager)) &&
    (!f.carrier || r.carrierId === f.carrier) &&
    (!needle || `${r.producerName} ${r.carrierName}`.toLowerCase().includes(needle)));
}

/** A row's one chip and its next step. */
export function rowState(r: HierarchyRow): { text: string; tone: "danger" | "warning" | "neutral"; next: string | null } {
  if (isNegative(r)) return { text: "Negative spread", tone: "danger", next: "Fix level" };
  if (isMissing(r)) return { text: "No level", tone: "warning", next: "Set level" };
  return { text: "Set", tone: "neutral", next: null };
}

/** A producer in the tree: his override this month and how many of his contract levels are set. */
export type TreeNode = {
  id: string; name: string; overrideCents: number; set: number; levels: number; missing: number; negative: number; children: TreeNode[];
};

/**
 * Who reports to whom (6·3 B): the owner at the root; a producer whose manager is not among the rows (out of a
 * manager's scope, or offboarded) hangs from the root. A loop in the data is broken at the producer seen twice.
 */
export function buildTree(rows: readonly HierarchyRow[]): { roots: TreeNode[]; overrideCents: number } {
  const nodes = new Map<string, TreeNode & { parent: string | null }>();
  for (const r of rows) {
    let node = nodes.get(r.producerId);
    if (!node) {
      node = { id: r.producerId, name: r.producerName, parent: r.managerProducerId, overrideCents: 0, set: 0, levels: 0, missing: 0, negative: 0, children: [] };
      nodes.set(r.producerId, node);
    }
    node.levels += 1;
    node.overrideCents += r.overrideCents ?? 0;
    if (isMissing(r)) node.missing += 1; else node.set += 1;
    if (isNegative(r)) node.negative += 1;
  }
  const roots: TreeNode[] = [];
  const placed = new Set<string>();
  const attach = (node: TreeNode & { parent: string | null }, chain: Set<string>) => {
    if (placed.has(node.id)) return;
    const parent = node.parent ? nodes.get(node.parent) : undefined;
    if (!parent || chain.has(parent.id)) { roots.push(node); placed.add(node.id); return; }
    chain.add(node.id);
    attach(parent, chain);
    parent.children.push(node);
    placed.add(node.id);
  };
  for (const node of nodes.values()) attach(node, new Set([node.id]));
  const byName = (list: TreeNode[]) => { list.sort((a, b) => a.name.localeCompare(b.name)); for (const n of list) byName(n.children); };
  byName(roots);
  return { roots, overrideCents: rows.reduce((sum, r) => sum + (r.overrideCents ?? 0), 0) };
}

/** The table's rows as a CSV (Download CSV on the title line's More). */
export function hierarchyCsv(rows: readonly HierarchyRow[], pct: (bps: number | null) => string, money: (cents: number) => string): string {
  const cell = (v: string) => csvCellMinimal(v);
  const head = ["Producer", "Reports to", "Carrier", "Agency level", "Producer level", "Spread", "Override (reported)", "Level"];
  const body = rows.map((r) => [r.producerName, r.managerName, r.carrierName, pct(r.agencyLevelBps), pct(r.producerLevelBps), pct(r.spreadBps), r.overrideCents === null ? "" : money(r.overrideCents), rowState(r).text]);
  return [head, ...body].map((line) => line.map(cell).join(",")).join("\n");
}
