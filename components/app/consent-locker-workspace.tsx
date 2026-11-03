"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Meter, StatStrip, StatTile, type MeterTone } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { ViewTabs } from "@/components/app/view-tabs";
import { Callout } from "@/components/app/settings/primitives";
import { EVIDENCE_FILTER_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE, evidenceTime, keptFor, type EvidenceFilter, type EvidenceLevel } from "@/lib/consent/evidence";
import { Pager, paginate } from "@/components/ui/pager";
import { formatPhone, normalizeDigits } from "@/lib/suppression/constants";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";

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
 *
 * Compliance in one page (2026-10-30): the Consent step. Its tabs sit on the title line and Export in its
 * corner.
 *
 * Foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md): the tab and the evidence filter are the
 * address (`?view=coverage`, `?evidence=no_text`), so each figure is a link to the leads behind it; the biggest
 * gap goes to the bell; a certificate opens its own page (/app/consent/[id], was a pop-up); a page of leads is
 * as many as fit above the rail's foot, so the card never scrolls inside itself.
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
type Source = "partner" | "vendor" | "direct";
type Tab = "leads" | "coverage";

const SOURCE_LABEL: Record<Source, string> = { partner: "Partner submitted", vendor: "Vendor list or post", direct: "Direct" };
const CHIP_TONE: Record<"success" | "warning" | "error", StatusTone> = { success: "good", warning: "warning", error: "danger" };
const FILTERS = Object.keys(EVIDENCE_FILTER_LABEL) as EvidenceFilter[];
const when = (value: string | null) => evidenceTime(value);
// A few in a big locker is "under 0.1%", never "0.0%" beside a count that is not zero.
const pct = (part: number, whole: number) => (!whole ? "—" : part > 0 && (part / whole) * 100 < 0.05 ? "under 0.1%" : `${((part / whole) * 100).toFixed(1)}%`);

function coverageTone(value: number | null): MeterTone {
  if (value === null) return "neutral";
  return value >= 95 ? "good" : value >= 70 ? "warning" : "danger";
}

export function ConsentLockerWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = params.get("view") === "coverage" ? "coverage" : "leads";
  const asked = params.get("evidence") as EvidenceFilter | null;
  const filter: EvidenceFilter = asked && FILTERS.includes(asked) ? asked : "every";
  const go = (next: { view?: Tab; evidence?: EvidenceFilter }) => {
    const query = new URLSearchParams();
    if ((next.view ?? tab) === "coverage") query.set("view", "coverage");
    const evidence = next.evidence ?? filter;
    if (evidence !== "every") query.set("evidence", evidence);
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [page, setPage] = useState(0);
  const [now] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [coveragePage, setCoveragePage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);

  const query = useCallback((extra: Record<string, string> = {}) => {
    const search_ = new URLSearchParams({ view: "leads", evidence: filter, page: String(page), pageSize: String(pageSize), ...extra });
    if (search.trim()) search_.set("search", search.trim());
    if (sources.length) search_.set("sources", sources.join(","));
    return search_.toString();
  }, [filter, page, pageSize, search, sources]);

  const load = useCallback(async () => {
    setError(null);
    // A network failure (a rejected fetch, not a 4xx/5xx) must still end the skeleton with an error.
    const response = await fetch(`/api/app/consent?${query()}`, { cache: "no-store" }).catch(() => null);
    if (!response) { setError("Could not reach the server. Check your connection and try again."); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load the consent locker"); return; }
    setLoaded(body as Loaded);
  }, [query]);

  // The 250 ms wait is for typing in the search and flicking filters; the page's first read goes at once.
  const firstLoad = useRef(true);
  useEffect(() => {
    const delay = firstLoad.current ? 0 : 250;
    firstLoad.current = false;
    const timer = setTimeout(() => void load(), delay);
    return () => clearTimeout(timer);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  function toggleSource(source: Source) {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
    setPage(0);
  }

  const tiles = loaded?.tiles;
  const coverage = paginate([...(loaded?.coverage ?? [])].sort((a, b) => (b.claimedPct ?? -1) - (a.claimedPct ?? -1)), coveragePage, pageSize);
  const filtered = Boolean(search || filter !== "every" || sources.length);
  const clearFilters = () => { setSearch(""); setSources([]); setPage(0); go({ evidence: "every" }); };
  /** A figure's way into the rows behind it: the Leads tab, filtered to that evidence status. */
  const showHref = (next: EvidenceFilter) => `${pathname}?evidence=${next}`;
  const exportQuery = query({ format: "csv" });

  return (
    <>
      <ComplianceSlot slot="lead">
        <ViewTabs
          label="Consent locker views"
          idPrefix="consent-view"
          value={tab}
          onChange={(next) => go({ view: next })}
          tabs={[
            { key: "leads", label: "Leads", count: loaded ? loaded.total : null },
            ...(loaded?.coverageAvailable ? [{ key: "coverage" as const, label: "Coverage by vendor", count: loaded.coverage.length }] : []),
          ]}
        />
      </ComplianceSlot>
      {/* Export follows the list's filters; with none set it is the whole locker. The step's one primary. */}
      <ComplianceSlot slot="corner">
        <Button asChild><a href={`/api/app/consent?${exportQuery}`}><Download aria-hidden="true" />Export</a></Button>
      </ComplianceSlot>
      {/* The biggest gap goes to the bell (owner 2026-11-02); the figure under it is its link. */}
      {tiles && tiles.textMissing > 0
        ? <Callout tone="warning" title={`${tiles.textMissing.toLocaleString()} ${tiles.textMissing === 1 ? "lead has" : "leads have"} no consent text`}>They stay dialable and flagged — ask the vendor for the certificate.</Callout>
        : tiles && tiles.noIp > 0
          ? <Callout tone="warning" title={`${tiles.noIp.toLocaleString()} ${tiles.noIp === 1 ? "lead's" : "leads'"} consent has no IP address`}>Still dialable and flagged.</Callout>
          : null}

      {/* The first read only; a filter or page change keeps the page drawn and swaps the rows. */}
      {!loaded && !error ? <TableCard><SectionLoading rows={6} columns={5} label="Loading consent evidence" /></TableCard> : <>

      <StatStrip label="Consent evidence totals">
        <StatTile label="Leads with full evidence" value={tiles ? tiles.full.toLocaleString() : "—"} valueTone={tiles && tiles.full > 0 ? "good" : undefined} footnote={tiles ? `${pct(tiles.full, tiles.leads)} of ${tiles.leads.toLocaleString()} leads` : " "} href={showHref("full")} />
        <StatTile label="Consent text missing" value={tiles ? tiles.textMissing.toLocaleString() : "—"} valueTone={tiles && tiles.textMissing > 0 ? "danger" : undefined} footnote="flagged; still dialable" href={showHref("no_text")} />
        <StatTile label="IP address missing" value={tiles ? tiles.noIp.toLocaleString() : "—"} valueTone={tiles && tiles.noIp > 0 ? "danger" : undefined} footnote="flagged; still dialable" href={showHref("no_ip")} />
        <StatTile label="Oldest record kept" value={tiles?.oldestCapturedAt ? keptFor(tiles.oldestCapturedAt, now) : "—"} footnote={tiles?.oldestCapturedAt ? `captured ${when(tiles.oldestCapturedAt).replace(/, .*$/, "")}` : "no certificates yet"} />
      </StatStrip>

      <div role="tabpanel" aria-labelledby={`consent-view-${tab === "leads" || !loaded?.coverageAvailable ? "leads" : "coverage"}`} className="flex min-w-0 flex-col">
      {tab === "leads" || !loaded?.coverageAvailable ? (
        <TableCard
          toolbar={
            <DataToolbar actions={<>
              {filtered && <ClearFiltersButton onClick={clearFilters} />}
              <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search name or phone" label="Search leads" />
              <select aria-label="Evidence status" className={toolbarControl} value={filter} onChange={(event) => { setPage(0); go({ evidence: event.target.value as EvidenceFilter }); }}>
                {FILTERS.map((key) => <option key={key} value={key}>{EVIDENCE_FILTER_LABEL[key]}</option>)}
              </select>
              {/* Sources are toggles, any number on at once; none on is every source. */}
              <span role="group" aria-label="Filter by source" className="inline-flex max-w-full gap-1.5 overflow-x-auto">
                {(Object.keys(SOURCE_LABEL) as Source[]).map((source) => (
                  <ToggleChip key={source} selected={sources.includes(source)} onClick={() => toggleSource(source)} className="shrink-0">
                    {SOURCE_LABEL[source]}
                  </ToggleChip>
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
            : <Table className="min-w-[760px]">
                <TableHeader><TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Consent given</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Open</span></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loaded.rows.map((row) => (
                    <TableRow key={row.leadId}>
                      <TableCell className="max-w-[220px] truncate font-semibold text-[var(--ink)]" title={row.name}>{row.name}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.phone ? formatPhone(normalizeDigits(row.phone) ?? row.phone) : <span className="text-[var(--muted)]">—</span>}</TableCell>
                      {/* How it was captured is the line under who provided it, so the table keeps to the card at 1280. */}
                      <TableCell className="max-w-[180px]"><span className="block truncate" title={row.providerName}>{row.providerName}</span><span className="block truncate text-xs text-muted-foreground">{row.captured}</span></TableCell>
                      {/* The day over the time, so the column stays narrow at 1280. */}
                      <TableCell className="whitespace-nowrap tabular-nums">{(() => { const [date, time] = when(row.consentGivenAt).split(", "); return <>{date}{time ? <span className="block text-xs text-muted-foreground">{time}</span> : null}</>; })()}</TableCell>
                      <TableCell><StatusChip tone={CHIP_TONE[EVIDENCE_TONE[row.level]]}>{EVIDENCE_LABEL[row.level]}</StatusChip></TableCell>
                      <TableCell className="text-right">
                        {/* A certificate is a record of its own; a lead with none opens the lead. */}
                        <Button variant="outline" size="sm" asChild><Link href={row.artefactId ? `/app/consent/${row.artefactId}` : `/app/leads/${row.leadId}`}>Open</Link></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>}
        </TableCard>
      ) : (
        <TableCard
          toolbar={<DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />} />}
          footer={loaded.coverage.length ? <Pager page={coverage.current} total={loaded.coverage.length} noun={loaded.coverage.length === 1 ? "vendor" : "vendors"} pageSize={pageSize} onPage={setCoveragePage} /> : undefined}
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
                  {coverage.rows.map((vendor) => (
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
      </>}
    </>
  );
}
