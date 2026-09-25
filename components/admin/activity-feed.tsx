"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { SearchBox } from "@/components/app/settings/primitives";
// From ./constants and ./present, not ./queries — this is a client component, and queries.ts is
// server-only.
import { ACTIVITY_PAGE_SIZE, type LoginEventRow } from "@/lib/loginEvents/constants";
import {
  ACTIVITY_SEARCH_MAX,
  ACTOR_OPTIONS,
  DEFAULT_ACTIVITY_FILTERS,
  OUTCOME_OPTIONS,
  RANGE_OPTIONS,
  countLine,
  popoverFilterCount,
  type ActivityActor,
  type ActivityFilters,
  type ActivityOutcome,
  type ActivityRange,
} from "@/lib/loginEvents/present";
import { LoginActivityTable } from "./login-activity-table";
import { BoardTableFooter } from "./board-table-footer";

const TOOL_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const MENU_ITEM = "text-[14px] tracking-[-0.02em] text-[var(--ink)]";

type Loaded = { events: LoginEventRow[]; total: number; rangeTotal: number };

function sameFilters(a: ActivityFilters, b: ActivityFilters) {
  return a.outcome === b.outcome && a.actor === b.actor && a.range === b.range && a.q === b.q;
}

/**
 * The board's filter card, chip row, table and footer. Page 1 with the default filters is rendered
 * on the server; every change after that reads /api/admin/activity. The rows on screen always
 * belong to the filters on screen: while a request is out the old rows are dimmed, and if it fails
 * they are replaced by the error — never left standing under a filter they do not match.
 */
export function ActivityFeed({ initial }: { initial: Loaded }) {
  const [data, setData] = useState<Loaded>(initial);
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const isFirstRun = useRef(true);
  const requestId = useRef(0);

  // The search box types freely; the query follows it after a pause, so each keystroke is not a
  // request.
  useEffect(() => {
    const term = search.trim().slice(0, ACTIVITY_SEARCH_MAX);
    if (term === filters.q) return;
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, q: term }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filters.q]);

  useEffect(() => {
    // Page 1 with the default filters is already server-rendered.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const params = new URLSearchParams({ page: String(page), range: filters.range });
    if (filters.outcome !== "all") params.set("outcome", filters.outcome);
    if (filters.actor !== "all") params.set("actor", filters.actor);
    if (filters.q) params.set("q", filters.q);

    const id = ++requestId.current;
    setBusy(true);
    fetch(`/api/admin/activity?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Loaded>) : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        if (id !== requestId.current) return;
        setData({ events: body.events, total: body.total, rangeTotal: body.rangeTotal });
        setFailed(false);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setData({ events: [], total: 0, rangeTotal: 0 });
        setFailed(true);
      })
      .finally(() => {
        if (id === requestId.current) setBusy(false);
      });
  }, [filters, page, retry]);

  function update(patch: Partial<ActivityFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearAll() {
    setSearch("");
    setFilters(DEFAULT_ACTIVITY_FILTERS);
    setPage(1);
  }

  const outcome = OUTCOME_OPTIONS.find((option) => option.value === filters.outcome) ?? OUTCOME_OPTIONS[0];
  const actor = ACTOR_OPTIONS.find((option) => option.value === filters.actor) ?? ACTOR_OPTIONS[0];
  const popoverCount = popoverFilterCount(filters);
  const narrowed = filters.outcome !== "all" || filters.actor !== "all" || filters.q !== "";
  const atDefaults = sameFilters(filters, DEFAULT_ACTIVITY_FILTERS) && search.trim() === "";
  const rangePhrase = RANGE_OPTIONS.find((option) => option.value === filters.range)?.phrase ?? "";

  let empty: React.ReactNode;
  if (failed) {
    empty = (
      <ErrorState
        title="Login activity did not load"
        detail="The attempts for these filters could not be read. Nothing has been hidden; try again."
        action={
          <button type="button" className={TOOL_BUTTON} onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        }
      />
    );
  } else if (narrowed) {
    empty = <NoMatches noun="attempts" onClear={clearAll} />;
  } else if (filters.range === "all") {
    empty = (
      <EmptyState
        title="No login attempts recorded yet"
        hint="Every sign-in and failed attempt lands here, so this fills up on its own. An empty list this early is normal."
      />
    );
  } else {
    empty = (
      <EmptyState
        title={`No sign-in attempts ${rangePhrase}`}
        hint="Attempts appear here as they happen. Choose a wider range under Filters to see earlier ones."
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={TOOL_BUTTON} aria-label={`Outcome: ${outcome.label}`}>
              {outcome.label}
              <ChevronDown className="size-[13px]" strokeWidth={2.4} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            <DropdownMenuRadioGroup value={filters.outcome} onValueChange={(value) => update({ outcome: value as ActivityOutcome })}>
              {OUTCOME_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className={MENU_ITEM}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <SearchBox value={search} onChange={setSearch} placeholder="Search actor, IP" label="Search by email address or IP" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={TOOL_BUTTON}
              aria-label={popoverCount > 0 ? `Filters, ${popoverCount} changed` : "Filters"}
            >
              <SlidersHorizontal className="size-[15px]" strokeWidth={2.2} aria-hidden="true" />
              Filters
              {popoverCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums">
                  {popoverCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuLabel className="text-[12px]">Actor</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filters.actor} onValueChange={(value) => update({ actor: value as ActivityActor })}>
              {ACTOR_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className={MENU_ITEM}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[12px]">Range</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filters.range} onValueChange={(value) => update({ range: value as ActivityRange })}>
              {RANGE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className={MENU_ITEM}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="flex-1" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label={`Outcome: ${outcome.chip}`} onClear={filters.outcome !== "all" ? () => update({ outcome: "all" }) : undefined} clearLabel="Clear the outcome filter" />
        <FilterChip label={`Actor: ${actor.chip}`} onClear={filters.actor !== "all" ? () => update({ actor: "all" }) : undefined} clearLabel="Clear the actor filter" />
        <button
          type="button"
          onClick={clearAll}
          disabled={atDefaults}
          title={atDefaults ? "Nothing to clear — every filter is at its default" : undefined}
          className="rounded-[6px] bg-transparent p-1 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
        >
          Clear all
        </button>
        <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums" aria-live="polite">
          {failed ? "Count unavailable" : countLine(data.total, data.rangeTotal, filters.range)}
        </span>
      </div>

      <LoginActivityTable
        layout="board"
        events={data.events}
        busy={busy}
        empty={empty}
        footer={
          <BoardTableFooter
            page={page}
            pageSize={ACTIVITY_PAGE_SIZE}
            total={data.total}
            itemLabel={data.total === 1 ? "attempt" : "attempts"}
            order="newest first"
            onPageChange={setPage}
            busy={busy}
          />
        }
      />
    </>
  );
}

function FilterChip({ label, onClear, clearLabel }: { label: string; onClear?: () => void; clearLabel: string }) {
  return (
    <span
      className={
        "inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1 pl-3 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--body)] " +
        (onClear ? "pr-2" : "pr-3")
      }
    >
      {label}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--body)] hover:bg-[var(--border)]"
        >
          <X className="size-2.5" strokeWidth={2.6} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
