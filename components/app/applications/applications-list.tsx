"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import {
  APPLICATION_OUTCOME_LABEL, APPLICATION_OUTCOME_TONE, APPLICATION_OUTCOMES, APPLICATION_STATUS_LABEL, type ApplicationStatus,
} from "@/lib/applications/constants";
import { dayMonthTime, missingNumber as orphanRule, SUBMITTED_STATUSES, type ApplicationRow } from "@/lib/applications/listRules";
import type { ApplicationListRow } from "@/lib/applications/types";
import { formatCents } from "@/lib/money";
import { ATTEMPT_STATUS_TONE, money, ordinal, SampleDataNotice } from "./parts";

// ── Small helpers the LA-3 list pages share ──────────────────────────────────

/** Whole days between an ISO time and now (never negative). */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** "today", "yesterday", "3 days ago". */
export function daysAgoLabel(days: number | null, never = "never"): string {
  if (days === null) return never;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * Refresh for a page that reads fixtures: the button spins briefly and nothing reloads, so the
 * control is where it will be once the page fetches.
 */
export function useSampleRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    setRefreshing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRefreshing(false), 450);
  }, []);
  return { refreshing, refresh };
}

/**
 * Refresh a list from its route: sample pages spin and keep the fixtures; live pages fetch with
 * `cache: "no-store"` and keep what is on screen when the fetch fails, saying so.
 */
export function useLiveRefresh<T>(opts: { sample: boolean; url: string; pick: (body: unknown) => T | null; apply: (value: T) => void }) {
  const sampleRefresh = useSampleRefresh();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { url, pick, apply, sample } = opts;
  const refresh = useCallback(async () => {
    if (sample) { sampleRefresh.refresh(); return; }
    setRefreshing(true);
    try {
      const r = await fetch(url, { cache: "no-store" });
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      const value = r.ok ? pick(body) : null;
      if (value === null) { setError(body?.error ?? "Could not refresh — what you see is from the last load."); return; }
      apply(value);
      setError(null);
    } catch {
      setError("Could not refresh — check your connection. What you see is from the last load.");
    } finally {
      setRefreshing(false);
    }
  }, [sample, sampleRefresh, url, pick, apply]);
  return { refresh, refreshing: sample ? sampleRefresh.refreshing : refreshing, error };
}

export const clientLinkClass = "font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

/** The case link for a row, landing on the right insured and (optionally) step. */
export function caseHref(caseId: string, opts: { insured?: "primary" | "spouse"; step?: string; attempt?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.attempt) q.set("attempt", String(opts.attempt));
  if (opts.insured === "spouse") q.set("insured", "spouse");
  if (opts.step) q.set("step", opts.step);
  const query = q.toString();
  return `/app/applications/${caseId}${query ? `?${query}` : ""}`;
}

/** The orphan rule (LA-3.15): submitted with no carrier reference, or issued with no policy number. */
export function missingNumber(row: ApplicationListRow): "reference" | "policy_number" | null {
  return orphanRule(row);
}

// ── Applications ─────────────────────────────────────────────────────────────

const OPEN_STATUSES = ["draft", "ready", "submitted", "pending_carrier", "counteroffer_pending"] as const satisfies readonly ApplicationStatus[];

function statusKey(row: ApplicationListRow) {
  return row.status === "closed" && row.outcome ? `outcome:${row.outcome}` : row.status;
}

function statusLabel(key: string) {
  return key.startsWith("outcome:") ? APPLICATION_OUTCOME_LABEL[key.slice(8) as keyof typeof APPLICATION_OUTCOME_LABEL] : APPLICATION_STATUS_LABEL[key as ApplicationStatus];
}

/** The status the board prints: an issued attempt with no policy number reads "Awaiting policy #". */
function statusView(row: ApplicationListRow): { label: string; tone: StatusTone } {
  if (row.status === "closed" && row.outcome) {
    if (row.outcome === "issued" && orphanRule(row) === "policy_number") return { label: "Awaiting policy #", tone: "danger" };
    return { label: APPLICATION_OUTCOME_LABEL[row.outcome], tone: APPLICATION_OUTCOME_TONE[row.outcome] };
  }
  return { label: APPLICATION_STATUS_LABEL[row.status], tone: ATTEMPT_STATUS_TONE[row.status] };
}

/** QA as the board prints it: from the verdict frozen at submission, "Pass" at ready, nothing on a draft. */
function QaCell({ row }: { row: ApplicationRow }) {
  if (row.qaVerdict === "fail") return <StatusChip tone="danger">{row.qaBlocking ? `${row.qaBlocking} to fix` : "To fix"}</StatusChip>;
  if (row.qaVerdict === "pass_with_warnings") return <StatusChip tone="warning">{row.qaWarnings ? `${row.qaWarnings} ${row.qaWarnings === 1 ? "warning" : "warnings"}` : "Warnings"}</StatusChip>;
  if (row.qaVerdict === "pass" || row.status === "ready") return <StatusChip tone="good" title={row.qaVerdict ? "The check frozen when it was submitted" : "Passed the check when it was marked ready"}>Pass</StatusChip>;
  return <span className="text-muted-foreground" title="Not checked yet — the check runs on the Review step">—</span>;
}

export function ApplicationsList({ rows: initialRows, sample = false, timeZone }: { rows: ApplicationRow[]; sample?: boolean; timeZone?: string }) {
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [carrier, setCarrier] = useState("all");
  const [missingOnly, setMissingOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());
  const pick = useCallback((body: unknown) => (body as { applications?: ApplicationRow[] } | null)?.applications ?? null, []);
  const { refresh, refreshing, error: loadError } = useLiveRefresh({ sample, url: "/api/app/applications", pick, apply: setRows });

  const carriers = useMemo(() => [...new Set(rows.map((row) => row.carrierName).filter((name): name is string => Boolean(name)))].sort(), [rows]);
  const sorted = useMemo(() => [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.clientName.localeCompare(b.clientName)), [rows]);

  const needle = search.trim().toLowerCase();
  const shown = sorted.filter((row) =>
    (status === "all" || statusKey(row) === status)
    && (carrier === "all" || row.carrierName === carrier)
    && (!missingOnly || orphanRule(row) === "reference")
    && (!needle || [row.clientName, row.carrierName, row.reference, row.policyNumber].some((value) => value?.toLowerCase().includes(needle))));
  const { current, rows: pageRows } = paginate(shown, page);
  const panelFilters = (status !== "all" ? 1 : 0) + (missingOnly ? 1 : 0);
  const activeFilters = panelFilters + (carrier !== "all" ? 1 : 0);
  const clearFilters = () => { setSearch(""); setStatus("all"); setCarrier("all"); setMissingOnly(false); setPage(1); };

  const countOf = (s: ApplicationStatus) => rows.filter((row) => row.status === s).length;
  const awaiting = rows.filter((row) => orphanRule(row) !== null);
  const noReference = awaiting.filter((row) => orphanRule(row) === "reference").length;
  const issuedNoNumber = awaiting.length - noReference;
  const weekAgo = now - 7 * 86_400_000;
  const sentThisWeek = rows.filter((row) => row.submittedAt && Date.parse(row.submittedAt) >= weekAgo).length;
  const readyToday = rows.filter((row) => row.status === "ready" && new Date(row.updatedAt).toDateString() === new Date(now).toDateString()).length;

  function exportCsv() {
    downloadCsv("applications.csv",
      ["Client", "Insured", "Carrier", "Product", "Attempt", "Status", "Monthly premium", "QA", "Carrier reference", "Policy number", "Updated"],
      shown.map((row) => [row.clientName, row.insuredRole, row.carrierName, row.productLabel, row.attemptNo, statusView(row).label, row.monthlyPremiumCents === null ? null : formatCents(row.monthlyPremiumCents), row.qaVerdict, row.reference, row.policyNumber, row.updatedAt]));
  }

  const chip = (label: string, onRemove: () => void) => (
    <span key={label} className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-2 text-xs font-semibold text-[var(--body)]">
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={() => { onRemove(); setPage(1); }} className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--body)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
  const chips = [
    status !== "all" ? chip(`Status: ${statusLabel(status).toLowerCase()}`, () => setStatus("all")) : null,
    carrier !== "all" ? chip(`Carrier: ${carrier}`, () => setCarrier("all")) : null,
    missingOnly ? chip("Missing reference", () => setMissingOnly(false)) : null,
  ].filter(Boolean);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Applications"
        description="Every application in flight, and the one thing each is waiting for."
        actions={<>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={shown.length === 0} title={shown.length === 0 ? "Nothing to export" : undefined}><Download aria-hidden="true" />Export</Button>
          <Button asChild title="An application starts from the lead: open it and choose Start application"><Link href="/app/leads"><Plus aria-hidden="true" />New application</Link></Button>
        </>}
      />
      {sample && <SampleDataNotice />}

      <StatStrip label="Application totals">
        <StatTile label="Draft" value={countOf("draft")} footnote="not yet checked" />
        <StatTile label="Ready to submit" value={countOf("ready")} footnote={`${readyToday} QA passed today`} />
        <StatTile label="Submitted" value={countOf("submitted")} footnote={`${sentThisWeek} sent this week`} />
        <StatTile label="Pending carrier" value={countOf("pending_carrier") + countOf("counteroffer_pending")} valueTone={countOf("pending_carrier") + countOf("counteroffer_pending") > 0 ? "warning" : undefined} footnote="waiting on a decision" />
        <StatTile label="Awaiting policy number" value={awaiting.length} valueTone={awaiting.length > 0 ? "danger" : undefined} footnote={noReference ? `${issuedNoNumber} issued · ${noReference} no reference` : "issued, number not back"} />
      </StatStrip>

      <TableCard
        toolbar={<>
          <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search a client, a reference or a policy number" />
            <select aria-label="Carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="all">All carriers</option>
              {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} count={panelFilters} aria-controls="applications-filters" />
          </DataToolbar>
          {filtersOpen && (
            <div id="applications-filters" className="flex w-full flex-wrap items-center gap-4">
              <select aria-label="Status" className={toolbarControl} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="all">All statuses</option>
                {OPEN_STATUSES.map((s) => <option key={s} value={s}>{APPLICATION_STATUS_LABEL[s]}</option>)}
                <optgroup label="Closed">
                  {APPLICATION_OUTCOMES.map((o) => <option key={o} value={`outcome:${o}`}>{APPLICATION_OUTCOME_LABEL[o]}</option>)}
                </optgroup>
              </select>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={missingOnly} onChange={(event) => { setMissingOnly(event.target.checked); setPage(1); }} className="size-4 accent-[var(--primary)]" />Missing carrier reference only</label>
            </div>
          )}
          {activeFilters > 0 && (
            <div className="flex w-full flex-wrap items-center gap-2">
              {chips}
              <Button type="button" variant="ghost" onClick={clearFilters}>Clear filters</Button>
              <span className="text-xs text-muted-foreground">{shown.length} of {rows.length}</span>
            </div>
          )}
          {loadError && <p role="alert" className="w-full text-sm text-destructive">{loadError}</p>}
        </>}
        footer={<Pager page={current} total={shown.length} noun="applications" onPage={setPage} suffix="most recently touched first" />}
      >
        {rows.length === 0
          ? <EmptyState title="No applications yet" hint="An application opens when a client says yes on a call — from the dialer, an inbound transfer or a lead's page." />
          : shown.length === 0
            ? <NoMatches noun="applications" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[1080px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[170px]">Client</th>
                    <th className="w-[146px]">Carrier</th>
                    <th className="w-[140px]">Product</th>
                    <th className="w-[80px]">Attempt</th>
                    <th className="w-[150px]">Status</th>
                    <th className="w-[96px]">Premium</th>
                    <th className="w-[124px]">QA</th>
                    <th className="w-[136px]">Policy #</th>
                    <th className="w-[124px]">Updated</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {pageRows.map((row) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, attempt: row.attemptNo });
                    const s = statusView(row);
                    return (
                      <tr key={`${row.applicationId}-${row.insuredRole}`} className="m-row">
                        <td>
                          <Link href={href} className={clientLinkClass}>{row.clientName}</Link>
                          {row.insuredRole === "spouse" && <span className="block text-xs text-muted-foreground">spouse</span>}
                        </td>
                        <td>{row.carrierName ?? <span className="text-muted-foreground">No carrier yet</span>}</td>
                        <td>{row.productLabel ?? "—"}</td>
                        <td className="tabular-nums">{ordinal(row.attemptNo)}</td>
                        <td><StatusChip tone={s.tone} dot>{s.label}</StatusChip></td>
                        <td className="tabular-nums">{money(row.monthlyPremiumCents)}</td>
                        <td><QaCell row={row} /></td>
                        <td>
                          {row.policyNumber
                            ? <code className="font-mono text-xs tabular-nums">{row.policyNumber}</code>
                            : SUBMITTED_STATUSES.includes(row.status) && !row.reference
                              ? <span className="text-muted-foreground" title="Submitted with no carrier reference yet — it stays on Pending › Awaiting policy number until one is typed in">—</span>
                              : "—"}
                        </td>
                        <td className="tabular-nums">{dayMonthTime(row.updatedAt, timeZone)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
      </TableCard>
    </div>
  );
}
