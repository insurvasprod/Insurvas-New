"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LoginSheet } from "@/components/admin/monitoring/login-sheet";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { NavPending, setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
// From ./constants and ./present, not ./queries — this is a client component, and queries.ts is
// server-only.
import { ACTIVITY_PAGE_SIZE, type LoginEventRow } from "@/lib/loginEvents/constants";
import {
  ACTIVITY_SEARCH_MAX,
  OUTCOME_OPTIONS,
  RANGE_OPTIONS,
  REPEATED_FAILURE_MIN,
  actorOptionsFor,
  countLine,
  type ActivityFilters,
  type ActivityLens,
} from "@/lib/loginEvents/present";
import { LoginActivityTable } from "./login-activity-table";

type Loaded = { events: LoginEventRow[]; total: number; rangeTotal: number };

/**
 * The login-attempt table with its toolbar and footer (admin round 1, monitoring.html screen 2). Every filter, the
 * lens and the page live in the address, and the server renders the rows for them: a filtered view can be shared,
 * bookmarked or linked from the Monitoring workspace. A change navigates in a transition, so the old rows stay on
 * screen, dimmed, until the new ones arrive — never left standing under a filter they do not match, and if the read
 * fails the rows are replaced by the error. An attempt opens as a right sheet (`?attempt=<id>`) in place.
 */
export function ActivityFeed({
  initial,
  filters,
  lens,
  page,
  failed,
  viewerRole,
}: {
  initial: Loaded;
  filters: ActivityFilters;
  lens: ActivityLens;
  page: number;
  /** The server could not read the rows for these filters. */
  failed: boolean;
  viewerRole: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  // Staff sign-ins are super_admin only (the server enforces it); nobody else is offered the choice.
  const actorOptions = actorOptionsFor(viewerRole);
  const [search, setSearch] = useState(filters.q);
  const openId = params.get("attempt");

  /** Patches the address and asks the server for the rows; page 1 unless the patch names a page. */
  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    if (!("page" in patch)) next.delete("page");
    next.delete("attempt");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    start(() => router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false }));
  }

  // The search box types freely; the address follows it after a pause, so each keystroke is not a request.
  useEffect(() => {
    const term = search.trim().slice(0, ACTIVITY_SEARCH_MAX);
    if (term === filters.q) return;
    const timer = setTimeout(() => go({ q: term || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` reads the current address; re-running on it would loop.
  }, [search, filters.q]);

  function clearAll() {
    setSearch("");
    go({ q: null, outcome: null, actor: null, range: null, lens: null });
  }

  const narrowed = filters.outcome !== "all" || filters.actor !== "all" || filters.q !== "" || lens === "repeated";
  const atDefaults = !narrowed && filters.range === "today";
  const rangePhrase = RANGE_OPTIONS.find((option) => option.value === filters.range)?.phrase ?? "";

  let empty: React.ReactNode;
  if (failed) {
    empty = (
      <ErrorState
        title="Login activity did not load"
        detail="The attempts for these filters could not be read. Nothing has been hidden; try again."
        action={
          <Button type="button" variant="outline" onClick={() => start(() => router.refresh())}>
            Try again
          </Button>
        }
      />
    );
  } else if (lens === "repeated" && filters.q === "" && filters.outcome === "all" && filters.actor === "all") {
    empty = (
      <EmptyState
        title={`No repeated failures ${rangePhrase}`}
        hint={`An address shows here once it fails ${REPEATED_FAILURE_MIN} times or more in the range.`}
      />
    );
  } else if (narrowed) {
    empty = <NoMatches noun="attempts" onClear={clearAll} />;
  } else if (filters.range === "all") {
    empty = <EmptyState title="No login attempts recorded yet" hint="Sign-ins and failed attempts appear here as they happen." />;
  } else {
    empty = <EmptyState title={`No sign-in attempts ${rangePhrase}`} hint="Choose a wider range to see earlier attempts." />;
  }

  const open = openId ? initial.events.find((event) => event.id === openId) ?? null : null;

  return (
    <>
      <NavPending pending={pending} />
      <TableCard
        footer={
          <Pager
            page={page}
            pageSize={ACTIVITY_PAGE_SIZE}
            total={initial.total}
            noun={initial.total === 1 ? "attempt" : "attempts"}
            suffix="newest first"
            onPage={(next) => go({ page: next > 1 ? String(next) : null })}
            disabled={pending}
          />
        }
        toolbar={
          <DataToolbar
            actions={
              <>
                {!atDefaults && (
                  <Button type="button" variant="ghost" onClick={clearAll}>
                    Clear filters
                  </Button>
                )}
                <RefreshButton onClick={() => start(() => router.refresh())} refreshing={pending} />
              </>
            }
          >
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search actor, IP" label="Search by email address or IP" />
            <select
              aria-label="Outcome"
              className={toolbarControl}
              value={filters.outcome}
              onChange={(event) => go({ outcome: event.target.value === "all" ? null : event.target.value })}
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
              onChange={(event) => go({ actor: event.target.value === "all" ? null : event.target.value })}
            >
              {actorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Range"
              className={toolbarControl}
              value={filters.range}
              onChange={(event) => go({ range: event.target.value === "today" ? null : event.target.value })}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {failed ? "Count unavailable" : countLine(initial.total, initial.rangeTotal, filters.range)}
            </span>
          </DataToolbar>
        }
      >
        <LoginActivityTable
          layout="board"
          framed={false}
          events={initial.events}
          busy={pending}
          empty={empty}
          selectedId={openId}
          onOpen={(id) => setParamsInPlace({ attempt: id })}
        />
      </TableCard>

      {openId && (
        <LoginSheet
          key={openId}
          id={openId}
          row={open}
          viewerRole={viewerRole}
          onClose={() => setParamsInPlace({ attempt: null })}
        />
      )}
    </>
  );
}
