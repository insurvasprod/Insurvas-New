"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, ShieldCheck } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Meter, StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/app/view-tabs";
import { cn } from "@/lib/utils";
import { CONSENT_STATUS_HINTS, CONSENT_STATUS_LABELS, type ConsentArtefact } from "@/lib/consent/constants";
import { EVIDENCE_FILTER_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE, evidenceTime, keptFor, type EvidenceFilter, type EvidenceLevel } from "@/lib/consent/evidence";
import { Pager } from "@/components/ui/pager";

/**
 * The consent locker by lead (p-app-consent). Every lead, with the best evidence it has — the words,
 * the time, the address it came from, and who provided it — and the leads with none at all, which
 * a list of certificates could never show.
 *
 * Missing evidence is FLAGGED here, not blocked: the dialer still places those calls (LA-2.6's
 * "flag, do not block", kept by the owner on 24 Sep), so nothing on this page says otherwise.
 *
 * 2026-10-06 redesign: the leads and the coverage by vendor are two tabs; the source filter sits in
 * the toolbar as toggles instead of a panel that opened under it; the phone is its own column.
 */
type Row = {
  leadId: string; name: string; phone: string | null; providerName: string; captured: string;
  consentGivenAt: string | null; level: EvidenceLevel; artefactId: string | null; certificateId: string | null; ip: string | null;
};
type Loaded = {
  rows: Row[]; total: number; page: number; pageSize: number;
  tiles: { leads: number; full: number; noIp: number; textMissing: number; oldestCapturedAt: string | null };
  coverage: Array<{ vendorId: string; vendorName: string; leads: number; claimedPct: number | null }>;
  coverageAvailable: boolean;
};
type Record_ = ConsentArtefact & { storedCopy: unknown; storedRef: string | null };
type Source = "partner" | "vendor" | "direct";
type Tab = "leads" | "coverage";

const SOURCE_LABEL: Record<Source, string> = { partner: "Partner submitted", vendor: "Vendor list or post", direct: "Direct" };
const CHIP_TONE: Record<"success" | "warning" | "error", StatusTone> = { success: "good", warning: "warning", error: "danger" };
/** The tab's one card reaches the bottom of the window. */
const FILL = "flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>*:nth-child(2)]:flex-1";
/** The leads card: the server pages 50 at a time, so from lg the card holds the window height and its
    table scrolls inside it under sticky headers, rather than the page scrolling (2026-10-06). */
const LEADS_FILL = "flex flex-col lg:h-[calc(100dvh-var(--top-bar-h)-310px)] [&>*:nth-child(2)]:min-h-0 [&>*:nth-child(2)]:flex-1 [&>*:nth-child(2)]:overflow-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1] [&_thead_th]:bg-card";
const when = (value: string | null) => evidenceTime(value);
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

function coverageTone(value: number | null): MeterTone {
  if (value === null) return "neutral";
  return value >= 95 ? "good" : value >= 70 ? "warning" : "danger";
}

export function ConsentLockerWorkspace() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EvidenceFilter>("every");
  const [sources, setSources] = useState<Source[]>([]);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record_ | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("leads");

  const query = useCallback((extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ view: "leads", evidence: filter, page: String(page), ...extra });
    if (search.trim()) params.set("search", search.trim());
    if (sources.length) params.set("sources", sources.join(","));
    return params.toString();
  }, [filter, page, search, sources]);

  const load = useCallback(async () => {
    setError(null);
    // A network failure (a rejected fetch, not a 4xx/5xx) must still end the skeleton with an error.
    const response = await fetch(`/api/app/consent?${query()}`, { cache: "no-store" }).catch(() => null);
    if (!response) { setError("Could not reach the server. Check your connection and try again."); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load the consent locker"); return; }
    setLoaded(body as Loaded);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function openRecord(id: string) {
    setOpening(id);
    try {
      const response = await fetch(`/api/app/consent?id=${id}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block(body?.error ?? "Could not open that certificate"); return; }
      setOpen(body.record);
    } finally {
      setOpening(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  function toggleSource(source: Source) {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
    setPage(0);
  }

  const tiles = loaded?.tiles;
  const filtered = Boolean(search || filter !== "every" || sources.length);
  const clearFilters = () => { setSearch(""); setFilter("every"); setSources([]); setPage(0); };

  // The first read only; a filter or page change keeps the page drawn and swaps the rows.
  if (!loaded && !error) return <PageLoading />;

  return (
    <div className="m-stagger flex flex-col gap-6 text-[var(--ink)]">
      <PageHeader title="Consent locker" />

      <StatStrip label="Consent evidence totals">
        <StatTile label="Leads with full evidence" value={tiles ? tiles.full.toLocaleString() : "—"} valueTone={tiles && tiles.full > 0 ? "good" : undefined} footnote={tiles ? `${pct(tiles.full, tiles.leads)} of ${tiles.leads.toLocaleString()} leads` : " "} />
        <StatTile label="Consent text missing" value={tiles ? tiles.textMissing.toLocaleString() : "—"} valueTone={tiles && tiles.textMissing > 0 ? "danger" : undefined} footnote="flagged; still dialable" />
        <StatTile label="IP address missing" value={tiles ? tiles.noIp.toLocaleString() : "—"} valueTone={tiles && tiles.noIp > 0 ? "danger" : undefined} footnote="flagged; still dialable" />
        <StatTile label="Oldest record kept" value={tiles?.oldestCapturedAt ? keptFor(tiles.oldestCapturedAt, now) : "—"} footnote={tiles?.oldestCapturedAt ? `captured ${when(tiles.oldestCapturedAt).replace(/, .*$/, "")}` : "no certificates yet"} />
      </StatStrip>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs
          label="Consent locker views"
          idPrefix="consent-view"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "leads", label: "Leads", count: loaded ? loaded.total : null },
            ...(loaded?.coverageAvailable ? [{ key: "coverage" as const, label: "Coverage by vendor", count: loaded.coverage.length }] : []),
          ]}
        />
        {/* Export follows the list's filters; with none set it is the whole locker. */}
        <Button variant="outline" asChild><a href={`/api/app/consent?${query({ format: "csv" })}`}><Download aria-hidden="true" />Export</a></Button>
      </div>

      <div role="tabpanel" aria-labelledby={`consent-view-${tab === "leads" || !loaded?.coverageAvailable ? "leads" : "coverage"}`} className="flex min-w-0 flex-col">
      {tab === "leads" || !loaded?.coverageAvailable ? (
        <TableCard
          className={LEADS_FILL}
          toolbar={
            <DataToolbar actions={<>
              {filtered && <ClearFiltersButton onClick={clearFilters} />}
              <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search name or phone" label="Search leads" />
              <select aria-label="Evidence status" className={toolbarControl} value={filter} onChange={(event) => { setFilter(event.target.value as EvidenceFilter); setPage(0); }}>
                {(Object.keys(EVIDENCE_FILTER_LABEL) as EvidenceFilter[]).map((key) => <option key={key} value={key}>{EVIDENCE_FILTER_LABEL[key]}</option>)}
              </select>
              {/* Sources are toggles, any number on at once; none on is every source. */}
              <span role="group" aria-label="Filter by source" className="inline-flex h-9 max-w-full gap-0.5 overflow-x-auto rounded-md bg-[var(--canvas)] p-0.5">
                {(Object.keys(SOURCE_LABEL) as Source[]).map((source) => (
                  <button
                    key={source}
                    type="button"
                    aria-pressed={sources.includes(source)}
                    onClick={() => toggleSource(source)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md border px-2.5 text-sm font-semibold tracking-[-0.01em]",
                      sources.includes(source) ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {SOURCE_LABEL[source]}
                  </button>
                ))}
              </span>
            </DataToolbar>
          }
          footer={loaded && loaded.rows.length > 0 ? (
            <Pager page={loaded.page + 1} total={loaded.total} pageSize={loaded.pageSize} noun={loaded.total === 1 ? "lead" : "leads"} onPage={(next) => setPage(next - 1)} />
          ) : undefined}
        >
          {error ? <ErrorState title="The consent locker did not load" detail={error} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} />
            : !loaded ? <SectionLoading rows={5} columns={5} label="Loading consent evidence" />
            : loaded.rows.length === 0 ? (filtered
              ? <NoMatches noun="leads" onClear={clearFilters} />
              : <EmptyState title="No leads yet" hint="Evidence arrives with each posted or imported lead." action={<Button variant="outline" asChild><Link href="/app/import">Import leads</Link></Button>} />)
            : <Table className="min-w-[1000px]">
                <TableHeader><TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Consent given</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Open</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loaded.rows.map((row) => (
                    <TableRow key={row.leadId}>
                      <TableCell className="max-w-[220px] truncate font-semibold text-[var(--ink)]" title={row.name}>{row.name}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.phone ?? <span className="text-[var(--muted)]">—</span>}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={row.providerName}>{row.providerName}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{when(row.consentGivenAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.captured}</TableCell>
                      <TableCell><StatusChip tone={CHIP_TONE[EVIDENCE_TONE[row.level]]}>{EVIDENCE_LABEL[row.level]}</StatusChip></TableCell>
                      <TableCell className="text-right">
                        {row.artefactId
                          ? <Button type="button" variant="outline" size="sm" disabled={opening === row.artefactId} onClick={() => void openRecord(row.artefactId!)}>{opening === row.artefactId ? "Opening…" : "Open"}</Button>
                          : <Button variant="outline" size="sm" asChild><Link href={`/app/leads/${row.leadId}`}>Open</Link></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>}
        </TableCard>
      ) : (
        <TableCard
          className={FILL}
          toolbar={<DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />} />}
        >
          {loaded.coverage.length === 0 ? <EmptyState title="No vendor coverage yet" hint="No vendor has supplied leads yet." />
            : <Table className="min-w-[640px]">
                <TableHeader><TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right"><span className="inline-flex items-center gap-1">Stored copy<InfoTip label="About stored copy">The share of each vendor&rsquo;s leads with a stored copy of the certificate.</InfoTip></span></TableHead>
                  <TableHead className="w-[40%]"><span className="sr-only">Coverage</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {[...loaded.coverage].sort((a, b) => (b.claimedPct ?? -1) - (a.claimedPct ?? -1)).map((vendor) => (
                    <TableRow key={vendor.vendorId}>
                      <TableCell className="max-w-[260px] truncate font-semibold text-[var(--ink)]" title={vendor.vendorName}>{vendor.vendorName}</TableCell>
                      <TableCell className="text-right tabular-nums">{vendor.leads.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{vendor.claimedPct === null ? "—" : `${vendor.claimedPct.toFixed(1)}%`}</TableCell>
                      <TableCell>
                        <Meter value={Math.max(0, Math.min(100, vendor.claimedPct ?? 0))} tone={coverageTone(vendor.claimedPct)} label={`${vendor.vendorName}: ${vendor.claimedPct ?? 0}% of ${vendor.leads} leads with a stored copy`} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>}
        </TableCard>
      )}
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.leadName}</DialogTitle>
                <DialogDescription>{open.provider} certificate · {CONSENT_STATUS_LABELS[open.status]}. {CONSENT_STATUS_HINTS[open.status]}</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Certificate id" value={open.certificateId} />
                <Field label="Consent given" value={when(open.consentTimestamp)} />
                <Field label="Captured" value={when(open.capturedAt)} />
                <Field label="Copy claimed" value={open.claimedAt ? when(open.claimedAt) : null} />
                <Field label="IP address" value={open.ip} />
                <Field label="Phone on the lead" value={open.leadPhone} />
                <Field label="Landing page" value={open.landingPage} />
                <Field label="Source URL" value={open.sourceUrl} />
              </dl>
              {open.certificateUrl && (
                <a className="inline-flex items-center gap-1 text-sm underline" href={open.certificateUrl} target="_blank" rel="noreferrer noopener">
                  Open the provider&rsquo;s certificate <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
              {open.hasStoredCopy ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-[var(--success-ink)]" aria-hidden /> Our stored copy</p>
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{JSON.stringify(open.storedCopy ?? { stored_ref: open.storedRef }, null, 2)}</pre>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">There is no stored copy for this certificate. The link above is all that exists, and it is the provider&rsquo;s to expire.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      {/* "Not recorded" rather than a blank cell: a missing IP is a fact about the certificate. */}
      <dd className="break-words">{value || <span className="text-muted-foreground">Not recorded</span>}</dd>
    </div>
  );
}
