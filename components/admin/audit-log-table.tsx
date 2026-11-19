"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

import { AuditEntrySheet } from "@/components/admin/monitoring/audit-entry-sheet";
import { Button } from "@/components/ui/button";
import {
  ActiveFilters,
  ClearFiltersButton,
  DataToolbar,
  FilterField,
  FilterPopover,
  RefreshButton,
  ToolbarSearch,
  toolbarControl,
  type ActiveFilter,
} from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from "@/lib/audit/actions";
import { auditTargetText, shortWhenUtc } from "@/lib/audit/entryView";
import { AUDIT_LENSES, type AuditLens } from "@/lib/audit/lenses";
import {
  activeFilterCount,
  auditQueryString,
  decodeActorChoice,
  encodeActorChoice,
  parseAuditLogFilters,
  relativeTime,
  type AuditLogEntry,
} from "@/lib/audit/logView";
import { cn } from "@/lib/utils";

type Actor = { id: string; name: string; email: string };

const DEBOUNCE_MS = 300;

const noopSubscribe = () => () => {};
/** False during the server render and hydration, true after: local times exist only in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function targetRaw(entry: AuditLogEntry): string | undefined {
  return entry.target_type || entry.target_id ? `${entry.target_type ?? "record"}:${entry.target_id ?? ""}` : undefined;
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The Audit log list (admin round 1, docs/design/admin-r1/monitoring.html screen 5): one TableCard, one line a row,
 * newest first, paged on the server. Every filter lives in the address — lens (All · Money · Staff & access ·
 * Catalog), search, actor (super admin), action, dates, target and the page — so a filtered view can be linked, and
 * `?target=` from a record's page still lands on that record's history. An entry opens as a right sheet (`?entry=`).
 *
 * The server rendered the first page for the address it was given; after that the table asks
 * GET /api/admin/audit-log for whatever the address says. The per-actor rule is the server's: anyone but a super admin
 * gets their own rows whatever they send.
 */
export function AuditLogTable({
  initialEntries,
  initialTotal,
  initialApproximate,
  initialQuery,
  initialEntry,
  renderedAt,
  pageSize,
  isSuperAdmin,
  allAdmins,
  role,
}: {
  initialEntries: AuditLogEntry[];
  initialTotal: number;
  initialApproximate: boolean;
  /** The query the server's rows answer (auditQueryString), so they are not fetched again. */
  initialQuery: string;
  /** The entry `?entry=` named, read on its own when it is not on the first page. */
  initialEntry: AuditLogEntry | null;
  /** The server's clock when it rendered, so "4 minutes ago" is the same on both sides of hydration. */
  renderedAt: number;
  pageSize: number;
  isSuperAdmin: boolean;
  allAdmins: Actor[];
  role: AdminRole;
}) {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const filters = useMemo(() => parseAuditLogFilters(params, AUDIT_ACTIONS), [params]);
  const actor = encodeActorChoice({ actorType: filters.actorType, actorId: filters.actorId });
  const openId = params.get("entry");

  // The two typed filters follow the address once typing stops: every keystroke used to be a request.
  const [qInput, setQInput] = useState(filters.q ?? "");
  const [targetInput, setTargetInput] = useState(filters.target ?? "");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);

  const [reloadNonce, setReloadNonce] = useState(0);
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [approximate, setApproximate] = useState(initialApproximate);
  const [now, setNow] = useState(renderedAt);

  const queryString = auditQueryString(filters, isSuperAdmin);
  const requestKey = `${queryString}#${reloadNonce}`;
  // What the rows on screen answer. The server's rows answer the initial query, so it is not refetched.
  const [loadedKey, setLoadedKey] = useState(`${initialQuery}#0`);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const failed = failedKey === requestKey;
  const busy = !failed && requestKey !== loadedKey;

  useEffect(() => {
    if (requestKey === loadedKey) return;
    const controller = new AbortController();
    fetch(`/api/admin/audit-log?${queryString}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`audit log ${res.status}`);
        return (await res.json()) as { entries: AuditLogEntry[]; total: number; approximate: boolean };
      })
      .then((body) => {
        setEntries(body.entries);
        setTotal(body.total);
        setApproximate(body.approximate);
        setNow(Date.now());
        setLoadedKey(requestKey);
      })
      .catch(() => {
        // A superseded request is not a failure; a real one must not leave the previous query's
        // rows on screen under filters they do not match.
        if (!controller.signal.aborted) setFailedKey(requestKey);
      });
    return () => controller.abort();
  }, [requestKey, queryString, loadedKey]);

  // Keep "4 minutes ago" true while the page stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /** Any filter change goes back to page 1. */
  const filter = (patch: Record<string, string | null>) => setParamsInPlace({ ...patch, page: null });

  function typed(key: "q" | "target", value: string) {
    if (key === "q") setQInput(value);
    else setTargetInput(value);
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => filter({ [key]: value.trim() || null }), DEBOUNCE_MS);
  }

  function clearAll() {
    Object.values(timers.current).forEach(clearTimeout);
    // `target` is cleared here too: a "clear filters" control that leaves one filter applied lies.
    setQInput("");
    setTargetInput("");
    filter({ lens: null, action: null, actorId: null, actorType: null, from: null, to: null, target: null, q: null });
  }

  function showHistory(targetId: string) {
    Object.values(timers.current).forEach(clearTimeout);
    setQInput("");
    setTargetInput(targetId);
    setParamsInPlace({ lens: null, action: null, actorId: null, actorType: null, from: null, to: null, q: null, page: null, target: targetId, entry: null });
  }

  function chooseActor(value: string) {
    const choice = decodeActorChoice(value);
    filter({ actorId: choice.actorId, actorType: choice.actorType });
  }

  const filterCount = activeFilterCount({ action: filters.action, from: filters.from, to: filters.to, target: filters.target });
  const anyFilter = filterCount > 0 || actor !== "all" || Boolean(filters.q) || filters.lens !== "all";
  const actionOptions = useMemo(
    () => AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] })).sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  const chips: ActiveFilter[] = [
    ...(filters.action ? [{ key: "action", label: "Action", value: AUDIT_ACTION_LABELS[filters.action as keyof typeof AUDIT_ACTION_LABELS] ?? filters.action, onRemove: () => filter({ action: null }) }] : []),
    ...(filters.from || filters.to
      ? [{ key: "dates", label: "Dates (UTC)", value: `${filters.from ? dayLabel(filters.from) : "Any"} – ${filters.to ? dayLabel(filters.to) : "today"}`, onRemove: () => filter({ from: null, to: null }) }]
      : []),
    ...(filters.target
      ? [{
          key: "target",
          label: "Target",
          value: `${filters.target}${busy || failed ? "" : ` · ${approximate ? "about " : ""}${total.toLocaleString("en-US")} found`}`,
          onRemove: () => { setTargetInput(""); filter({ target: null }); },
        }]
      : []),
  ];

  const selected = openId ? entries.find((entry) => entry.id === openId) ?? (initialEntry?.id === openId ? initialEntry : null) : null;
  const open = (entry: AuditLogEntry) => setParamsInPlace({ entry: entry.id });

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={failed ? undefined : <Pager page={filters.page} pageSize={pageSize} total={total} noun="entries" suffix="newest first" approximate={approximate} onPage={(next) => setParamsInPlace({ page: next > 1 ? String(next) : null })} disabled={busy} />}
        toolbar={
          <DataToolbar
            actions={<>
              {anyFilter && <ClearFiltersButton onClick={clearAll} />}
              <RefreshButton onClick={() => setReloadNonce((n) => n + 1)} refreshing={busy} />
            </>}
          >
            <span role="radiogroup" aria-label="Audit log views" className="flex flex-wrap items-center gap-1.5">
              {AUDIT_LENSES.map((lens) => (
                <ToggleChip key={lens.key} role="radio" selected={filters.lens === lens.key} onClick={() => filter({ lens: lens.key === "all" ? null : (lens.key as AuditLens) })}>
                  {lens.label}
                </ToggleChip>
              ))}
            </span>
            <ToolbarSearch
              value={qInput}
              onChange={(value) => typed("q", value)}
              placeholder="Search action or target"
              label="Search by action code or name, or an exact target id"
            />
            {isSuperAdmin && (
              <select aria-label="Actor" className={cn(toolbarControl, "w-[220px]")} value={actor} onChange={(e) => chooseActor(e.target.value)}>
                <option value="all">All actors</option>
                <option value="type:admin">Staff</option>
                <option value="type:tenant">Agency users</option>
                <option value="type:system">System</option>
                {allAdmins.length > 0 && (
                  <optgroup label="Staff members">
                    {allAdmins.map((a) => (
                      <option key={a.id} value={`id:${a.id}`}>
                        {a.name} ({a.email})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
            <FilterPopover count={filterCount} onClear={() => { setTargetInput(""); filter({ action: null, from: null, to: null, target: null }); }}>
              <FilterField label="Action" htmlFor="audit-action">
                <select id="audit-action" className={toolbarControl} value={filters.action ?? "all"} onChange={(e) => filter({ action: e.target.value === "all" ? null : e.target.value })}>
                  <option value="all">All actions</option>
                  {actionOptions.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="From (UTC)" htmlFor="audit-from">
                <input id="audit-from" type="date" className={toolbarControl} value={filters.from ?? ""} max={filters.to ?? undefined} onChange={(e) => filter({ from: e.target.value || null })} />
              </FilterField>
              <FilterField label="To (UTC, inclusive)" htmlFor="audit-to">
                <input id="audit-to" type="date" className={toolbarControl} value={filters.to ?? ""} min={filters.from ?? undefined} onChange={(e) => filter({ to: e.target.value || null })} />
              </FilterField>
              <FilterField label="Target ID" htmlFor="audit-target">
                <input
                  id="audit-target"
                  type="text"
                  value={targetInput}
                  onChange={(e) => typed("target", e.target.value)}
                  placeholder="A user, tenant or invoice id"
                  title="Paste a user, tenant or invoice id to see only what happened to that record."
                  className={cn(toolbarControl, "placeholder:text-muted-foreground")}
                />
              </FilterField>
            </FilterPopover>
            <ActiveFilters inline filters={chips} onClear={clearAll} />
          </DataToolbar>
        }
      >
        {failed ? (
          <ErrorState
            title="Couldn't read the audit log"
            detail="Nothing is shown rather than rows that do not match these filters. Try again; if it keeps failing, the log's database is unreachable."
            action={
              <Button type="button" variant="outline" onClick={() => setReloadNonce((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        ) : entries.length === 0 && !busy ? (
          anyFilter || filters.page > 1 ? (
            <NoMatches noun="audit entries" onClear={clearAll} />
          ) : (
            <EmptyState
              title="No recorded actions yet"
              hint={
                isSuperAdmin
                  ? "Every staff, agency and system action will appear here as it happens."
                  : "Actions you take in the staff console will appear here as you take them."
              }
            />
          )
        ) : (
          <Table className={cn("min-w-[960px] transition-opacity", busy && "opacity-60")} aria-busy={busy}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When (UTC)</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="w-10 pr-4"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  tabIndex={0}
                  onClick={() => open(entry)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(entry);
                    }
                  }}
                  aria-selected={openId === entry.id}
                  aria-label={`${entry.actionLabel ?? entry.action} by ${entry.actorLabel}, ${entry.whenUtc}. Open details.`}
                  className="cursor-pointer outline-none focus-visible:bg-[var(--hover-wash)]"
                >
                  <TableCell className="whitespace-nowrap pl-4 tabular-nums" title={`${entry.whenUtc} · ${relativeTime(entry.ts, now)}`}>
                    {shortWhenUtc(entry.ts, now)}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate" title={entry.actorDetail ?? undefined}>{entry.actorLabel}</TableCell>
                  <TableCell className="max-w-[260px] truncate font-medium text-foreground" title={entry.action}>{entry.actionLabel ?? entry.action}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={targetRaw(entry)}>{auditTargetText(entry)}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={entry.reason ?? undefined}>{entry.reason ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">{entry.ip ?? "—"}</TableCell>
                  <TableCell className="pr-4 text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {selected && (
        <AuditEntrySheet
          key={selected.id}
          entry={selected}
          role={role}
          hydrated={hydrated}
          onClose={() => setParamsInPlace({ entry: null })}
          onHistory={showHistory}
        />
      )}
    </>
  );
}
