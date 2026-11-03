"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, PhoneOff, Search, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/app/view-tabs";
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
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Field, checkboxControl, control } from "@/components/ui/field";
import { Callout } from "@/components/app/settings/primitives";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";
import { useUrlTab } from "@/components/app/reports/reports-slot";

type Loaded = {
  entries: SuppressionEntry[];
  counts: { internal: number; external: number };
  hasMore: boolean;
  canEdit: boolean;
};

type Check = { phoneDigits: string; suppressed: boolean; listType: string | null; reason: string | null; lists?: PhoneListRow[]; checkedAt?: string; exemption?: DncExemption | null };
type Tab = "list" | "exemptions" | "audit" | "feeds";
const TABS: readonly Tab[] = ["list", "exemptions", "audit", "feeds"];
const EXEMPTED_LISTS = new Set(["federal_dnc", "state_dnc"]);

const SOURCE_LABELS: Record<string, string> = {
  disposition: "Agent on a call",
  complaint: "Complaint received",
  manual: "Added by hand",
  vendor: "Compliance vendor",
  import: "Found during an import",
};

const th = "bg-[var(--surface-alt)] px-3 py-2 text-left text-xs font-semibold leading-[1.33] whitespace-nowrap text-muted-foreground";
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
 * itself is asked by the DNC vendor at the moment of each dial, which is why feed health is one tab
 * away: a feed that is down refuses the dial rather than guessing.
 *
 * Compliance in one page (2026-10-30): the TCPA / DNC step. Its tabs sit on the title line and the check and
 * Suppress a number in its corner, so both are one click from every tab.
 *
 * Foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md): each tab is its own address (`?tab=`), so
 * the figures are links to them; a feed problem goes to the bell (Callout), never a line on the page; the
 * check's answer is the result asked for, not a notice — a card of its own, titled with the number and its
 * verdict (a Callout there went to the bell and left the Yes/No off the page); Suppress a number is a confirm
 * with its fields, because it cannot be undone. The cards fill to the rail's foot by themselves (§6b).
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
  const pathname = usePathname();
  // The tab is kept in the address in place (no server round trip), so a reload or a shared link opens it.
  const { tab, setTab } = useUrlTab<Tab>(TABS, "list");
  const pageSize = useFittingPageSize(480, 41);

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
  const { current: currentPage, rows: shown } = paginate(entries, page + 1, pageSize);
  const failing = overview?.feeds.filter((feed) => feed.state === "failing") ?? [];
  const answering = overview?.feeds.filter((feed) => feed.state === "fresh").length ?? 0;
  const typedDigits = normalizeDigits(form.phone);
  const filtered = Boolean(search || listType);
  const clearFilters = () => { setSearch(""); setListType(""); };

  // A state someone must act on goes to the bell (owner 2026-11-02): dialing refused, a feed down, demo screening.
  const feedNotice = !overview ? null
    : overview.feeds.length === 0
      ? <Callout tone={overview.demo ? "warning" : "error"} title={overview.demo ? "Demo screening is on here" : "No scrub vendor is enabled"}>{overview.demo ? "DNC and litigator lookups are answered locally." : "Dialing is refused until the Insurvas team enables one."}</Callout>
      : overview.dialingBlocked ? <Callout tone="error" title="Dialing is refused until a DNC feed recovers">See Feed health on TCPA / DNC.</Callout>
      : failing.length > 0 ? <Callout tone="warning" title={`${failing[0].name} is failing`}>{failing[0].lastSuccessAt ? `Last good answer ${agoLabel(Date.parse(failing[0].lastSuccessAt), overviewAt)}. ` : ""}Dials continue only while another DNC vendor answers.</Callout>
      : overview.demo ? <Callout tone="warning" title="Demo screening is on here">The feeds are listed but do not gate dialing.</Callout>
      : null;
  const listed = check?.suppressed ? (LIST_TYPE_LABELS[check.listType as SuppressionListType] ?? check.listType ?? "a list") : null;

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
            { key: "exemptions", label: "DNC exemptions" },
            { key: "audit", label: "Screening audit" },
            { key: "feeds", label: "Feed health", count: overview ? failing.length || null : null, tone: "danger" },
          ]}
        />
      </ComplianceSlot>
      {/* "Can we call this number?" — the question this screen is opened to answer — then the one primary. */}
      <ComplianceSlot slot="corner">
        {/* One field with its Check inside, so the four tabs keep the row at 1440px. */}
        <form onSubmit={runCheck} className="relative flex items-center" aria-label="Can we call this number?">
          <label className="block">
            <span className="sr-only">Phone number</span>
            <input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="Can we call (555) 123-4567?" inputMode="tel" aria-label="Phone number" className={cn(toolbarControl, "w-56 pr-10")} />
          </label>
          <Button type="submit" variant="ghost" size="icon" aria-label={checking ? "Checking" : "Check"} title="Check" disabled={checking || !lookup.trim()} className="absolute right-0.5 size-8">
            {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          </Button>
        </form>
        {loaded?.canEdit ? <Button onClick={() => setOpen(true)}><PhoneOff aria-hidden="true" />Suppress a number</Button> : null}
      </ComplianceSlot>
      {feedNotice}

      {/* The first read only; a search or filter change keeps the page drawn and swaps the rows. */}
      {!loaded && !error ? <TableCard><SectionLoading rows={6} columns={5} label="Loading the suppression list" /></TableCard> : <>

      {/* The answer to "Can we call this number?": the number, its verdict and the lists that decided it, until it
          is closed. Recording an exemption re-runs it. */}
      {check ? (
        <TableCard
          title={formatPhone(check.phoneDigits)}
          description={check.suppressed
            ? `No — on ${listed}${check.reason ? `: “${check.reason.replace(/[.\s]+$/, "")}”` : ""}. The dialer refuses it.`
            : check.exemption
              ? `Yes — no list here blocks it. Federal and state DNC are cleared by a recorded ${DNC_EXEMPTION_BASIS_LABELS[check.exemption.basis].toLowerCase()}${check.exemption.expiresAt ? `, until ${dayMonthYear(check.exemption.expiresAt)}` : ", until revoked"}.`
              : "Yes — no list here blocks it. The DNC vendor is asked again at the moment of each dial."}
          action={<span className="flex items-center gap-2" aria-live="polite">
            {check.suppressed ? <StatusChip tone="danger">Do not call</StatusChip> : <StatusChip tone="good">Can call</StatusChip>}
            <Button type="button" variant="ghost" size="icon" aria-label="Close the answer" onClick={() => setCheck(null)}><X aria-hidden="true" /></Button>
          </span>}
        >
          {check.lists && check.lists.length > 0 ? (
            <table className="w-full border-collapse text-left">
              <thead><tr><th className={th}>List</th><th className={th}>Result</th><th className={`${th} text-right`}>Checked</th></tr></thead>
              <tbody>{check.lists.map((row) => <tr key={row.list} className="m-row">
                <td className={td}>{LIST_TYPE_LABELS[row.list]}</td>
                <td className={td}>{row.listed && check.exemption && EXEMPTED_LISTS.has(row.list) ? <StatusChip tone="info" dot={false}>Listed · exempt</StatusChip> : row.listed ? <StatusChip tone="danger" dot={false}>Listed</StatusChip> : <StatusChip tone="good" dot={false}>Clear</StatusChip>}</td>
                <td className={`${td} text-right tabular-nums`} title={row.since ? `On this list since ${dayMonthYear(row.since)}` : undefined}>{row.listed && row.since ? `since ${dayMonthYear(row.since)}` : "just now"}</td>
              </tr>)}</tbody>
            </table>
          ) : null}
        </TableCard>
      ) : null}

      <StatStrip label="Suppression totals">
        <StatTile label="Suppressed" value={loaded ? total.toLocaleString() : "—"} footnote={loaded ? `${loaded.counts.internal.toLocaleString()} on your own list` : undefined} reserveFootnote href={pathname} />
        <StatTile label="Refused today" value={overview?.refusedLast24h == null ? "—" : overview.refusedLast24h.toLocaleString()} valueTone={overview?.refusedLast24h ? "warning" : undefined} footnote="dials screening refused · 24 h" href={`${pathname}?tab=audit`} />
        <StatTile label="Feeds answering" value={overview ? `${answering} of ${overview.feeds.length}` : "—"} valueTone={failing.length > 0 ? "danger" : undefined} footnote={failing.length > 0 ? `${failing.length} failing` : overview?.demo ? "demo screening" : "DNC and litigator feeds"} href={`${pathname}?tab=feeds`} />
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
          footer={loaded && entries.length > 0 ? <Pager page={currentPage} total={entries.length} noun={entries.length === 1 ? "number" : "numbers"} onPage={(next) => setPage(next - 1)} pageSize={pageSize} suffix={loaded.hasMore ? "the most recent 500 — search to narrow it" : filtered ? "matching" : undefined} /> : undefined}
        >
          {error ? <ErrorState title="The suppression list did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
            : !loaded ? <SectionLoading rows={4} columns={5} label="Loading the suppression list" />
            : entries.length === 0 ? (
              filtered
                ? <NoMatches noun="suppressed numbers" onClear={clearFilters} />
                : <EmptyState title="Nothing is suppressed yet" hint="DNC dispositions, screening hits and complaints land here." action={loaded.canEdit ? <Button onClick={() => setOpen(true)}><PhoneOff aria-hidden="true" />Suppress a number</Button> : undefined} />
            ) : (
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead><tr>
                  <th className={th}>Phone number</th>
                  <th className={th}>Name</th>
                  <th className={th}>List</th>
                  <th className={th}>Source</th>
                  <th className={th}>How you learned</th>
                  <th className={`${th} text-right`}>Added</th>
                </tr></thead>
                <tbody>{shown.map((entry) => <tr key={`${entry.listType}-${entry.id}`} className="m-row">
                  <td className={`${td} whitespace-nowrap font-semibold tabular-nums text-foreground`}>{formatPhone(entry.phoneDigits)}</td>
                  <td className={`${td} max-w-[200px] truncate`}>{entry.leadId && entry.leadName ? <a className="text-[var(--accent-ink)] hover:underline" href={`/app/leads/${entry.leadId}`} title={entry.leadName}>{entry.leadName}</a> : "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>{LIST_TYPE_LABELS[entry.listType] ?? entry.listType}</td>
                  {/* The internal list predates the source column, so it has none. "Not recorded" is
                      the truth; labelling it "manual" would invent provenance. Who added it is the line under. */}
                  <td className={`${td} whitespace-nowrap`}>
                    {entry.source ? (SOURCE_LABELS[entry.source] ?? entry.source) : <span className="text-muted-foreground">Source not recorded</span>}
                    {entry.addedByName ? <span className="block max-w-[180px] truncate text-xs text-muted-foreground" title={entry.addedByName}>by {entry.addedByName}</span> : null}
                  </td>
                  {/* The reason is the record of why this number may never be called: it wraps rather than truncates. */}
                  <td className={`${td} min-w-[200px]`}><span className="line-clamp-2" title={entry.reason || undefined}>{entry.reason || "—"}</span></td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{entry.addedAt ? dayMonthYear(entry.addedAt) : "—"}</td>
                </tr>)}</tbody>
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
          footer={overview && overview.feeds.length > 0 ? <span>{answering} of {overview.feeds.length} {overview.feeds.length === 1 ? "feed" : "feeds"} answering{failing.length ? ` · ${failing.length} failing` : ""}</span> : undefined}
        >
          {!overview ? <SectionLoading rows={3} columns={4} label="Loading feed health" /> : overview.feeds.length === 0 ? (
            <EmptyState title="No feeds listed" hint={overview.demo ? "This environment answers lookups locally." : "No DNC scrub vendor is enabled."} />
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead><tr><th className={th}>Source</th><th className={th}>Type</th><th className={th}>State</th><th className={`${th} text-right`}>Last good answer</th></tr></thead>
              <tbody>{overview.feeds.map((feed) => <tr key={`${feed.type}-${feed.name}`} className="m-row">
                <td className={`${td} font-semibold text-foreground`}>{feed.name}</td>
                <td className={td}>{feed.typeLabel}</td>
                <td className={td}>{feed.state === "fresh" ? <StatusChip tone="good">Answering</StatusChip> : feed.state === "failing" ? <StatusChip tone="danger">Failing</StatusChip> : <StatusChip tone="neutral">No calls yet</StatusChip>}</td>
                <td className={`${td} text-right tabular-nums`}>{feed.lastSuccessAt ? stamp(feed.lastSuccessAt) : "—"}</td>
              </tr>)}</tbody>
            </table>
          )}
        </TableCard>
      )}
      </div>
      </>}

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
