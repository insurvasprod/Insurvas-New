"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
import { fileDay } from "@/lib/ingestion/constants";
import { ageShort, GROUP_LABELS, groupCounts, KIND_META, NEEDS_YOU_GROUPS, type NeedsYouGroup, type NeedsYouItem, type NeedsYouView } from "@/lib/needsYou/kinds";

const EMPTY: Record<NeedsYouView, { title: string; hint: string }> = {
  mine: { title: "Nothing waits for you", hint: "When a carrier file leaves a decision that is yours — a client to pick, a sale no carrier has, money that doesn't match — it appears here." },
  agency: { title: "Nothing waits for anyone", hint: "Every decision the carrier files leave for a person appears here, oldest first, until someone makes it." },
  insurvas: { title: "Nothing waits on Insurvas", hint: "A status word no carrier has used before holds its rows until Insurvas maps it. Those words appear here." },
  closed: { title: "Nothing closed in the last 30 days", hint: "Decisions made here, on Exceptions or on Policy matching appear here for 30 days." },
};

/**
 * Needs you, the list (owner 2026-11-02, round 2): one row per decision — kind, what it is about, why it waits,
 * who owns it, how long — each opening its own item page. The chips cut it by group; the view (Mine, Agency,
 * Waiting on Insurvas, Closed) is the page's tabs.
 */
export function NeedsYouList({ items, view, fromFile = null }: { items: NeedsYouItem[]; view: NeedsYouView; fromFile?: { name: string; clearHref: string } | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [group, setGroup] = useState<"all" | NeedsYouGroup>("all");
  const [page, setPage] = useState(1);
  const counts = useMemo(() => groupCounts(items), [items]);
  const shown = useMemo(() => (group === "all" ? items : items.filter((item) => KIND_META[item.kind].group === group)), [items, group]);
  const pageSize = useFittingPageSize(360, 44);
  const rows = paginate(shown, page, pageSize);
  const closed = view === "closed";
  const open = (item: NeedsYouItem) => (closed ? item.href : `${item.href}?from=${view}`);
  const pick = (next: "all" | NeedsYouGroup) => { setGroup(next); setPage(1); };

  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
      {/* Files › "Open all in Needs you": only what that file left; removing the chip shows everything. */}
      {fromFile && <ToggleChip selected onRemove={() => router.push(fromFile.clearHref)}>{`From ${fromFile.name}`}</ToggleChip>}
      {items.length > 0 && (
        <Segmented
          label="Kinds of decision"
          value={group}
          onChange={pick}
          options={[{ key: "all" as const, label: "All", count: items.length }, ...NEEDS_YOU_GROUPS.filter((g) => counts[g] > 0).map((g) => ({ key: g, label: GROUP_LABELS[g], count: counts[g] }))]}
        />
      )}
    </DataToolbar>
  );

  return (
    <TableCard toolbar={toolbar} footer={shown.length ? <Pager page={rows.current} pageSize={pageSize} total={shown.length} noun={closed ? "closed items" : "items"} onPage={setPage} /> : undefined}>
      {items.length === 0 ? <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
        : shown.length === 0 ? <NoMatches noun="items" onClear={() => pick("all")} />
        : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[200px]">Kind</th>
                <th>About</th>
                <th>{closed ? "How it ended" : "Why"}</th>
                <th className="w-[160px]">Who</th>
                <th className="w-[90px]">{closed ? "Closed" : "Age"}</th>
                <th className="w-[90px] text-right"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((item) => (
                <tr key={`${item.kind}:${item.id}`} className="cursor-pointer" onClick={() => router.push(open(item))}>
                  <td><StatusChip tone={item.tone}>{KIND_META[item.kind].label}</StatusChip></td>
                  <td className="font-semibold text-foreground">{item.about}</td>
                  <td className="text-foreground">{closed ? item.closedAs ?? "Closed" : item.why}</td>
                  <td className="text-foreground">{item.who}</td>
                  <td className="tabular-nums text-foreground">{closed ? fileDay(item.closedAt ?? null) : ageShort(item.ageDays)}</td>
                  <td className="text-right" onClick={(event) => event.stopPropagation()}>
                    <Button asChild variant="outline" size="sm"><Link href={open(item)}>Open</Link></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}
