/**
 * Settings › Sales process (round 8, owner pick A on the sales-process board, 2026-11-12): the six
 * pages that shape an agent's call, as header tabs of one section, opening on a step map.
 *
 * Client-safe and pure: the tab list, which tab an old link or a search anchor lands on, and the
 * "Needs you" list the Overview adds up from what each tab already loads. Nothing here fetches.
 */

import type { TemplateRowView } from "./views";

export type SalesProcessTab = "overview" | "health-questions" | "quote-inputs" | "carrier-application" | "checks" | "disclosures" | "stage-moves";

/** The header tabs, in the order the agent meets them on a call (the board's names). */
export const SALES_PROCESS_TABS: ReadonlyArray<{ key: SalesProcessTab; label: string; was: string | null }> = [
  { key: "overview", label: "Overview", was: null },
  { key: "health-questions", label: "Health questions", was: "Underwriting templates" },
  { key: "quote-inputs", label: "Quote inputs", was: "Quotation templates" },
  { key: "carrier-application", label: "Carrier application", was: "Application field sets" },
  { key: "checks", label: "Quote & case checks", was: "Quote & QA rules" },
  { key: "disclosures", label: "Disclosures", was: null },
  { key: "stage-moves", label: "Stage moves", was: "Application stages" },
];

/** The tabs a producer opens: what they will ask on a call, read-only (owner 2026-10-30, step S13). */
export const PRODUCER_TABS: readonly SalesProcessTab[] = ["health-questions"];

/**
 * The six menu items this section replaced, and the tab each lands on now. registry.ts redirects the
 * old "#sales-…" links here, so bookmarks, emails, the setup checklist and other pages' links still work.
 */
export const OLD_SALES_SECTIONS: Readonly<Record<string, SalesProcessTab>> = {
  "sales-underwriting": "health-questions",
  "sales-quotation": "quote-inputs",
  "sales-field-sets": "carrier-application",
  "sales-preferences": "checks",
  "sales-disclosures": "disclosures",
  "sales-pipeline-sync": "stage-moves",
};

const TAB_KEYS = new Set<string>(SALES_PROCESS_TABS.map((tab) => tab.key));

/**
 * The tab an anchor after "#sales-process/" opens: a tab's own key, a quote pair's link
 * ("pair.<carrier>.<product>"), a Quote & case checks control ("qa-…"), else null (stay put).
 */
export function tabForAnchor(anchor: string | null | undefined): SalesProcessTab | null {
  if (!anchor) return null;
  const head = anchor.split("/")[0];
  if (TAB_KEYS.has(head)) return head as SalesProcessTab;
  if (OLD_SALES_SECTIONS[head]) return OLD_SALES_SECTIONS[head];
  if (head.startsWith("pair.")) return "quote-inputs";
  if (head.startsWith("qa-")) return "checks";
  if (head.startsWith("doc.")) return "disclosures";
  return null;
}

/* ── Needs you ─────────────────────────────────────────────────────────── */

export type NeedsItem = {
  /** Stable key for the list. */
  key: string;
  /** "Aetna/CVS · Medicare Supplement" or a document's title. */
  title: string;
  /** "Health questions draft · 2 days old". */
  detail: string;
  /** Where the row opens. */
  tab: SalesProcessTab;
  /** An anchor inside that tab, when the row opens one record. */
  anchor?: string;
};

const DAY = 24 * 60 * 60 * 1000;

/** "today", "1 day old", "9 days old". */
export function ageText(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (!Number.isFinite(days) || days <= 0) return "today";
  return `${days} ${days === 1 ? "day" : "days"} old`;
}

/** "Mutual of Omaha · Final Expense", or "Every carrier · Final Expense" for a product's own set. */
export function pairName(t: Pick<TemplateRowView, "carrierName" | "carrierId" | "productName">): string {
  return `${t.carrierId ? t.carrierName ?? "Carrier" : "Every carrier"} · ${t.productName}`;
}

/** Health question sets the agency has drafted and not published. */
export function healthDrafts(templates: readonly TemplateRowView[], now?: number): NeedsItem[] {
  return templates
    .filter((t) => t.tenantOwned && t.status === "draft")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((t) => ({ key: `uw-${t.id}`, title: pairName(t), detail: `Health questions draft · ${ageText(t.updatedAt, now)}`, tab: "health-questions" as const, anchor: `set.${t.id}` }));
}

type PairFacts = {
  templates: readonly TemplateRowView[];
  carriers: readonly { id: string; name: string }[];
  carrierProducts: readonly { carrierId: string; productCode: string }[];
  productLines: readonly { code: string; name: string; sold?: boolean }[];
};

/**
 * Carrier × product pairs the agency sells whose quotes still run on the Insurvas default: no
 * template of the pair's own and no agency default for the product line.
 */
export function pairsOnInsurvasDefault(facts: PairFacts): NeedsItem[] {
  const live = (t: TemplateRowView) => t.tenantOwned && t.status !== "retired";
  const out: NeedsItem[] = [];
  const sold = facts.productLines.filter((line) => line.sold !== false);
  for (const line of sold) {
    if (facts.templates.some((t) => live(t) && !t.carrierId && t.productCode === line.code)) continue;
    for (const carrier of facts.carriers) {
      if (!facts.carrierProducts.some((p) => p.carrierId === carrier.id && p.productCode === line.code)) continue;
      if (facts.templates.some((t) => live(t) && t.carrierId === carrier.id && t.productCode === line.code)) continue;
      out.push({ key: `qt-${carrier.id}-${line.code}`, title: `${carrier.name} · ${line.name}`, detail: "Quote inputs on the Insurvas default", tab: "quote-inputs", anchor: `pair.${carrier.id}.${line.code}` });
    }
  }
  return out;
}

/** The figures a step tile shows: sets and questions, pairs set, forms and fields. */
export function countPairs(facts: PairFacts): { sold: number; own: number } {
  const live = (t: TemplateRowView) => t.tenantOwned && t.status !== "retired";
  let soldPairs = 0;
  let own = 0;
  for (const line of facts.productLines.filter((l) => l.sold !== false)) {
    for (const carrier of facts.carriers) {
      if (!facts.carrierProducts.some((p) => p.carrierId === carrier.id && p.productCode === line.code)) continue;
      soldPairs += 1;
      if (facts.templates.some((t) => live(t) && (t.carrierId === carrier.id || !t.carrierId) && t.productCode === line.code)) own += 1;
    }
  }
  return { sold: soldPairs, own };
}

/** "2 days ago" / "today" for the status line's last change. */
export function agoText(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / DAY);
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The newest of several "changed by … at …" facts; null when none has a date. */
export function lastChange(changes: ReadonlyArray<{ at: string | null | undefined; by: string | null | undefined; what: string }>): { at: string; by: string | null; what: string } | null {
  let best: { at: string; by: string | null; what: string } | null = null;
  for (const c of changes) {
    if (!c.at || Number.isNaN(new Date(c.at).getTime())) continue;
    if (!best || c.at > best.at) best = { at: c.at, by: c.by ?? null, what: c.what };
  }
  return best;
}
