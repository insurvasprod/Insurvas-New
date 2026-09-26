"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneOff, Search, SlidersHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, LoadingRows } from "@/components/ui/page-states";
import { StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
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

const control = "box-border inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground";
const field = "h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2 Aug 2026", as the board dates a suppression. */
const dayMonthYear = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const stamp = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function Note({ tone, title, children }: { tone: "info" | "warning" | "danger" | "good"; title: string; children: React.ReactNode }) {
  const look = {
    info: "border-l-[var(--info)] bg-[var(--info-surface)] text-[var(--info-ink)]",
    warning: "border-l-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]",
    danger: "border-l-[var(--error)] bg-[var(--error-surface)] text-[var(--error-ink)]",
    good: "border-l-[var(--success)] bg-[var(--success-surface)] text-[var(--success-ink)]",
  }[tone];
  return (
    <div className={`rounded-xl border border-border border-l-[3px] px-4 py-3.5 ${look}`}>
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em]">{title}</p>
      <div className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{children}</div>
    </div>
  );
}

/**
 * TCPA / DNC (p-app-tcpa): whether a number can be called right now, why, and the lists that
 * decide it.
 *
 * The verdict is `is_phone_suppressed`, the dialer's own function; the per-list rows under it only
 * say where a "no" came from. "Clear" means clear of the lists stored here — the federal registry
 * itself is asked by the DNC vendor at the moment of each dial, which is why the feed health card
 * sits beside the check: a feed that is down refuses the dial rather than guessing.
 */
export function SuppressionWorkspace({ eyebrow }: { eyebrow?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [overview, setOverview] = useState<SuppressionOverview | null>(null);
  const [overviewAt, setOverviewAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listType, setListType] = useState<string>("");
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

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
    const response = await fetch(`/api/app/suppression?${params}`, { cache: "no-store" });
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
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointer = (event: MouseEvent) => { if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) setFiltersOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [filtersOpen]);

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

  const total = loaded ? loaded.counts.internal + loaded.counts.external : 0;
  const entries = useMemo(() => loaded?.entries ?? [], [loaded]);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = entries.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const failing = overview?.feeds.filter((feed) => feed.state === "failing") ?? [];
  const typedDigits = normalizeDigits(form.phone);
  const suppressButton = loaded?.canEdit ? <Button className="h-11 px-4" onClick={() => setOpen(true)}><PhoneOff className="size-4" aria-hidden="true" />Suppress a number</Button> : null;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title="TCPA / DNC"
        description="Whether a given number can be called right now, why, and the lists that decide it."
        actions={suppressButton ?? undefined}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        {/* The question this screen is opened to answer, above the list it is opened to browse. */}
        <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="tcpa-check-heading">
          <h2 id="tcpa-check-heading" className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Can we call this number?</h2>
          <p className="mt-1 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">The same check the dialer runs, on demand, against the lists stored here.</p>
          <form onSubmit={runCheck} className="mt-4 flex items-end gap-2.5">
            <label className="block flex-grow">
              <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">Phone number</span>
              <input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="(555) 123-4567" inputMode="tel" className="mt-1.5 box-border h-11 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-base tracking-[-0.02em] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button type="submit" className="h-11 px-4" disabled={checking || !lookup.trim()}>{checking ? "Checking…" : "Check"}</Button>
          </form>
          {check && (
            <div className="mt-[18px]">
              {check.suppressed ? (
                <Note tone="danger" title={`No — ${formatPhone(check.phoneDigits)} is suppressed`}>
                  It is on the list <strong>{LIST_TYPE_LABELS[check.listType as SuppressionListType] ?? check.listType}</strong>{check.reason ? <> &mdash; &ldquo;{check.reason.replace(/[.s]+$/, "")}&rdquo;</> : null}. One list is enough: the dialer refuses it whatever the others say.
                </Note>
              ) : (
                <Note tone="good" title={`Yes — no list here blocks ${formatPhone(check.phoneDigits)}`}>
                  {check.exemption && <>Federal and state DNC are cleared by a recorded {DNC_EXEMPTION_BASIS_LABELS[check.exemption.basis].toLowerCase()}{check.exemption.expiresAt ? `, until ${dayMonthYear(check.exemption.expiresAt)}` : ", until revoked"}. </>}
                  The calling window, the state licence and the DNC vendor&rsquo;s live lookup are still checked at the moment of the dial.
                </Note>
              )}
              {check.lists && check.lists.length > 0 && <>
                <table className="mt-4 w-full table-fixed border-collapse text-left">
                  <thead><tr><th className={th}>List</th><th className={`${th} w-[160px]`}>Result</th><th className={`${th} w-[170px] text-right`}>Checked</th></tr></thead>
                  <tbody>{check.lists.map((row) => <tr key={row.list} className="m-row">
                    <td className={td}>{LIST_TYPE_LABELS[row.list]}</td>
                    <td className={td}>{row.listed && check.exemption && EXEMPTED_LISTS.has(row.list) ? <StatusChip tone="info" dot={false}>Listed · exempt</StatusChip> : row.listed ? <StatusChip tone="danger" dot={false}>Listed</StatusChip> : <StatusChip tone="good" dot={false}>Clear</StatusChip>}</td>
                    <td className={`${td} text-right tabular-nums`} title={row.since ? `On this list since ${dayMonthYear(row.since)}` : undefined}>{row.listed && row.since ? `since ${dayMonthYear(row.since)}` : "just now"}</td>
                  </tr>)}</tbody>
                </table>
                <p className="mt-2 text-xs leading-normal text-muted-foreground">Clear means clear of the lists stored here. The federal registry itself is asked by the DNC vendor when the number is dialled, not from this screen.</p>
              </>}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile label="Suppressed" value={loaded ? total.toLocaleString() : "…"} footnote={loaded ? `${loaded.counts.internal.toLocaleString()} on your own list` : undefined} reserveFootnote />
            <StatTile label="Refused today" value={overview?.refusedLast24h == null ? "—" : overview.refusedLast24h.toLocaleString()} valueTone={overview?.refusedLast24h ? "warning" : undefined} footnote="dials screening refused · 24 h" />
          </div>
          <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="tcpa-feeds-heading">
            <h2 id="tcpa-feeds-heading" className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Feed health</h2>
            <p className="mt-1 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">A failing feed refuses the dial rather than guessing.</p>
            {!overview ? <div className="mt-4"><LoadingRows rows={3} columns={3} /></div> : overview.feeds.length === 0 ? (
              <div className="mt-4"><Note tone={overview.demo ? "info" : "danger"} title={overview.demo ? "Demo screening is on here" : "No scrub vendor is enabled"}>{overview.demo ? "This environment answers DNC and litigator lookups locally, so no real feed is involved. Production uses the platform's scrub vendors." : "Dialing is refused platform-wide until a DNC scrub vendor is enabled by the Insurvas team."}</Note></div>
            ) : <>
              <table className="mt-4 w-full table-fixed border-collapse text-left">
                <thead><tr><th className={th}>Source</th><th className={`${th} w-[150px]`}>State</th><th className={`${th} w-[150px] text-right`}>Last good answer</th></tr></thead>
                <tbody>{overview.feeds.map((feed) => <tr key={`${feed.type}-${feed.name}`} className="m-row">
                  <td className={td}><span className="block text-foreground">{feed.name}</span><span className="block text-xs text-muted-foreground">{feed.typeLabel}</span></td>
                  <td className={td}>{feed.state === "fresh" ? <StatusChip tone="good">Answering</StatusChip> : feed.state === "failing" ? <StatusChip tone="danger">Failing</StatusChip> : <StatusChip tone="neutral">No calls yet</StatusChip>}</td>
                  <td className={`${td} text-right tabular-nums`}>{feed.lastSuccessAt ? stamp(feed.lastSuccessAt) : "—"}</td>
                </tr>)}</tbody>
              </table>
              {overview.dialingBlocked ? (
                <div className="mt-4"><Note tone="danger" title="Dialing is refused until a DNC feed recovers">No DNC scrub vendor is answering, so every dial is refused rather than placed unchecked. That is the correct outcome and an expensive one.</Note></div>
              ) : failing.length > 0 ? (
                <div className="mt-4"><Note tone="warning" title={`${failing[0].name} is failing${failing[0].lastSuccessAt ? ` — last good answer ${agoLabel(Date.parse(failing[0].lastSuccessAt), overviewAt)}` : ""}`}>Every call to it in the last 24 hours failed. Dials continue only while another DNC vendor answers; if none does, the dialer refuses rather than guesses.</Note></div>
              ) : overview.demo ? (
                <div className="mt-4"><Note tone="info" title="Demo screening is on here">This environment answers lookups locally; the feeds above are listed but are not what gates dialing here.</Note></div>
              ) : null}
            </>}
          </section>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="tcpa-list-heading">
        <div className="relative z-30 flex flex-wrap items-center gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
          <h2 id="tcpa-list-heading" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">Your suppression list</h2>
          <span className="flex-grow" />
          <span className="box-border flex h-10 w-full items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3 text-muted-foreground sm:w-[248px]">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input type="search" aria-label="Search numbers" placeholder="Search numbers" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-grow border-0 bg-transparent text-sm tracking-[-0.02em] text-foreground outline-none" />
          </span>
          <div className="relative" ref={filtersRef}>
            <button type="button" className={control} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />Filters
              {listType && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1.5 text-xs font-semibold tabular-nums text-foreground">1</span>}
            </button>
            {filtersOpen && <div className="absolute right-0 top-[calc(100%+6px)] z-20 grid w-[240px] gap-2 rounded-xl border border-border bg-card p-3.5 shadow-[0_12px_32px_rgba(0,0,0,.16)]" role="group" aria-label="Filter the list">
              <label htmlFor="tcpa-list-type" className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">List</label>
              <select id="tcpa-list-type" className={`${field} h-9`} value={listType} onChange={(event) => setListType(event.target.value)}>
                <option value="">Every list</option>
                {LIST_TYPES.map((type) => <option key={type} value={type}>{LIST_TYPE_LABELS[type]}</option>)}
              </select>
            </div>}
          </div>
          {loaded?.canEdit && <Button variant="outline" className="h-10 border-[var(--border-strong)] px-4" onClick={() => setOpen(true)}>Suppress a number</Button>}
        </div>
        {error ? <ErrorState title="The suppression list did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
          : !loaded ? <LoadingRows rows={4} columns={5} />
          : entries.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm leading-normal text-muted-foreground">{search || listType ? "No suppressed number matches this search or list." : "Nothing is suppressed yet. Numbers land here when an agent dispositions a call as do-not-call, when screening flags one, or when you add one after a complaint."}</p>
          ) : <>
            <div className="overflow-x-auto">
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
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs leading-normal text-muted-foreground">
              <span>Showing {currentPage * PAGE_SIZE + 1}&ndash;{currentPage * PAGE_SIZE + shown.length} of {search || listType ? `${entries.length}${loaded.hasMore ? "+" : ""} matching` : total.toLocaleString()} number{total === 1 ? "" : "s"}{loaded.hasMore ? " · the most recent 500 are listed — search to narrow it" : ""}</span>
              <span className="flex gap-2">
                <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
              </span>
            </div>
          </>}
      </section>

      {/* LA-2.3-3 and LA-2.3-9: the exemptions that clear federal/state DNC, and every screening check. */}
      <TcpaDncExemptions onChanged={() => { if (lookup.trim() && check) void runCheck(); }} />
      <TcpaScreeningAudit />

      <Note tone="info" title="Suppression is yours, and it is permanent">
        A number on any list is refused at the dialer. Nothing here removes one: the database refuses deletion and deactivation on purpose, so a mistaken entry takes a support request and a migration to undo. That is the right friction for a do-not-call, and the reason Suppress a number asks you to check the digits first.
      </Note>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmed(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suppress a number</DialogTitle>
            <DialogDescription>
              This cannot be undone from the product. Removing a suppressed number takes a database migration, on
              purpose — so check the digits before you save.
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
              <span className="text-xs text-muted-foreground">This is the record if the suppression is ever questioned. Write what happened, not &ldquo;DNC&rdquo;.</span>
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
