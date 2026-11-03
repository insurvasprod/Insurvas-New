"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BulkResolve } from "@/components/app/book/needs-you/bulk-resolve";
import { DecideInPlace } from "@/components/app/book/needs-you/decide-in-place";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";
import { fileDay } from "@/lib/ingestion/constants";
import { ageShort, GROUP_LABELS, groupCounts, KIND_META, NEEDS_YOU_GROUPS, type NeedsYouGroup, type NeedsYouItem, type NeedsYouView } from "@/lib/needsYou/kinds";

const EMPTY: Record<NeedsYouView, { title: string; hint: string }> = {
  mine: { title: "Nothing waits for you", hint: "When a carrier file leaves a decision that is yours — a client to pick, a sale no carrier has, money that doesn't match — it appears here." },
  agency: { title: "Nothing waits for anyone", hint: "Every decision the carrier files leave for a person appears here, oldest first, until someone makes it." },
  insurvas: { title: "Nothing waits on Insurvas", hint: "A status word no carrier has used before holds its rows until Insurvas maps it. Those words appear here." },
  closed: { title: "Nothing closed in the last 30 days", hint: "Decisions made here, on Exceptions or on Policy matching appear here for 30 days." },
};

/** Items of one kind from one file fold into one line once there are this many. */
const FOLD_AT = 3;

type Fold = { key: string; items: NeedsYouItem[]; label: string; where: string };
type Line = { item: NeedsYouItem; fold?: undefined } | { item?: undefined; fold: Fold };

const keyOf = (item: NeedsYouItem) => `${item.kind}:${item.id}`;

/**
 * Round 4 (owner 2026-11-02): items alike — one kind from one file — are one line. "Policy with no sale" items
 * of one carrier file (carrier and file date), and the clients to pick of one file.
 */
function foldKey(item: NeedsYouItem): string | null {
  const ref = item.ref;
  if (item.kind === "no-sale" && ref?.carrierId && ref.fileDate) return `no-sale|${ref.carrierId}|${ref.fileDate}`;
  if (item.kind === "pick-client" && ref?.fileId) return `pick-client|${ref.fileId}`;
  return null;
}

function linesOf(items: NeedsYouItem[], fold: boolean): Line[] {
  if (!fold) return items.map((item) => ({ item }));
  const groups = new Map<string, NeedsYouItem[]>();
  for (const item of items) {
    const key = foldKey(item);
    if (key) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: Line[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = foldKey(item);
    const group = key ? groups.get(key)! : null;
    if (!key || !group || group.length < FOLD_AT) { out.push({ item }); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    // "ACC9896101 · Aetna / CVS" → the carrier; the file is the day its items carry.
    const carrier = group[0].about.split(" · ").slice(1).join(" · ");
    const when = group[0].ref?.fileDate ? `file of ${fileDay(group[0].ref.fileDate)}` : "one file";
    out.push({ fold: { key, items: group, label: `${group.length.toLocaleString("en-US")} policies`, where: [carrier, when].filter(Boolean).join(" · ") } });
  }
  return out;
}

/**
 * Needs you, the list (owner 2026-11-02, round 2): one row per decision — kind, what it is about, why it waits,
 * who owns it, how long. The chips cut it by group; the view (Mine, Agency, Waiting on Insurvas, Closed) is the
 * page's tabs.
 *
 * Round 4 (owner 2026-11-02: "simplify … getting things done inside the other page"): an open item is decided
 * under its row (DecideInPlace), and saving opens the next one; items alike fold into one line (Group alike, on
 * by default) that opens its items in the list and, for "Policy with no sale", confirms them all at once. The
 * item page stays the address an item is shared and linked by.
 */
/** `initialGroup`: the chip to open on (?group=, e.g. the Attribution queue's old address opens on Credit). */
export function NeedsYouList({ items, view, fromFile = null, readOnly = false, initialGroup = "all" }: { items: NeedsYouItem[]; view: NeedsYouView; fromFile?: { name: string; clearHref: string } | null; readOnly?: boolean; initialGroup?: "all" | NeedsYouGroup }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [group, setGroup] = useState<"all" | NeedsYouGroup>(initialGroup);
  const [page, setPage] = useState(1);
  const [alike, setAlike] = useState(true);
  const [folded, setFolded] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const counts = useMemo(() => groupCounts(items), [items]);
  const closed = view === "closed";
  const inGroup = useMemo(() => (group === "all" ? items : items.filter((item) => KIND_META[item.kind].group === group)), [items, group]);
  const fold = useMemo(() => (folded ? linesOf(inGroup, true).find((line) => line.fold?.key === folded)?.fold ?? null : null), [inGroup, folded]);
  const shown = useMemo<Line[]>(() => (fold ? fold.items.map((item) => ({ item })) : linesOf(inGroup, alike && !closed)), [fold, inGroup, alike, closed]);
  const pageSize = useFittingPageSize(360, 44);
  const rows = paginate(shown, page, pageSize);
  const href = (item: NeedsYouItem) => (closed ? item.href : `${item.href}?from=${view}`);
  const pick = (next: "all" | NeedsYouGroup) => { setGroup(next); setPage(1); setFolded(null); };
  const waiting = rows.rows.flatMap((line) => (line.item && !saved.has(keyOf(line.item)) ? [keyOf(line.item)] : []));
  const nextAfter = (key: string, skip: ReadonlySet<string>) => waiting.slice(waiting.indexOf(key) + 1).find((k) => !skip.has(k)) ?? null;
  const noSaleIds = (list: NeedsYouItem[]) => list.filter((item) => item.kind === "no-sale").map((item) => item.id);

  const toolbar = (
    <DataToolbar actions={<>
      {fold && !readOnly && noSaleIds(fold.items).length > 0 && <BulkResolve ids={noSaleIds(fold.items)} resolution="confirm_client" noun="clients" size="default" />}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
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
      {fold ? <ToggleChip selected onRemove={() => { setFolded(null); setPage(1); }}>{`${fold.label} · ${fold.where}`}</ToggleChip>
        : !closed && items.length > 0 && <span title="Items of one kind from one file as one line"><ToggleChip selected={alike} onClick={() => { setAlike(!alike); setPage(1); }}>Group alike</ToggleChip></span>}
    </DataToolbar>
  );

  return (
    <TableCard toolbar={toolbar} footer={shown.length ? <Pager page={rows.current} pageSize={pageSize} total={shown.length} noun={closed ? "closed items" : fold ? "items" : "lines"} onPage={setPage} /> : undefined}>
      {items.length === 0 ? <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
        : shown.length === 0 ? <NoMatches noun="items" onClear={() => pick("all")} />
        : (
          <table className="portal-lead-table w-full min-w-[860px] table-fixed text-left text-sm">
            <thead>
              <tr>
                <th className="w-[170px]">Kind</th>
                <th className="w-[28%]">About</th>
                <th>{closed ? "How it ended" : "Why"}</th>
                <th className="w-[160px]">Owner</th>
                <th className="w-[72px]">{closed ? "Closed" : "Age"}</th>
                <th className="w-[200px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((line) => {
                if (line.fold) {
                  const f = line.fold;
                  const first = f.items[0];
                  const ids = noSaleIds(f.items);
                  return (
                    <tr key={f.key}>
                      <td><StatusChip tone={first.tone}>{KIND_META[first.kind].label}</StatusChip></td>
                      <td className="truncate font-semibold text-foreground" title={f.where}>{f.label} <span className="font-normal text-muted-foreground">· {f.where}</span></td>
                      <td className="truncate text-foreground" title={first.kind === "no-sale" ? "No sale or application on record: a new client was made from each row" : first.why}>{first.kind === "no-sale" ? "No sale on record" : "A person picks the client"}</td>
                      <td className="text-foreground">{f.items.every((i) => i.who === first.who) ? first.who : "Several people"}</td>
                      <td className="tabular-nums text-foreground">{ageShort(Math.max(...f.items.map((i) => i.ageDays)))}</td>
                      <td className="text-right">
                        <span className="inline-flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => { setFolded(f.key); setPage(1); }}>Open</Button>
                          {!readOnly && ids.length > 0 && <BulkResolve ids={ids} resolution="confirm_client" noun="clients" label="Confirm all" variant="outline" />}
                        </span>
                      </td>
                    </tr>
                  );
                }
                const item = line.item;
                const key = keyOf(item);
                const isOpen = open === key && !closed;
                const done = saved.has(key);
                return (
                  <Fragment key={key}>
                    <tr className={cn(!closed && !done && "cursor-pointer", done && "opacity-60", isOpen && "bg-[var(--surface-alt)]")} onClick={closed ? () => router.push(href(item)) : done ? undefined : () => setOpen(isOpen ? null : key)}>
                      <td><StatusChip tone={done ? "good" : item.tone}>{done ? "Saved" : KIND_META[item.kind].label}</StatusChip></td>
                      <td className="truncate font-semibold text-foreground" title={item.about}>{item.about}</td>
                      <td className="truncate text-foreground" title={closed ? item.closedAs ?? "Closed" : item.why}>{closed ? item.closedAs ?? "Closed" : item.why}</td>
                      <td className="text-foreground"><span className="inline-flex flex-wrap items-center gap-2">{item.who}{item.escalated && !closed && <StatusChip tone="danger">Escalated</StatusChip>}</span></td>
                      <td className="tabular-nums text-foreground">{closed ? fileDay(item.closedAt ?? null) : ageShort(item.ageDays)}</td>
                      <td className="text-right" onClick={(event) => event.stopPropagation()}>
                        {closed ? <Button asChild variant="outline" size="sm"><Link href={href(item)}>Open</Link></Button>
                          : done ? null
                          : <Button type="button" variant="outline" size="sm" aria-expanded={isOpen} aria-controls={`decide-${item.id}`} onClick={() => setOpen(isOpen ? null : key)}>{isOpen ? "Close" : "Decide"}</Button>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`decide-${item.id}`}>
                        <td colSpan={6} className="!h-auto border-b border-[var(--border)] bg-[var(--surface-alt)] !p-0">
                          {/* The panel takes the row's width and adds none, so the columns above never move. */}
                          <div className="w-0 min-w-full">
                            <DecideInPlace
                              kind={item.kind}
                              id={item.id}
                              onClose={() => setOpen(null)}
                              inline={{
                                hasNext: nextAfter(key, saved) !== null,
                                onSkip: () => setOpen(nextAfter(key, saved)),
                                onDone: (how) => {
                                  const next = new Set(saved).add(key);
                                  setSaved(next);
                                  setOpen(how === "next" ? nextAfter(key, next) : null);
                                },
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}
