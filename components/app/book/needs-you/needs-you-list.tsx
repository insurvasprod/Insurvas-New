"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BulkResolve } from "@/components/app/book/needs-you/bulk-resolve";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { ageShort, GROUP_LABELS, groupCounts, KIND_META, NEEDS_YOU_GROUPS, searchItems, searchParam, type NeedsYouGroup, type NeedsYouItem, type NeedsYouKind, type NeedsYouView } from "@/lib/needsYou/kinds";

const EMPTY: Record<NeedsYouView, { title: string; hint: string }> = {
  mine: { title: "Nothing waits for you", hint: "When a carrier file leaves a decision that is yours — a client to pick, a sale no carrier has, money that doesn't match — it appears here." },
  agency: { title: "Nothing waits for anyone", hint: "Every decision the carrier files leave for a person appears here, oldest first, until someone makes it." },
  insurvas: { title: "Nothing waits on Insurvas", hint: "A status word no carrier has used before holds its rows until Insurvas maps it. Those words appear here." },
  closed: { title: "Nothing closed in the last 30 days", hint: "Decisions made here, on Exceptions or on Policy matching appear here for 30 days." },
};

/** How long an item has waited: a period, so plain and muted (owner 2026-11-11: colour only in a chip). */
function Age({ days }: { days: number }) {
  return <span className="whitespace-nowrap tabular-nums text-muted-foreground">{ageShort(days)}</span>;
}

/**
 * The row's short next step (owner 2026-11-11: a short verb and ›, the same weight on every row); the kind's
 * whole "what to do" sentence is the cell's tooltip.
 */
const NEXT_VERB: Record<NeedsYouKind, string> = {
  "pick-client": "Pick", "no-sale": "Confirm", "no-carrier": "Find", "same-person": "Decide", "existing-book": "Review",
  "commission-no-policy": "Find", "unknown-policy": "Find", money: "Check", credit: "Credit", agent: "Map",
  "status-word": "Open", rules: "Decide", file: "Fix",
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
 * on the Review page (round 5: a line opens it narrowed to its group, an item at that item); items alike fold into one line (Group alike, on
 * by default) that opens its items in the list and, for "Policy with no sale", confirms them all at once. The
 * item page stays the address an item is shared and linked by.
 */
/** `initialGroup`: the chip to open on (?group=, e.g. the Attribution queue's old address opens on Credit). */
/** `initialQuery`: the search to open on (?q=), so a reload or a link back keeps it. */
export function NeedsYouList({ items: every, view, fromFile = null, readOnly = false, initialGroup = "all", initialQuery = "" }: { items: NeedsYouItem[]; view: NeedsYouView; fromFile?: { name: string; clearHref: string } | null; readOnly?: boolean; initialGroup?: "all" | NeedsYouGroup; initialQuery?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [group, setGroup] = useState<"all" | NeedsYouGroup>(initialGroup);
  const [page, setPage] = useState(1);
  const [alike, setAlike] = useState(true);
  const [folded, setFolded] = useState<string | null>(null);
  // QA 2026-11-03: ~3,800 items over 142 pages had no search. Policy number, client, agent code or file name;
  // kept in ?q= (replaceState: no server round trip per key) so a reload, the Review links and "back" keep it.
  const [query, setQuery] = useState(initialQuery);
  const items = useMemo(() => searchItems(every, query), [every, query]);
  const search = (next: string) => {
    setQuery(next);
    setPage(1);
    setFolded(null);
    try {
      const url = new URL(window.location.href);
      const q = searchParam(next);
      if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    } catch { /* the list still filters */ }
  };
  const counts = useMemo(() => groupCounts(items), [items]);
  const closed = view === "closed";
  const inGroup = useMemo(() => (group === "all" ? items : items.filter((item) => KIND_META[item.kind].group === group)), [items, group]);
  const fold = useMemo(() => (folded ? linesOf(inGroup, true).find((line) => line.fold?.key === folded)?.fold ?? null : null), [inGroup, folded]);
  const shown = useMemo<Line[]>(() => (fold ? fold.items.map((item) => ({ item })) : linesOf(inGroup, alike && !closed)), [fold, inGroup, alike, closed]);
  const pageSize = useFittingPageSize(360, 44);
  const rows = paginate(shown, page, pageSize);
  const href = (item: NeedsYouItem) => (closed ? item.href : `${item.href}?from=${view}`);
  const pick = (next: "all" | NeedsYouGroup) => { setGroup(next); setPage(1); setFolded(null); };
  // Round 5 (owner 2026-11-03): decisions are made on the Review page, never under a row. A line opens it narrowed
  // to its group; an item opens it at that item (a status word, which waits on Insurvas, opens its own page).
  const pathname = usePathname();
  const params = useSearchParams();
  const here = `${pathname}${params.size ? `?${params.toString()}` : ""}`;
  // The search goes with them: the Review queue opens narrowed the same way (?q=).
  const q = searchParam(query);
  const reviewItem = (item: NeedsYouItem) => (item.kind === "status-word" ? href(item) : `/app/needs-you/review?kind=${item.kind}&id=${encodeURIComponent(item.id)}${q ? `&q=${encodeURIComponent(q)}` : ""}&from=${encodeURIComponent(here)}`);
  const reviewOf = (f: Fold) => {
    const first = f.items[0];
    const query = new URLSearchParams({ kind: first.kind, from: here });
    if (q) query.set("q", q);
    if (first.ref?.carrierId) query.set("carrier", first.ref.carrierId);
    if (first.kind === "no-sale" && first.ref?.fileDate) query.set("date", first.ref.fileDate);
    if (first.kind === "pick-client" && first.ref?.fileId) query.set("file", first.ref.fileId);
    return `/app/needs-you/review?${query.toString()}`;
  };
  const noSaleIds = (list: NeedsYouItem[]) => list.filter((item) => item.kind === "no-sale").map((item) => item.id);

  const toolbar = (
    <DataToolbar actions={<>
      {fold && !readOnly && noSaleIds(fold.items).length > 0 && <BulkResolve ids={noSaleIds(fold.items)} resolution="confirm_client" noun="clients" size="default" />}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      {every.length > 0 && <ToolbarSearch value={query} onChange={search} placeholder="Policy, client, agent code or file" label="Search Needs you" />}
      {/* Files › "Open all in Needs you": only what that file left; removing the chip shows everything. */}
      {fromFile && <ToggleChip selected onRemove={() => router.push(fromFile.clearHref)}>{`From ${fromFile.name}`}</ToggleChip>}
      {every.length > 0 && (
        // Up to seven groups: a pick-one filter row is ToggleChips (UI-CONSISTENCY §5b, §16), not a Segmented.
        <span role="radiogroup" aria-label="Kinds of decision" className="flex flex-wrap items-center gap-2">
          {[{ key: "all" as const, label: "All", count: items.length }, ...NEEDS_YOU_GROUPS.filter((g) => counts[g] > 0).map((g) => ({ key: g, label: GROUP_LABELS[g], count: counts[g] }))].map((option) => (
            <ToggleChip key={option.key} role="radio" selected={group === option.key} count={option.count} onClick={() => pick(option.key)}>{option.label}</ToggleChip>
          ))}
        </span>
      )}
      {fold ? <ToggleChip selected onRemove={() => { setFolded(null); setPage(1); }}>{`${fold.label} · ${fold.where}`}</ToggleChip>
        : !closed && every.length > 0 && <span title="Items of one kind from one file as one line"><ToggleChip selected={alike} onClick={() => { setAlike(!alike); setPage(1); }}>Group alike</ToggleChip></span>}
    </DataToolbar>
  );

  return (
    <TableCard toolbar={toolbar} footer={shown.length ? <Pager page={rows.current} pageSize={pageSize} total={shown.length} noun={closed ? "closed items" : fold ? "items" : "lines"} onPage={setPage} /> : undefined}>
      {every.length === 0 ? <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
        : shown.length === 0 ? <NoMatches noun="items" onClear={() => { pick("all"); search(""); }} />
        : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                {/* Owner 2026-11-10: the subject first (what the row is about), then what kind of decision, why, who, how long. */}
                {/* Owner 2026-11-11: one line per row, one chip (the kind; danger when escalated), a short next step. A closed row opens on a click, so it has no chevron column. */}
                <th>About</th>
                <th>Kind</th>
                <th>{closed ? "How it ended" : "Why"}</th>
                <th>Owner</th>
                <th title={closed ? undefined : "How long it has waited"}>{closed ? "Closed" : "Waiting"}</th>
                {!closed && <th>What to do</th>}
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((line) => {
                if (line.fold) {
                  const f = line.fold;
                  const first = f.items[0];
                  return (
                    <tr key={f.key} className="cursor-pointer" onClick={() => router.push(reviewOf(f))}>
                      {/* The count opens the line's items in this list (it was "See all"); the row opens them on Review. */}
                      <td className="whitespace-nowrap font-medium text-foreground"><button type="button" className="hover:underline" title={`See the ${f.label} one by one`} onClick={(event) => { event.stopPropagation(); setFolded(f.key); setPage(1); }}>{f.label}</button> · {f.where}</td>
                      <td><StatusChip tone={first.tone}>{KIND_META[first.kind].label}</StatusChip></td>
                      <td className="whitespace-nowrap" title={first.kind === "no-sale" ? "No sale or application on record: a new client was made from each row" : first.why}>{first.kind === "no-sale" ? "No sale on record" : "A person picks the client"}</td>
                      <td className="whitespace-nowrap">{f.items.every((i) => i.who === first.who) ? first.who : "Several people"}</td>
                      <td><Age days={Math.max(...f.items.map((i) => i.ageDays))} /></td>
                      {/* A line of many: the verb on all of them ("Confirm all ›"). */}
                      <td className="whitespace-nowrap" title={`${KIND_META[first.kind].todo}, all of them`}><Link href={reviewOf(f)} onClick={(event) => event.stopPropagation()} className="hover:underline">{`${NEXT_VERB[first.kind]} all`} ›</Link></td>
                    </tr>
                  );
                }
                const item = line.item;
                const key = keyOf(item);
                const go = closed ? href(item) : reviewItem(item);
                return (
                  <tr key={key} className="cursor-pointer" onClick={() => router.push(go)}>
                    <td className="whitespace-nowrap font-medium text-foreground">{item.about}</td>
                    {/* One chip: the kind, turned danger and saying so when the item is escalated. */}
                    <td><StatusChip tone={item.escalated && !closed ? "danger" : item.tone}>{item.escalated && !closed ? `${KIND_META[item.kind].label} · escalated` : KIND_META[item.kind].label}</StatusChip></td>
                    <td className="whitespace-nowrap">{closed ? item.closedAs ?? "Closed" : item.why}</td>
                    <td className="whitespace-nowrap">{item.who}</td>
                    <td>{closed ? <span className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(item.closedAt ?? null)}</span> : <Age days={item.ageDays} />}</td>
                    {/* Round 6 (owner 2026-11-06: "know exactly what to do"): every open row's next step — a short verb, the whole sentence its tooltip. */}
                    {!closed && <td className="whitespace-nowrap" title={KIND_META[item.kind].todo}><Link href={go} onClick={(event) => event.stopPropagation()} className="hover:underline">{NEXT_VERB[item.kind]} ›</Link></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}
