"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
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
  type ActivityActor,
  type ActivityFilters,
  type ActivityOutcome,
  type ActivityRange,
} from "@/lib/loginEvents/present";
import { LoginActivityTable } from "./login-activity-table";
import { BoardTableFooter } from "./board-table-footer";

type Loaded = { events: LoginEventRow[]; total: number; rangeTotal: number };

function sameFilters(a: ActivityFilters, b: ActivityFilters) {
  return a.outcome === b.outcome && a.actor === b.actor && a.range === b.range && a.q === b.q;
}

/**
 * The login-attempt table with its toolbar and footer. Page 1 with the default filters is rendered
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
          <Button type="button" variant="outline" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        }
      />
    );
  } else if (narrowed) {
    empty = <NoMatches noun="attempts" onClear={clearAll} />;
  } else if (filters.range === "all") {
    empty = (
      <EmptyState
        title="No login attempts recorded yet"
        hint="Sign-ins and failed attempts appear here as they happen."
      />
    );
  } else {
    empty = (
      <EmptyState
        title={`No sign-in attempts ${rangePhrase}`}
        hint="Choose a wider range to see earlier attempts."
      />
    );
  }

  return (
    <TableCard
      toolbar={
        <DataToolbar
          actions={
            <>
              {!atDefaults && (
                <Button type="button" variant="ghost" onClick={clearAll}>
                  Clear filters
                </Button>
              )}
              <RefreshButton onClick={() => setRetry((n) => n + 1)} refreshing={busy} />
            </>
          }
        >
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search actor, IP" label="Search by email address or IP" />
          <select
            aria-label="Outcome"
            className={toolbarControl}
            value={filters.outcome}
            onChange={(event) => update({ outcome: event.target.value as ActivityOutcome })}
          >
            {OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Actor"
            className={toolbarControl}
            value={filters.actor}
            onChange={(event) => update({ actor: event.target.value as ActivityActor })}
          >
            {ACTOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Range"
            className={toolbarControl}
            value={filters.range}
            onChange={(event) => update({ range: event.target.value as ActivityRange })}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {failed ? "Count unavailable" : countLine(data.total, data.rangeTotal, filters.range)}
          </span>
        </DataToolbar>
      }
    >
      <LoginActivityTable
        layout="board"
        framed={false}
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
    </TableCard>
  );
}
