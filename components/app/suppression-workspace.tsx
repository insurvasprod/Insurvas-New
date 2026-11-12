"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, PhoneOff, Search } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/app/view-tabs";
import { cn } from "@/lib/utils";
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
import type { PhoneListRow, SuppressionFeed, SuppressionOverview } from "@/lib/suppression/overview";
import { DNC_EXEMPTION_BASIS_LABELS, type DncExemption } from "@/lib/suppression/exemptionConstants";
import { SOURCE_LABELS, howYouLearned, listTone } from "@/lib/compliance/suppressionView";
import { TcpaDncExemptions } from "@/components/app/tcpa-dnc-exemptions";
import { TcpaScreeningAudit } from "@/components/app/tcpa-screening-audit";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Field, checkboxControl, control } from "@/components/ui/field";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";
import { useUrlTab } from "@/components/app/reports/reports-slot";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

type Loaded = {
  entries: SuppressionEntry[];
  counts: { internal: number; external: number };
  hasMore: boolean;
  canEdit: boolean;
};

type Check = { phoneDigits: string; suppressed: boolean; listType: string | null; reason: string | null; lists?: PhoneListRow[]; checkedAt?: string; exemption?: DncExemption | null };
type Tab = "list" | "exemptions" | "audit" | "feeds";
const TABS: readonly Tab[] = ["list", "exemptions", "audit", "feeds"];
/**
 * The page's reads, as the app's cache keys them (lib/client/resource-cache.ts): a repeat visit draws the last answer
 * at once and the fresh one replaces it. The unfiltered list is the one kept across a reload.
 */
const suppressionKey = (params: URLSearchParams) => `/api/app/suppression?${params}`;
const SUPPRESSION_KEY = suppressionKey(new URLSearchParams({ limit: "500" }));
const OVERVIEW_KEY = "/api/app/suppression?overview=1";
const EXEMPTED_LISTS = new Set(["federal_dnc", "state_dnc"]);

const th = "bg-[var(--surface-alt)] px-3 py-2 text-left text-xs font-semibold leading-[1.33] whitespace-nowrap text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] whitespace-nowrap text-[var(--body)]";
const first = `${td} font-medium text-foreground`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Aug 2026", as the board dates a suppression. */
const dayMonthYear = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const stamp = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** A number's record: the evidence report already lists everything held for it. */
const evidenceHref = (digits: string) => `/app/evidence-report?phone=${digits}`;
/** A click on a link or a control inside the row is that control's, not the row's. */
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");
const FEED_CHIP: Record<SuppressionFeed["state"], { tone: "good" | "danger" | "neutral"; label: string }> = {
  fresh: { tone: "good", label: "Answering" },
  failing: { tone: "danger", label: "Failing" },
  no_calls: { tone: "neutral", label: "No answer yet" },
};

/**
 * TCPA / DNC (p-app-tcpa): whether a number can be called right now, why, and the lists that
 * decide it.
 *
 * The verdict is `is_phone_suppressed`, the dialer's own function; the per-list rows under it only
 * say where a "no" came from. "Clear" means clear of the lists stored here — the federal registry
 * itself is asked by the DNC vendor at the moment of each dial, which is why feed health is one tab
 * away: a feed that is down refuses the dial rather than guessing.
 *
 * Compliance in one page (2026-10-30): the TCPA / DNC step. Foundation pass (2026-11-03): each tab is its own
 * address (`?tab=`), so the figures are links to them; Suppress a number is a confirm with its fields, because
 * it cannot be undone.
 *
 * Round 7, board 2·A (2026-11-11, docs/la4/mockups-r7/compliance.html §2): the title line holds the four tabs
 * (Suppression list · Exemptions · Screening audit · Feeds, the Feeds count in danger while a feed does not
 * answer); "Can we call this number?" is the Check a number button and its dialog (the same one check, billed as
 * before); one line a number, one chip a row (the list; a litigator is danger), and a row opens the number's
 * evidence report. No notice on the page: a feed problem is the Feeds tab's count and one chip on its tile.
 */
export function SuppressionWorkspace() {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(() => seed<Loaded>(SUPPRESSION_KEY, true)?.data ?? null);
  const [overview, setOverview] = useState<SuppressionOverview | null>(() => seed<SuppressionOverview>(OVERVIEW_KEY)?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listType, setListType] = useState<string>("");
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pathname = usePathname();
  // The tab is kept in the address in place (no server round trip), so a reload or a shared link opens it.
  const { tab, setTab } = useUrlTab<Tab>(TABS, "list");
  const pageSize = useFittingPageSize(480, 41);
  /** The other tabs' sizes for their counts on the title line; null until read (a miss leaves the count off). */
  const [tabCounts, setTabCounts] = useState<{ exemptions: number | null; audit: number | null }>({ exemptions: null, audit: null });

  const [checkOpen, setCheckOpen] = useState(false);
  const [lookup, setLookup] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const lookupInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ phone: string; listType: SuppressionListType; reason: string; source: SuppressionSource }>({
    phone: "",
    listType: "internal",
    reason: "",
    source: "complaint",
  });
  const [confirmed, setConfirmed] = useState(false);

  const listKey = useMemo(() => {
    const params = new URLSearchParams({ limit: "500" });
    if (search.trim()) params.set("search", search.trim());
    if (listType) params.set("listType", listType);
    return suppressionKey(params);
  }, [search, listType]);
  // `fresh` after a change and on Refresh, so the answer is never the one from before it.
  const load = useCallback(async (fresh = false) => {
    setError(null);
    const persist = listKey === SUPPRESSION_KEY;
    let body: Loaded;
    try {
      body = await (fresh ? loadResource<Loaded>(listKey, { persist }) : readResource<Loaded>(listKey, { persist }));
    } catch (failure) {
      // A network failure (a rejected fetch, not a 4xx/5xx) must still end the skeleton with an error.
      setError(failure instanceof Error && "status" in failure ? failure.message : "Could not reach the server. Check your connection and try again.");
      setLoaded(null);
      return;
    }
    setLoaded(body);
    setPage(0);
  }, [listKey]);

  const loadOverview = useCallback(async (fresh = false) => {
    const body = await (fresh ? loadResource<SuppressionOverview>(OVERVIEW_KEY) : readResource<SuppressionOverview>(OVERVIEW_KEY)).catch(() => null);
    if (body) setOverview(body);
  }, []);

  useEffect(() => {
    // A fresh document (a reload) starts from the kept answer as soon as it has hydrated, then asks again.
    const kept = peek<Loaded>(listKey, listKey === SUPPRESSION_KEY)?.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept) setLoaded((current) => current ?? kept);
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load, listKey]);
  useEffect(() => { void (async () => { await Promise.resolve(); await loadOverview(); })(); }, [loadOverview]);
  // The tab counts: one page of one audit row for its total, and the exemptions list. Never the check (it bills).
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all([
        fetch("/api/app/suppression/exemptions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/app/suppression?audit=1&limit=1&page=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([exemptions, audit]) => {
        if (!live) return;
        setTabCounts({
          exemptions: exemptions?.schemaReady && Array.isArray(exemptions.exemptions) ? exemptions.exemptions.length : null,
          audit: typeof audit?.total === "number" ? audit.total : null,
        });
      });
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, []);

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
  const checkAnother = () => { setCheck(null); setLookup(""); lookupInput.current?.focus(); };

  async function add() {
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
      await load(true);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try { await Promise.all([load(true), loadOverview(true)]); } finally { setRefreshing(false); }
  }

  const total = loaded ? loaded.counts.internal + loaded.counts.external : 0;
  const entries = useMemo(() => loaded?.entries ?? [], [loaded]);
  const { current: currentPage, rows: shown } = paginate(entries, page + 1, pageSize);
  const answering = overview?.feeds.filter((feed) => feed.state === "fresh").length ?? 0;
  const notAnswering = overview ? overview.feeds.length - answering : 0;
  const typedDigits = normalizeDigits(form.phone);
  const filtered = Boolean(search || listType);
  const clearFilters = () => { setSearch(""); setListType(""); };

  // A feed problem is one chip on its tile (and the Feeds tab's count), never a notice on the page (owner 2026-11-02).
  const feedChip = !overview ? null
    : overview.dialingBlocked ? <StatusChip tone="danger" title="The dialer refuses every dial until a DNC feed answers.">Dialing refused</StatusChip>
    : overview.feeds.length === 0 ? (overview.demo ? null : <StatusChip tone="danger" title="Dialing is refused until the Insurvas team enables a scrub vendor.">No feed enabled</StatusChip>)
    : notAnswering > 0 ? <StatusChip tone="danger" title="Dials continue only while another DNC vendor answers.">{notAnswering} not answering</StatusChip>
    : null;
  const listed = check?.suppressed ? (LIST_TYPE_LABELS[check.listType as SuppressionListType] ?? check.listType ?? "a list") : null;
  const listedRows = check?.lists?.filter((row) => row.listed) ?? [];

  return (
    <>
      <ComplianceSlot slot="lead">
        <ViewTabs
          label="TCPA views"
          idPrefix="tcpa-view"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "list", label: "Suppression list", count: loaded ? total : null },
            { key: "exemptions", label: "Exemptions", count: tabCounts.exemptions },
            { key: "audit", label: "Screening audit", count: tabCounts.audit },
            // The count is the feeds that do not answer, in danger; none, no count.
            { key: "feeds", label: "Feeds", count: overview ? notAnswering || null : null, tone: "danger" },
          ]}
        />
      </ComplianceSlot>
      {/* "Can we call this number?" is a button and its dialog (r7 2·A); then the one primary. */}
      <ComplianceSlot slot="corner">
        <Button variant="outline" onClick={() => setCheckOpen(true)}><Search aria-hidden="true" />Check a number</Button>
        {loaded?.canEdit ? <Button onClick={() => setOpen(true)}><PhoneOff aria-hidden="true" />Suppress a number</Button> : null}
      </ComplianceSlot>

      {/* The first read only; a search or filter change keeps the page drawn and swaps the rows. */}
      {!loaded && !error ? <TableCard><SectionLoading rows={6} columns={6} label="Loading the suppression list" /></TableCard> : <>

      <StatStrip label="Suppression totals">
        <StatTile label="Suppressed" value={loaded ? total.toLocaleString() : "—"} footnote={loaded ? `${loaded.counts.internal.toLocaleString()} on your own list` : undefined} reserveFootnote href={pathname} />
        <StatTile label="Refused today" value={overview?.refusedLast24h == null ? "—" : overview.refusedLast24h.toLocaleString()} footnote="dials screening refused · 24 h" href={`${pathname}?tab=audit`} />
        <StatTile label="Feeds answering" value={overview ? `${answering} of ${overview.feeds.length}` : "—"} footnote={feedChip ?? (overview?.demo ? "demo screening" : "DNC and litigator feeds")} href={`${pathname}?tab=feeds`} />
      </StatStrip>

      <div role="tabpanel" aria-labelledby={`tcpa-view-${tab}`} className="flex min-w-0 flex-col">
      {tab === "list" && (
        <TableCard
          toolbar={
            <DataToolbar actions={<>
              {filtered && <ClearFiltersButton onClick={clearFilters} />}
              <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={search} onChange={setSearch} placeholder="Search numbers" />
              <select id="tcpa-list-type" aria-label="Filter by list" className={toolbarControl} value={listType} onChange={(event) => setListType(event.target.value)}>
                <option value="">Every list</option>
                {LIST_TYPES.map((type) => <option key={type} value={type}>{LIST_TYPE_LABELS[type]}</option>)}
              </select>
            </DataToolbar>
          }
          footer={loaded && entries.length > 0 ? <Pager page={currentPage} total={entries.length} noun={entries.length === 1 ? "number" : "numbers"} onPage={(next) => setPage(next - 1)} pageSize={pageSize} suffix={loaded.hasMore ? "the most recent 500 — search to narrow it" : filtered ? "matching" : "newest first · a row opens that number's evidence report"} /> : undefined}
        >
          {error ? <ErrorState title="The suppression list did not load" detail={error} action={<Button variant="outline" onClick={() => void load(true)}>Try again</Button>} />
            : !loaded ? <SectionLoading rows={4} columns={6} label="Loading the suppression list" />
            : entries.length === 0 ? (
              filtered
                ? <NoMatches noun="suppressed numbers" onClear={clearFilters} />
                : <EmptyState title="No numbers on this list" hint="Numbers land here when someone asks not to be called, a complaint comes in, or a feed flags them." action={loaded.canEdit ? <Button onClick={() => setOpen(true)}><PhoneOff aria-hidden="true" />Suppress a number</Button> : undefined} />
            ) : (
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead><tr>
                  <th className={th}>Phone number</th>
                  <th className={th}>Name</th>
                  <th className={th}>List</th>
                  <th className={th}>How you learned</th>
                  <th className={th}>Added by</th>
                  <th className={th}>Added</th>
                </tr></thead>
                <tbody>{shown.map((entry) => {
                  const href = evidenceHref(entry.phoneDigits);
                  const how = howYouLearned(entry);
                  return <tr key={`${entry.listType}-${entry.id}`} className="m-row cursor-pointer" onClick={(event) => { if (opensFrom(event)) router.push(href); }}>
                    <td className={`${first} tabular-nums`}><Link href={href} className="outline-none hover:underline focus-visible:underline" title="Open this number's evidence report">{formatPhone(entry.phoneDigits)}</Link></td>
                    <td className={`${td} max-w-[200px] truncate`}>{entry.leadId && entry.leadName ? <Link className="hover:underline" href={`/app/leads/${entry.leadId}`} title={entry.leadName}>{entry.leadName}</Link> : <span className="text-muted-foreground">—</span>}</td>
                    <td className={td}><StatusChip tone={listTone(entry.listType)}>{LIST_TYPE_LABELS[entry.listType] ?? entry.listType}</StatusChip></td>
                    {/* Words, never an id: a complaint opens the complaint; the reason as written is the tooltip. */}
                    <td className={`${td} max-w-[280px] truncate`} title={how.title}>{how.href ? <Link className="hover:underline" href={how.href}>{how.label}</Link> : how.label === "—" ? <span className="text-muted-foreground">—</span> : how.label}</td>
                    {/* The internal list predates the source column, so it may have no one: "—" is the truth. */}
                    <td className={`${td} max-w-[180px] truncate`} title={entry.addedByName ?? undefined}>{entry.addedByName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={`${td} tabular-nums text-muted-foreground`}>{entry.addedAt ? dayMonthYear(entry.addedAt) : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>
            )}
        </TableCard>
      )}

      {/* LA-2.3-3 and LA-2.3-9: the exemptions that clear federal/state DNC, and every screening check. */}
      {tab === "exemptions" && <TcpaDncExemptions pageSize={pageSize} onChanged={() => { if (lookup.trim() && check) void runCheck(); }} />}
      {tab === "audit" && <TcpaScreeningAudit pageSize={pageSize} />}

      {tab === "feeds" && (
        <TableCard
          toolbar={<DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />} />}
          footer={overview && overview.feeds.length > 0 ? <span>{answering} of {overview.feeds.length} {overview.feeds.length === 1 ? "feed" : "feeds"} answering</span> : undefined}
        >
          {!overview ? <SectionLoading rows={3} columns={4} label="Loading feed health" /> : overview.feeds.length === 0 ? (
            <EmptyState title="No feeds listed" hint={overview.demo ? "This environment answers lookups locally." : "No DNC scrub vendor is enabled."} />
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead><tr><th className={th}>Source</th><th className={th}>Type</th><th className={th}>Last good answer</th><th className={th}>Status</th></tr></thead>
              <tbody>{overview.feeds.map((feed) => <tr key={`${feed.type}-${feed.name}`} className="m-row">
                <td className={first}>{feed.name}</td>
                <td className={td}>{feed.typeLabel}</td>
                <td className={`${td} tabular-nums text-muted-foreground`}>{feed.lastSuccessAt ? stamp(feed.lastSuccessAt) : "—"}</td>
                <td className={td}><StatusChip tone={FEED_CHIP[feed.state].tone} title={feed.callsLast24h ? `${feed.callsLast24h.toLocaleString()} calls in 24 h, ${feed.failuresLast24h.toLocaleString()} failed` : undefined}>{FEED_CHIP[feed.state].label}</StatusChip></td>
              </tr>)}</tbody>
            </table>
          )}
        </TableCard>
      )}
      </div>
      </>}

      {/* Check a number (r7 2·1): the same one check as before, asked only on Check; its answer is the dialog's body. */}
      <Dialog open={checkOpen} onOpenChange={(next) => { setCheckOpen(next); if (!next) setCheck(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Can we call this number?</DialogTitle>
            <DialogDescription>The dialer&rsquo;s own answer, from every list stored here.</DialogDescription>
          </DialogHeader>
          <form id="tcpa-check" onSubmit={runCheck}>
            <Field label="Phone number" htmlFor="tcpa-check-phone" required>
              <input id="tcpa-check-phone" ref={lookupInput} autoFocus value={lookup} onChange={(event) => { setLookup(event.target.value); if (check) setCheck(null); }} placeholder="(555) 123-4567" inputMode="tel" className={control} />
            </Field>
          </form>
          {check ? (
            <div aria-live="polite">
              <FactTable rows={[
                ["Answer", <span key="answer" className="flex flex-wrap items-center gap-2">
                  {check.suppressed ? <StatusChip tone="danger">Do not call</StatusChip> : <StatusChip tone="good">Can call</StatusChip>}
                  <span className="text-[var(--body)]">{check.suppressed
                    ? `No — on ${listed}${check.reason ? `: “${check.reason.replace(/[.\s]+$/, "")}”` : ""}. The dialer refuses it.`
                    : check.exemption
                      ? `Yes — no list here blocks it. Federal and state DNC are cleared by a recorded ${DNC_EXEMPTION_BASIS_LABELS[check.exemption.basis].toLowerCase()}${check.exemption.expiresAt ? `, until ${dayMonthYear(check.exemption.expiresAt)}` : ", until revoked"}.`
                      : "Yes — no list here blocks it. The DNC vendor is asked again at the moment of each dial."}</span>
                </span>],
                ["Lists", listedRows.length === 0 ? "On none of your lists" : <span key="lists" className="flex flex-col">{listedRows.map((row) => <span key={row.list}>
                  {LIST_TYPE_LABELS[row.list]}{row.since ? ` · ${dayMonthYear(row.since)}` : ""}{check.exemption && EXEMPTED_LISTS.has(row.list) ? " · exempt" : ""}
                </span>)}</span>],
                ["Record", <Link key="record" href={evidenceHref(check.phoneDigits)} className="hover:underline">Evidence report for {formatPhone(check.phoneDigits)} ›</Link>],
              ]} />
            </div>
          ) : null}
          <DialogFooter className="sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">Checks bill the screening meter</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setCheckOpen(false)}>Close</Button>
              {check
                ? <Button type="button" onClick={checkAnother}>Check another</Button>
                : <Button type="submit" form="tcpa-check" disabled={checking || !lookup.trim()}>{checking ? <><Loader2 className="animate-spin" aria-hidden="true" />Checking…</> : "Check"}</Button>}
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A suppression cannot be undone from the product: a confirm with its fields (foundation pass 2026-11-03). */}
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setConfirmed(false); }}
        onConfirm={() => void add()}
        busy={busy}
        title="Suppress a number"
        description="This cannot be undone from the product, so check the digits before you save."
        confirmLabel={busy ? "Saving…" : "Suppress permanently"}
        cancelLabel="Keep calling it"
        confirmDisabled={!confirmed || !typedDigits || !form.reason.trim()}
        fields={<>
          <Field label="Phone number" htmlFor="suppress-phone" required>
            <input id="suppress-phone" required placeholder="(555) 123-4567" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={control} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="List" htmlFor="suppress-list">
              <select id="suppress-list" className={control} value={form.listType} onChange={(event) => setForm({ ...form, listType: event.target.value as SuppressionListType })}>
                {LIST_TYPES.map((type) => <option key={type} value={type}>{LIST_TYPE_LABELS[type]}</option>)}
              </select>
            </Field>
            <Field label="How you learned" htmlFor="suppress-source">
              <select id="suppress-source" className={control} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as SuppressionSource })}>
                {MANUAL_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source] ?? source}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Reason" htmlFor="suppress-reason" required hint={<>Write what happened, not &ldquo;DNC&rdquo;.</>}>
            <input id="suppress-reason" required maxLength={500} placeholder="Called our office and asked to be removed, 23 Sep" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className={control} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-[var(--body)]">
            <input type="checkbox" className={cn(checkboxControl, "mt-0.5")} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I have checked the number. I understand {typedDigits ? formatPhone(typedDigits) : "this number"} can never be called again.</span>
          </label>
        </>}
      />
    </>
  );
}
