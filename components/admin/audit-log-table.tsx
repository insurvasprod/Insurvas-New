"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { SearchBox, btn, st } from "@/components/app/settings/primitives";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from "@/lib/audit/actions";
import {
  activeFilterCount,
  decodeActorChoice,
  relativeTime,
  type AuditLogEntry,
} from "@/lib/audit/logView";
import { cn } from "@/lib/utils";

type Actor = { id: string; name: string; email: string };

type Query = {
  action: string;
  actor: string;
  from: string;
  to: string;
  target: string;
  q: string;
  page: number;
};

const DEBOUNCE_MS = 300;

// The board's 40px toolbar controls: strong edge, 8px radius, 14px semibold.
const CONTROL =
  "box-border h-10 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const TRIGGER =
  "h-10 data-[size=default]:h-10 gap-2 rounded-[8px] border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] shadow-none dark:bg-[var(--surface)]";
const FIELD_LABEL = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
// Break inside long codes, emails and ids rather than widening the column.
const WRAP = "[overflow-wrap:anywhere]";

function toQueryString(query: Query, isSuperAdmin: boolean): string {
  const params = new URLSearchParams();
  if (query.action !== "all") params.set("action", query.action);
  if (isSuperAdmin) {
    const choice = decodeActorChoice(query.actor);
    if (choice.actorId) params.set("actorId", choice.actorId);
    else if (choice.actorType) params.set("actorType", choice.actorType);
  }
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.target) params.set("target", query.target);
  if (query.q) params.set("q", query.q);
  params.set("page", String(query.page));
  return params.toString();
}

/** A value that follows `value` once it has stopped changing for `ms`. */
function useDebounced(value: string, ms = DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}

const noopSubscribe = () => () => {};
/** False during the server render and hydration, true after: local times exist only in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })} (your time)`;
}

function targetText(entry: AuditLogEntry): string {
  if (entry.targetLabel) return entry.targetLabel;
  if (entry.target_type) return `${entry.target_type}:${entry.target_id ?? ""}`;
  return entry.target_id ?? "—";
}

function targetRaw(entry: AuditLogEntry): string | undefined {
  return entry.target_type || entry.target_id ? `${entry.target_type ?? "record"}:${entry.target_id ?? ""}` : undefined;
}

function SlidersIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function AuditLogTable({
  initialEntries,
  initialTotal,
  initialApproximate,
  initialTarget,
  renderedAt,
  pageSize,
  isSuperAdmin,
  allAdmins,
}: {
  initialEntries: AuditLogEntry[];
  initialTotal: number;
  initialApproximate: boolean;
  /** From `?target=`; the server already applied it to initialEntries. */
  initialTarget: string;
  /** The server's clock when it rendered, so "4 minutes ago" is the same on both sides of hydration. */
  renderedAt: number;
  pageSize: number;
  isSuperAdmin: boolean;
  allAdmins: Actor[];
}) {
  const hydrated = useHydrated();

  const [action, setAction] = useState<string>("all");
  const [actor, setActor] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // The two typed filters wait until typing stops: every keystroke used to be a request.
  const [targetInput, setTargetInput] = useState(initialTarget);
  const [qInput, setQInput] = useState("");
  const target = useDebounced(targetInput.trim());
  const q = useDebounced(qInput.trim());
  const [page, setPage] = useState(1);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [approximate, setApproximate] = useState(initialApproximate);
  const [now, setNow] = useState(renderedAt);

  const queryString = toQueryString({ action, actor, from, to, target, q, page }, isSuperAdmin);
  const requestKey = `${queryString}#${reloadNonce}`;
  // What the rows on screen answer. The server's rows answer the initial query, so it is not refetched.
  const [loadedKey, setLoadedKey] = useState(
    () => `${toQueryString({ action: "all", actor: "all", from: "", to: "", target: initialTarget.trim(), q: "", page: 1 }, isSuperAdmin)}#0`,
  );
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

  function onFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function clearAll() {
    setAction("all");
    setActor("all");
    setFrom("");
    setTo("");
    // `target` must be cleared here too. A "clear filters" control that leaves one filter applied
    // is the same class of lying control as the rest of this audit.
    setTargetInput("");
    setQInput("");
    setPage(1);
  }

  const filterCount = activeFilterCount({ action: action === "all" ? null : action, from, to, target: target || null });
  const anyFilter = filterCount > 0 || actor !== "all" || q !== "";
  const actionOptions = useMemo(
    () => AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] })),
    [],
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          {isSuperAdmin && (
            <Select value={actor} onValueChange={onFilter(setActor)}>
              <SelectTrigger aria-label="Actor" className={TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actors</SelectItem>
                <SelectItem value="type:admin">Staff</SelectItem>
                <SelectItem value="type:tenant">Agency users</SelectItem>
                <SelectItem value="type:system">System</SelectItem>
                {allAdmins.length > 0 && <SelectSeparator />}
                {allAdmins.map((a) => (
                  <SelectItem key={a.id} value={`id:${a.id}`}>
                    {a.name} ({a.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <SearchBox
            value={qInput}
            onChange={onFilter(setQInput)}
            placeholder="Search action, target"
            label="Search by action code or name, or an exact target id"
          />

          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="audit-log-filters"
            className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
          >
            <SlidersIcon />
            Filters
            {filterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                {filterCount}
                <span className="sr-only"> active</span>
              </span>
            )}
          </button>
          <span className="grow" />
        </div>

        {filtersOpen && (
          <div id="audit-log-filters" className="mt-3 flex flex-wrap items-end gap-4 border-t border-[var(--border)] pt-3">
            <div className="flex flex-col gap-1.5">
              <span id="audit-filter-action" className={FIELD_LABEL}>
                Action
              </span>
              <Select value={action} onValueChange={onFilter(setAction)}>
                <SelectTrigger aria-labelledby="audit-filter-action" className={cn(TRIGGER, "w-[260px] font-normal")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>From (UTC)</span>
              <input type="date" value={from} onChange={(e) => onFilter(setFrom)(e.target.value)} className={CONTROL} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>To (UTC, inclusive)</span>
              <input type="date" value={to} onChange={(e) => onFilter(setTo)(e.target.value)} className={CONTROL} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Target ID</span>
              <input
                type="text"
                value={targetInput}
                onChange={(e) => onFilter(setTargetInput)(e.target.value)}
                placeholder="Paste a user, tenant or invoice id"
                title="Paste a user, tenant or invoice id to see only what happened to that record."
                className={cn(CONTROL, "w-[280px] placeholder:text-[var(--muted)]")}
              />
            </label>
            {anyFilter && (
              <button type="button" onClick={clearAll} className={btn("ghost")}>
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {target && (
        <p className="-mt-3 flex flex-wrap items-center gap-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
          <span>
            Showing only entries whose target is <code className="font-mono text-[13px] text-[var(--ink)]">{target}</code>.{" "}
            {busy || failed ? "" : `${approximate ? "About " : ""}${total.toLocaleString()} found.`}
          </span>
          <button type="button" onClick={() => onFilter(setTargetInput)("")} className={btn("secondary")}>
            Clear target
          </button>
        </p>
      )}

      <section className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        {failed ? (
          <ErrorState
            title="The audit log did not load"
            detail="Nothing is shown rather than rows that do not match these filters. Try again; if it keeps failing, the log's database is unreachable."
            action={
              <button type="button" onClick={() => setReloadNonce((n) => n + 1)} className={btn("secondary")}>
                Try again
              </button>
            }
          />
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className={cn(st.table, "min-w-[960px] transition-opacity", busy && "opacity-60")} aria-busy={busy}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[200px]")}>When</th>
                  <th scope="col" className={cn(st.th, "w-[190px]")}>Actor</th>
                  <th scope="col" className={cn(st.th, "w-[210px]")}>Action</th>
                  <th scope="col" className={cn(st.th, "w-[180px]")}>Target</th>
                  <th scope="col" className={st.th}>Reason</th>
                  <th scope="col" className={cn(st.th, "w-[130px]")}>IP</th>
                </tr>
              </thead>
              <tbody className="m-seq">
                {entries.length === 0 && !busy && (
                  <tr>
                    <td colSpan={6} className="border-t border-[var(--border)] p-0">
                      {anyFilter || page > 1 ? (
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
                      )}
                    </td>
                  </tr>
                )}
                {entries.map((entry) => {
                  const isSelected = selected?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      tabIndex={0}
                      onClick={() => setSelected(entry)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(entry);
                        }
                      }}
                      aria-label={`${entry.action} by ${entry.actorLabel}, ${entry.whenUtc}. Open details.`}
                      className={cn(
                        "m-row cursor-pointer outline-none focus-visible:bg-[var(--brand-50)]",
                        isSelected ? "bg-[var(--brand-50)]" : "hover:bg-[var(--canvas)]",
                      )}
                    >
                      <td className={cn(st.td, "align-top tabular-nums")} title={hydrated ? localTime(entry.ts) : undefined}>
                        {entry.whenUtc}
                        <br />
                        <span className="text-[12px] text-[var(--muted)]">{relativeTime(entry.ts, now)}</span>
                      </td>
                      <td className={cn(st.td, "align-top", WRAP)} title={entry.actorDetail ?? undefined}>
                        {entry.actorLabel}
                      </td>
                      <td className={cn(st.td, "align-top", WRAP)} title={entry.actionLabel ?? undefined}>
                        {entry.action}
                      </td>
                      <td className={cn(st.td, "align-top", WRAP)} title={targetRaw(entry)}>
                        {targetText(entry)}
                      </td>
                      <td className={cn(st.td, "align-top", WRAP)}>
                        {entry.reason ?? <span className="text-[var(--muted)]">—</span>}
                      </td>
                      <td className={cn(st.td, "align-top tabular-nums", WRAP)}>
                        {entry.ip ?? <span className="text-[var(--muted)]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="grow" />
        {!failed && (
          <BoardTableFooter
            page={page}
            pageSize={pageSize}
            total={total}
            itemLabel="entries"
            order="newest first · server-side paging"
            approximate={approximate}
            onPageChange={setPage}
            busy={busy}
          />
        )}
      </section>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected && (selected.actionLabel ?? selected.action)}</DialogTitle>
            <DialogDescription>{selected?.whenUtc}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">Action</p>
                  <p className="font-mono text-[13px] font-medium break-all">{selected.action}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Your local time</p>
                  <p className="font-medium">{hydrated ? localTime(selected.ts) : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Actor</p>
                  <p className="font-medium break-words">{selected.actorDetail ?? selected.actorLabel}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Target</p>
                  <p className="font-medium break-all">
                    {selected.targetLabel && <span className="block break-words">{selected.targetLabel}</span>}
                    {targetRaw(selected) ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">IP</p>
                  <p className="font-medium">{selected.ip ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">User agent</p>
                  <p className="truncate font-medium" title={selected.user_agent ?? undefined}>
                    {selected.user_agent ?? "—"}
                  </p>
                </div>
              </div>
              {selected.reason && (
                <div>
                  <p className="text-muted-foreground">Reason</p>
                  <p className="font-medium">{selected.reason}</p>
                </div>
              )}
              <div>
                <p className="mb-1 text-muted-foreground">Metadata</p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
