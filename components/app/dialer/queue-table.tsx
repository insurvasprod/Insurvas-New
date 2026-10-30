"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FolderOpen, Phone, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { MAX_ROWS } from "@/components/ui/use-fitting-page-size";
import { pillTone } from "@/components/app/settings/primitives";
import { FILTERS, PRIORITY_TONE, leadName, small } from "@/components/app/dialer/model";
import type { useDialer } from "@/components/app/dialer/use-dialer";
import { formatUsPhone, priorityForTier } from "@/lib/dialerScripts/display";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";

const ALL = "all";
const NO_CAMPAIGN = "none";
/** The kit's row (TableCell h-11 and its rule) before the first row has been drawn. */
const ROW_HEIGHT = 45;

/**
 * The Priority queue as a table (owner 2026-10-29): one search box, the campaign and the priority,
 * so an agent working one campaign's list can see every number he calls is from it. The table never
 * makes the page scroll: it shows as many rows as fit under the open lead and pages the rest.
 *
 * The search box filters the loaded queue as you type (name or phone); Enter or Search runs the
 * server's lead search (LA-2.8, read-only) and shows its results in the same table.
 */
export function DialerQueueTable({ d, readOnly }: { d: ReturnType<typeof useDialer>; readOnly: boolean }) {
  const { isSetter, search, setSearch, searchMode, searching, searchLeads, clearLeadSearch, visibleLeads, selectedId, selectLead, queue, queueError, queueFilter, setQueueFilter, attempt, picking, pickRefusals, pickLead, served, panel } = d;
  const [campaign, setCampaign] = useState(ALL);
  const box = useRef<HTMLDivElement>(null);
  const pageSize = useRowsThatFit(box);

  const allRows = useMemo(() => (queue?.available ? queue.rows : []), [queue]);
  const campaigns = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const row of allRows) {
      const key = row.campaignId ?? NO_CAMPAIGN;
      const entry = counts.get(key) ?? { name: row.campaignName ?? (row.campaignId ? "Unnamed campaign" : "No campaign"), count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.entries()].map(([key, entry]) => ({ key, ...entry })).sort((a, b) => (a.key === NO_CAMPAIGN ? 1 : b.key === NO_CAMPAIGN ? -1 : a.name.localeCompare(b.name)));
  }, [allRows]);

  // Typing narrows the loaded queue at once: a name, or three or more digits of the number.
  const needle = search.trim().toLocaleLowerCase();
  const digits = needle.replace(/\D/g, "");
  const rows = useMemo(() => allRows.filter((row) =>
    (campaign === ALL || (row.campaignId ?? NO_CAMPAIGN) === campaign)
    && (searchMode || !needle || (row.name ?? "").toLocaleLowerCase().includes(needle) || (digits.length >= 3 && (row.phone ?? "").replace(/\D/g, "").includes(digits))),
  ), [allRows, campaign, needle, digits, searchMode]);

  // The page goes back to 1 whenever what is listed changes.
  const listKey = `${searchMode}|${needle}|${campaign}|${queueFilter}|${pageSize}`;
  const [paging, setPaging] = useState({ key: listKey, page: 1 });
  const page = paging.key === listKey ? paging.page : 1;
  const setPage = (to: number) => setPaging({ key: listKey, page: to });

  const total = searchMode ? visibleLeads.length : rows.length;
  const clearFilters = () => { setCampaign(ALL); setQueueFilter("all"); setSearch(""); };
  const pickable = !readOnly && !attempt && picking === null;
  // The table lists the next 100 (the preview's ceiling); the count says how many more wait behind them.
  const more = queue?.available && (queue.capped || queue.count > allRows.length)
    ? `${queue.capped ? `${queue.cap.toLocaleString()}+` : queue.count.toLocaleString()} waiting`
    : null;

  const toolbar = (
    <>
      <form onSubmit={(event) => { if (isSetter) event.preventDefault(); else void searchLeads(event); }} className="flex min-w-0 flex-1 items-center gap-2" role="search" aria-label="Find a lead">
        <ToolbarSearch value={search} onChange={setSearch} label={isSetter ? "Filter the queue by name or phone" : "Find a lead by name, phone or email; Enter searches every lead"} placeholder="Name or phone" className="min-w-0 flex-1 sm:w-auto" />
        {/* The search box clears itself; this × leaves the server's results for the queue. */}
        {searchMode && (
          <Button type="button" variant="ghost" size="icon" onClick={clearLeadSearch} aria-label="Back to queue" title="Search results are read-only; opening one does not serve or claim the lead.">
            <X aria-hidden="true" />
          </Button>
        )}
        {!isSetter && <Button type="submit" variant="outline" disabled={searching || search.trim().length < 2}>{searching ? "Searching…" : "Search"}</Button>}
      </form>
      {!searchMode && (
        <>
          <label className="sr-only" htmlFor="dialer-campaign">Campaign</label>
          <select id="dialer-campaign" className={cn(toolbarControl, "max-w-36 @2xl:max-w-56")} value={campaign} onChange={(event) => setCampaign(event.target.value)}>
            <option value={ALL}>All campaigns ({allRows.length.toLocaleString()})</option>
            {campaigns.map((entry) => <option key={entry.key} value={entry.key}>{entry.name} ({entry.count.toLocaleString()})</option>)}
            {campaign !== ALL && !campaigns.some((entry) => entry.key === campaign) && <option value={campaign}>This campaign (0)</option>}
          </select>
        </>
      )}
    </>
  );

  const footer = (
    <Pager page={page} total={total} pageSize={pageSize} noun={searchMode ? "search results" : "leads"} onPage={setPage} compact suffix={searchMode || readOnly ? "read-only" : more} />
  );

  let content;
  if (searchMode) {
    const shown = paginate(visibleLeads, page, pageSize).rows;
    content = visibleLeads.length === 0 ? <NoMatches noun="leads" by="search" onClear={clearLeadSearch} /> : (
      <Table aria-label="Search results" className="table-fixed">
        <QueueHead third="Product" />
        <TableBody>
          {shown.map((lead) => {
            const name = leadName(lead.values);
            const selected = selectedId === lead.id;
            const product = productLineLabel(String(lead.product_line ?? lead.values.product_line ?? lead.values.product ?? ""));
            return (
              <TableRow key={lead.id} data-state={selected ? "selected" : undefined} className="cursor-pointer" onClick={() => selectLead(lead.id)}>
                <TableCell><LeadCell name={name} detail={String(lead.values.state ?? "State missing")} /></TableCell>
                <TableCell className="tabular-nums">{formatUsPhone(String(lead.values.phone ?? lead.values.phone_number ?? "")) || <span className="text-[var(--muted)]">No phone</span>}</TableCell>
                <TableCell className="truncate" title={product}>{product}</TableCell>
                <TableCell className="hidden text-[var(--muted)] @2xl:table-cell">—</TableCell>
                <TableCell className="hidden text-[var(--muted)] @3xl:table-cell">—</TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="icon-sm" aria-pressed={selected} aria-label={`Open ${name}`} onClick={(event) => { event.stopPropagation(); selectLead(lead.id); }}>
                    <FolderOpen aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  } else if (attempt && allRows.length > 0) {
    // A call is open: the rest of the queue folds to one line (owner 2026-10-27).
    content = <p className={cn(small, "m-0 px-4 py-3")}>Finish this call before picking another lead · {allRows.length.toLocaleString()} waiting in the queue.</p>;
  } else if (!queue && !queueError) {
    content = <SectionLoading rows={4} columns={4} label="Loading the queue" />;
  } else if (queueError) {
    content = <p className="m-0 px-4 py-3 text-xs leading-[1.5] text-[var(--error-ink)]" role="alert">{queueError}</p>;
  } else if (queue && !queue.available) {
    content = <p className={cn(small, "m-0 px-4 py-3")} role="status">{queue.message}</p>;
  } else if (allRows.length === 0) {
    content = served && panel ? <p className={cn(small, "m-0 px-4 py-3")} role="status">Nothing else is servable to you right now.</p>
      : queueFilter === "all"
        // No paragraph on why the queue is empty (owner 2026-10-30); the pager's "No leads" says it.
        ? null
        : <EmptyState title="Nothing in this priority is servable to you right now" hint="Other priorities may still have leads." action={<Button type="button" variant="outline" onClick={() => setQueueFilter("all")}>Show every priority</Button>} />;
  } else if (rows.length === 0) {
    content = campaign !== ALL
      ? <EmptyState title="No lead in this campaign is ready now" hint="Try another campaign or priority." action={<Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button>} />
      : <NoMatches noun="leads" by={queueFilter === "all" ? "search" : "filters"} onClear={clearFilters} />;
  } else {
    const shown = paginate(rows, page, pageSize).rows;
    content = (
      <Table aria-label="Priority queue" className="table-fixed">
        <QueueHead third="Campaign" />
        <TableBody>
          {shown.map((row) => {
            const priority = priorityForTier(row.tierName);
            const refusal = pickRefusals[row.workItemId];
            const name = row.name ?? "Unnamed lead";
            const attemptLine = picking === row.workItemId ? "Serving…" : `Attempt ${row.attemptsMade + 1}`;
            return (
              <TableRow key={row.workItemId} className={pickable ? "cursor-pointer" : undefined} aria-busy={picking === row.workItemId || undefined} title={`${priority} priority · ${attemptLine}${row.state ? ` · ${row.state}` : ""}${row.localTime ? ` ${row.localTime} local` : ""}${row.assignedToYou ? " · assigned to you" : ""}`} onClick={() => void pickLead(row)}>
                <TableCell>
                  {/* In a narrow card the priority rides beside the name; its own column opens when there is room. */}
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusChip tone={pillTone(PRIORITY_TONE[priority])} dot className="shrink-0 px-1.5 @2xl:hidden"><span className="sr-only">{priority}</span></StatusChip>
                    <LeadCell name={name} detail={[row.state, row.localTime].filter(Boolean).join(" · ")} />
                  </span>
                  {refusal && <span id={`pick-${row.workItemId}`} role="alert" className="block whitespace-normal text-xs leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{refusal}</span>}
                </TableCell>
                <TableCell className="tabular-nums">{row.phone ?? <span className="text-[var(--muted)]">No phone</span>}</TableCell>
                <TableCell className="truncate" title={row.campaignName ?? undefined}>{row.campaignName ?? <span className="text-[var(--muted)]">{row.campaignId ? "Unnamed campaign" : "No campaign"}</span>}</TableCell>
                <TableCell className="hidden @2xl:table-cell"><StatusChip tone={pillTone(PRIORITY_TONE[priority])} dot>{priority}</StatusChip></TableCell>
                <TableCell className="hidden tabular-nums @3xl:table-cell">
                  <span className="inline-flex items-center gap-1.5">
                    {attemptLine}
                    {row.assignedToYou && <User aria-label="Assigned to you" className="size-3.5 text-[var(--muted)]" />}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="icon-sm" disabled={!pickable} aria-label={`Call ${name}`} aria-describedby={refusal ? `pick-${row.workItemId}` : undefined} onClick={(event) => { event.stopPropagation(); void pickLead(row); }}>
                    <Phone aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    // Sized by the column, never by its rows: the rows that fit are measured from this box.
    // At least four rows' room (toolbar 62 + heads 40 + pager 53 + borders + 4 × 49 = 353): the open
    // lead's card gives way and scrolls inside itself before the queue does.
    <div ref={box} className="@container flex min-h-0 flex-col lg:min-h-89 lg:flex-1 lg:basis-0 lg:overflow-hidden">
      <TableCard toolbar={toolbar} footer={footer}>
        {content}
      </TableCard>
    </div>
  );
}

function QueueHead({ third }: { third: string }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Lead</TableHead>
        <TableHead className="w-36">Phone</TableHead>
        <TableHead>{third}</TableHead>
        <TableHead className="hidden w-28 @2xl:table-cell">Priority</TableHead>
        <TableHead className="hidden w-32 @3xl:table-cell">Attempt</TableHead>
        <TableHead className="w-14"><span className="sr-only">Action</span></TableHead>
      </TableRow>
    </TableHeader>
  );
}

function LeadCell({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-semibold tracking-[-0.02em] text-[var(--ink)]" title={name}>{name}</span>
      {detail && <span className="hidden shrink-0 text-xs text-[var(--muted)] tabular-nums @xl:inline">{detail}</span>}
    </span>
  );
}

/**
 * The priority filter as chips (Dialer A, 2026-10-25): every tier one click. It sits in the row above
 * the columns, beside today's figures, so the table's toolbar stays one line; it narrows the same
 * list as the table's search and campaign.
 */
export function QueuePriorityChips({ d }: { d: ReturnType<typeof useDialer> }) {
  const { queueFilter, setQueueFilter } = d;
  return (
    <div role="radiogroup" aria-label="Filter the queue by priority" className="flex flex-wrap gap-1.5">
      {FILTERS.map((filter) => (
        <ToggleChip key={filter.key} role="radio" selected={queueFilter === filter.key} onClick={() => setQueueFilter(filter.key)}>
          {filter.key === "all" ? "All" : filter.label.replace(/ priority$/, "")}
        </ToggleChip>
      ))}
    </div>
  );
}

/**
 * Rows per page: the box's height (set by the column, not by the table) less the card's own chrome
 * (toolbar, column heads, pager, borders: the card's height less its body rows), over one row's
 * height. Below 1024px the page scrolls as one column, so five a page.
 */
function useRowsThatFit(box: RefObject<HTMLDivElement | null>, fallback = 5) {
  const [rows, setRows] = useState(fallback);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const measure = () => {
      if (!wide.matches) { setRows(fallback); return; }
      const card = element.querySelector<HTMLElement>('[data-slot="table-card"]');
      const body = element.querySelector<HTMLElement>('[data-slot="table-body"]');
      // Only a drawn table says how tall the chrome is; loading and empty states keep the last fit.
      if (!card || !body || body.children.length === 0) return;
      const rowHeight = Math.min(...Array.from(body.children, (row) => (row as HTMLElement).offsetHeight || ROW_HEIGHT));
      const chrome = card.offsetHeight - body.offsetHeight;
      setRows(Math.max(1, Math.min(MAX_ROWS, Math.floor((element.clientHeight - chrome) / rowHeight))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const card = element.querySelector('[data-slot="table-card"]');
    if (card) observer.observe(card);
    wide.addEventListener("change", measure);
    measure();
    return () => { observer.disconnect(); wide.removeEventListener("change", measure); };
  }, [box, fallback]);
  return rows;
}
