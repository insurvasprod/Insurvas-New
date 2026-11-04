import { ViewTabs } from "@/components/ui/view-tabs";

export type ItemTab = "decide" | "row";

/** The tab ?tab= asks for; "The row as sent" only when the item came from a row. */
export function itemTab(asked: string | undefined, hasRow: boolean): ItemTab {
  return asked === "row" && hasRow ? "row" : "decide";
}

/**
 * A Needs you item's parts (owner 2026-11-02, round 2): Decide, then the carrier's row as sent when the item
 * came from one. On the title line (`lead`, UI-CONSISTENCY §8a) as link tabs: each part is its own address
 * (?tab=row), so the page renders only the panel asked for. There is no Notes tab: none of the sources keeps
 * notes on an item yet.
 */
export function ItemTabs({ current, hasRow, href }: { current: ItemTab; hasRow: boolean; href: (tab: ItemTab) => string }) {
  const tabs = [{ key: "decide" as const, label: "Decide", href: href("decide") }, ...(hasRow ? [{ key: "row" as const, label: "The row as sent", href: href("row") }] : [])];
  return <ViewTabs<ItemTab> label="This item" tabs={tabs} value={current} controls="needs-you-item-panel" />;
}
