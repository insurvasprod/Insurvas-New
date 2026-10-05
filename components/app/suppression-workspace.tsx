"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneOff } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Callout } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { agoLabel } from "@/lib/format/ago";
import {
  LIST_TYPES,
  LIST_TYPE_LABELS,
  MANUAL_SOURCES,
  formatPhone,
  normalizeDigits,
  type SuppressionEntry,
  type SuppressionListType,
  type SuppressionSource,
} from "@/lib/suppression/constants";
import type { PhoneListRow, SuppressionOverview } from "@/lib/suppression/overview";
import { DNC_EXEMPTION_BASIS_LABELS, type DncExemption } from "@/lib/suppression/exemptionConstants";
import { TcpaDncExemptions } from "@/components/app/tcpa-dnc-exemptions";
import { TcpaScreeningAudit } from "@/components/app/tcpa-screening-audit";

type Loaded = {
  entries: SuppressionEntry[];
  counts: { internal: number; external: number };
  hasMore: boolean;
  canEdit: boolean;
};

type Check = { phoneDigits: string; suppressed: boolean; listType: string | null; reason: string | null; lists?: PhoneListRow[]; checkedAt?: string; exemption?: DncExemption | null };
const EXEMPTED_LISTS = new Set(["federal_dnc", "state_dnc"]);

const SOURCE_LABELS: Record<string, string> = {
  disposition: "Agent on a call",
  complaint: "Complaint received",
  manual: "Added by hand",
  vendor: "Compliance vendor",
  import: "Found during an import",
};
const PAGE_SIZE = 25;

const field = "h-9 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Aug 2026", as the board dates a suppression. */
const dayMonthYear = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const stamp = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/**
 * TCPA / DNC (p-app-tcpa): whether a number can be called right now, why, and the lists that
 * decide it.
 *
 * The verdict is `is_phone_suppressed`, the dialer's own function; the per-list rows under it only
 * say where a "no" came from. "Clear" means clear of the lists stored here — the federal registry
 * itself is asked by the DNC vendor at the moment of each dial, which is why the feed health card
 * sits beside the check: a feed that is down refuses the dial rather than guessing.
 */
export function SuppressionWorkspace() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [overview, setOverview] = useState<SuppressionOverview | null>(null);
  const [overviewAt, setOverviewAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listType, setListType] = useState<string>("");
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const [lookup, setLookup] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ phone: string; listType: SuppressionListType; reason: string; source: SuppressionSource }>({
    phone: "",
    listType: "internal",
    reason: "",
    source: "complaint",
  });
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ limit: "500" });
    if (search.trim()) params.set("search", search.trim());
    if (listType) params.set("listType", listType);
    // A network failure (a rejected fetch, not a 4xx/5xx) must still end the skeleton with an error.
    const response = await fetch(`/api/app/suppression?${params}`, { cache: "no-store" }).catch(() => null);
    if (!response) { setError("Could not reach the server. Check your connection and try again."); setLoaded(null); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error ?? "Could not load the suppression list");
      setLoaded(null);
      return;
    }
    setLoaded(body);
    setPage(0);
  }, [search, listType]);

  const loadOverview = useCallback(async () => {
    const response = await fetch("/api/app/suppression?overview=1", { cache: "no-store" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (response?.ok) { setOverview(body as SuppressionOverview); setOverviewAt(Date.now()); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => { void (async () => { await Promise.resolve(); await loadOverview(); })(); }, [loadOverview]);

  async function runCheck(event?: React.FormEvent) {
    event?.preventDefault();
    if (!normalizeDigits(lookup)) { notify.block("That is not a ten-digit US phone number."); return; }
    setChecking(true);
    setCheck(null);
    try {
      const response = await fetch(`/api/app/suppression?check=${encodeURIComponent(lookup)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not check that number");
        return;
      }
      setCheck(body);
    } finally {
      setChecking(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/app/suppression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not suppress that number");
        return;
      }
      notify.done(`${formatPhone(body.result.phoneDigits)} will not be called again.`);
      setOpen(false);
      setForm({ phone: "", listType: "internal", reason: "", source: "complaint" });
      setConfirmed(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try { await Promise.all([load(), loadOverview()]); } finally { setRefreshing(false); }
  }

  const total = loaded ? loaded.counts.internal + loaded.counts.external : 0;
  const entries = useMemo(() => loaded?.entries ?? [], [loaded]);
  const { current: currentPage, rows: shown } = paginate(entries, page + 1, PAGE_SIZE);
  const failing = overview?.feeds.filter((feed) => feed.state === "failing") ?? [];
  const answering = overview?.feeds.filter((feed) => feed.state === "fresh").length ?? 0;
  const typedDigits = normalizeDigits(form.phone);

  // The first read only; a search or filter change keeps the page drawn and swaps the rows.
  if (!loaded && !error) return <PageLoading />;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="TCPA / DNC"
        actions={loaded?.canEdit ? <Button onClick={() => setOpen(true)}><PhoneOff aria-hidden="true" />Suppress a number</Button> : undefined}
      />

      <StatStrip label="Suppression totals">
        <StatTile label="Suppressed" value={loaded ? total.toLocaleString() : "—"} footnote={loaded ? `${loaded.counts.internal.toLocaleString()} on your own list` : undefined} reserveFootnote />
        <StatTile label="Refused today" value={overview?.refusedLast24h == null ? "—" : overview.refusedLast24h.toLocaleString()} valueTone={overview?.refusedLast24h ? "warning" : undefined} footnote="dials screening refused · 24 h" />
        <StatTile label="Feeds answering" value={overview ? `${answering} of ${overview.feeds.length}` : "—"} valueTone={failing.length > 0 ? "danger" : undefined} footnote={failing.length > 0 ? `${failing.length} failing` : overview?.demo ? "demo screening" : "DNC and litigator feeds"} />
      </StatStrip>

      {/* A state someone must act on, one line each: dialing refused, or a feed down. */}
      {overview && (overview.feeds.length === 0
        ? <Callout tone={overview.demo ? "info" : "error"} title={overview.demo ? "Demo screening is on here: DNC and litigator lookups are answered locally." : "No scrub vendor is enabled — dialing is refused until the Insurvas team enables one."} />
        : overview.dialingBlocked ? <Callout tone="error" title="Dialing is refused until a DNC feed recovers." />
        : failing.length > 0 ? <Callout tone="warning" title={`${failing[0].name} is failing${failing[0].lastSuccessAt ? ` — last good answer ${agoLabel(Date.parse(failing[0].lastSuccessAt), overviewAt)}` : ""}. Dials continue only while another DNC vendor answers.`} />
        : overview.demo ? <Callout tone="info" title="Demo screening is on here: the feeds below are listed but do not gate dialing." />
        : null)}

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        {/* The question this screen is opened to answer, above the list it is opened to browse. */}
        <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="tcpa-check-heading">
          <h2 id="tcpa-check-heading" className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Can we call this number?</h2>
          <form onSubmit={runCheck} className="mt-3 flex items-end gap-2">
            <label className="block flex-grow">
              <span className="sr-only">Phone number</span>
              <input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="(555) 123-4567" inputMode="tel" aria-label="Phone number" className={cn(toolbarControl, "w-full")} />
            </label>
            <Button type="submit" disabled={checking || !lookup.trim()}>{checking ? "Checking…" : "Check"}</Button>
          </form>
          {check && (
            <div className="mt-4">
              {check.suppressed ? (
                <Callout tone="error" title={<>No — {formatPhone(check.phoneDigits)} is on {LIST_TYPE_LABELS[check.listType as SuppressionListType] ?? check.listType}{check.reason ? <> &mdash; &ldquo;{check.reason.replace(/[.s]+$/, "")}&rdquo;</> : null}</>} />
              ) : (
                <Callout tone="success" title={<>Yes — no list here blocks {formatPhone(check.phoneDigits)}{check.exemption && <>. Federal and state DNC are cleared by a recorded {DNC_EXEMPTION_BASIS_LABELS[check.exemption.basis].toLowerCase()}{check.exemption.expiresAt ? `, until ${dayMonthYear(check.exemption.expiresAt)}` : ", until revoked"}</>}.</>} />
              )}
              {check.lists && check.lists.length > 0 && (
                <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] table-fixed border-collapse text-left">
                  <thead><tr><th className={th}>List</th><th className={`${th} w-[160px]`}>Result</th><th className={`${th} w-[170px] text-right`}>Checked</th></tr></thead>
                  <tbody>{check.lists.map((row) => <tr key={row.list} className="m-row">
                    <td className={td}>{LIST_TYPE_LABELS[row.list]}</td>
                    <td className={td}>{row.listed && check.exemption && EXEMPTED_LISTS.has(row.list) ? <StatusChip tone="info" dot={false}>Listed · exempt</StatusChip> : row.listed ? <StatusChip tone="danger" dot={false}>Listed</StatusChip> : <StatusChip tone="good" dot={false}>Clear</StatusChip>}</td>
                    <td className={`${td} text-right tabular-nums`} title={row.since ? `On this list since ${dayMonthYear(row.since)}` : undefined}>{row.listed && row.since ? `since ${dayMonthYear(row.since)}` : "just now"}</td>
                  </tr>)}</tbody>
                </table></div>
              )}
            </div>
          )}
        </section>

        <TableCard title="Feed health">
          {!overview ? <SectionLoading rows={3} columns={3} label="Loading feed health" /> : overview.feeds.length === 0 ? (
            <EmptyState title="No feeds listed" hint={overview.demo ? "This environment answers lookups locally." : "No DNC scrub vendor is enabled."} />
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] table-fixed border-collapse text-left">
              <thead><tr><th className={th}>Source</th><th className={`${th} w-[150px]`}>State</th><th className={`${th} w-[150px] text-right`}>Last good answer</th></tr></thead>
              <tbody>{overview.feeds.map((feed) => <tr key={`${feed.type}-${feed.name}`} className="m-row">
                <td className={td}><span className="block text-foreground">{feed.name}</span><span className="block text-xs text-muted-foreground">{feed.typeLabel}</span></td>
                <td className={td}>{feed.state === "fresh" ? <StatusChip tone="good">Answering</StatusChip> : feed.state === "failing" ? <StatusChip tone="danger">Failing</StatusChip> : <StatusChip tone="neutral">No calls yet</StatusChip>}</td>
                <td className={`${td} text-right tabular-nums`}>{feed.lastSuccessAt ? stamp(feed.lastSuccessAt) : "—"}</td>
              </tr>)}</tbody>
            </table></div>
          )}
        </TableCard>
      </div>

      <TableCard
        title="Your suppression list"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search numbers" />
            <select id="tcpa-list-type" aria-label="Filter by list" className={toolbarControl} value={listType} onChange={(event) => setListType(event.target.value)}>
              <option value="">Every list</option>
              {LIST_TYPES.map((type) => <option key={type} value={type}>{LIST_TYPE_LABELS[type]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={loaded && entries.length > 0 ? <Pager page={currentPage} total={entries.length} noun={entries.length === 1 ? "number" : "numbers"} onPage={(next) => setPage(next - 1)} pageSize={PAGE_SIZE} suffix={loaded.hasMore ? "the most recent 500 — search to narrow it" : search || listType ? "matching" : undefined} /> : undefined}
      >
        {error ? <ErrorState title="The suppression list did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
          : !loaded ? <SectionLoading rows={4} columns={5} label="Loading the suppression list" />
          : entries.length === 0 ? (
            search || listType
              ? <NoMatches noun="suppressed numbers" onClear={() => { setSearch(""); setListType(""); }} />
              : <EmptyState title="Nothing is suppressed yet" hint="Numbers land here from a do-not-call disposition, a screening hit, or one you add after a complaint." />
          ) : (
            <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
              <thead><tr>
                <th className={`${th} w-[160px]`}>Phone number</th>
                <th className={`${th} w-[180px]`}>Name</th>
                <th className={th}>How it got here</th>
                <th className={th}>How you learned</th>
                <th className={`${th} w-[120px]`}>Added</th>
              </tr></thead>
              <tbody>{shown.map((entry) => <tr key={`${entry.listType}-${entry.id}`} className="m-row">
                <td className={`${td} font-semibold tabular-nums text-foreground`}>{formatPhone(entry.phoneDigits)}</td>
                <td className={td}>{entry.leadId && entry.leadName ? <a className="text-[var(--accent-ink)] hover:underline" href={`/app/leads/${entry.leadId}`}>{entry.leadName}</a> : "—"}</td>
                <td className={td}>
                  {LIST_TYPE_LABELS[entry.listType] ?? entry.listType}
                  {/* The internal list predates the source column, so it has none. "Not recorded" is
                      the truth; labelling it "manual" would invent provenance. */}
                  <span className="block text-xs text-muted-foreground">{entry.source ? (SOURCE_LABELS[entry.source] ?? entry.source) : "Source not recorded"}{entry.addedByName ? ` · ${entry.addedByName}` : ""}</span>
                </td>
                <td className={td}>{entry.reason || "—"}</td>
                <td className={`${td} tabular-nums`}>{entry.addedAt ? dayMonthYear(entry.addedAt) : "—"}</td>
              </tr>)}</tbody>
            </table>
          )}
      </TableCard>

      {/* LA-2.3-3 and LA-2.3-9: the exemptions that clear federal/state DNC, and every screening check. */}
      <TcpaDncExemptions onChanged={() => { if (lookup.trim() && check) void runCheck(); }} />
      <TcpaScreeningAudit />

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmed(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suppress a number</DialogTitle>
            <DialogDescription>
              This cannot be undone from the product, so check the digits before you save.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={add} className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-[var(--body)]">Phone number</span>
              <input required placeholder="(555) 123-4567" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={field} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-[var(--body)]">List</span>
                <select className={field} value={form.listType} onChange={(event) => setForm({ ...form, listType: event.target.value as SuppressionListType })}>
                  {LIST_TYPES.map((type) => <option key={type} value={type}>{LIST_TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-[var(--body)]">How you learned</span>
                <select className={field} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as SuppressionSource })}>
                  {MANUAL_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source] ?? source}</option>)}
                </select>
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-[var(--body)]">Reason</span>
              <input required maxLength={500} placeholder="Called our office and asked to be removed, 23 Sep" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className={field} />
              <span className="text-xs text-muted-foreground">Write what happened, not &ldquo;DNC&rdquo;.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-[var(--body)]">
              <input type="checkbox" className="mt-1 size-4 accent-primary" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I have checked the number. I understand {typedDigits ? formatPhone(typedDigits) : "this number"} can never be called again.</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !confirmed || !typedDigits}>{busy ? "Saving…" : "Suppress permanently"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
