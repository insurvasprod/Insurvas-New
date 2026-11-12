"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/app/view-tabs";
import { EVIDENCE_FILTER_LABEL, EVIDENCE_LABEL, evidenceTime, type EvidenceFilter, type EvidenceLevel } from "@/lib/consent/evidence";
import { EVIDENCE_CHIP, consentDay, consentRecordHref, evidenceChipTone, needsProof } from "@/lib/compliance/consentView";
import { Pager, paginate } from "@/components/ui/pager";
import { formatPhone, normalizeDigits } from "@/lib/suppression/constants";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

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
 *
 * Round 7 (board 3·A, owner 2026-11-11): what is missing is a tab. Leads · Missing proof (`?evidence=no_text`) ·
 * By vendor (`?view=coverage`) on the title line; no notice above the strip, its figures plain and each problem
 * tile's footnote one chip; one line a lead (Lead · Phone · Provider · Consent given · Evidence · Next step) and the
 * row opens the lead's consent record, a lead with no certificate included; the three source toggles are one select.
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
/**
 * The locker's read, as the app's cache keys it (lib/client/resource-cache.ts): a repeat visit draws the last answer
 * at once and the fresh one replaces it. The first page of every lead, unfiltered, is the one kept across a reload.
 */
const consentKey = (query: string) => `/api/app/consent?${query}`;
const isDefaultQuery = (query: string) => {
  const params = new URLSearchParams(query);
  return params.get("evidence") === "every" && params.get("page") === "0" && !params.has("search") && !params.has("sources");
};
type Tab = "leads" | "missing" | "coverage";

const SOURCE_LABEL: Record<Source, string> = { partner: "Partner submitted", vendor: "Vendor list or post", direct: "Direct" };
const FILTERS = Object.keys(EVIDENCE_FILTER_LABEL) as EvidenceFilter[];
const when = (value: string | null) => evidenceTime(value);
// A few in a big locker is "under 0.1%", never "0.0%" beside a count that is not zero.
const pct = (part: number, whole: number) => (!whole ? "—" : part > 0 && (part / whole) * 100 < 0.05 ? "under 0.1%" : `${((part / whole) * 100).toFixed(1)}%`);

/** A vendor's one chip: nearly every lead with a stored copy is done; anything less is waiting on proof. */
function coverageState(value: number | null): { tone: "good" | "warning" | "neutral"; label: string } {
  if (value === null) return { tone: "neutral", label: "Not known" };
  return value >= 95 ? { tone: "good", label: "Full" } : value > 0 ? { tone: "warning", label: "Partial" } : { tone: "warning", label: "No proof" };
}

export function ConsentLockerWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get("evidence") as EvidenceFilter | null;
  const filter: EvidenceFilter = asked && FILTERS.includes(asked) ? asked : "every";
  // Missing proof is the "Consent text missing" filter as a tab of its own; any other filter is the Leads tab, filtered.
  const tab: Tab = params.get("view") === "coverage" ? "coverage" : filter === "no_text" ? "missing" : "leads";
  const go = (next: { view?: Tab; evidence?: EvidenceFilter }) => {
    const query = new URLSearchParams();
    const view = next.view ?? tab;
    if (view === "coverage") query.set("view", "coverage");
    const evidence = next.view === "missing" ? "no_text" : next.view === "leads" ? "every" : next.evidence ?? filter;
    if (evidence !== "every") query.set("evidence", evidence);
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const pageSize = useFittingPageSize(480, 45);
  const [loaded, setLoaded] = useState<Loaded | null>(() => {
    const first = new URLSearchParams({ view: "leads", evidence: filter, page: "0", pageSize: String(pageSize) }).toString();
    return seed<Loaded>(consentKey(first), isDefaultQuery(first))?.data ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // One provider at a time, or every provider (the API takes a list; the select sends one).
  const [source, setSource] = useState<Source | "">("");
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [coveragePage, setCoveragePage] = useState(1);

  const query = useCallback((extra: Record<string, string> = {}) => {
    const search_ = new URLSearchParams({ view: "leads", evidence: filter, page: String(page), pageSize: String(pageSize), ...extra });
    if (search.trim()) search_.set("search", search.trim());
    if (source) search_.set("sources", source);
    return search_.toString();
  }, [filter, page, pageSize, search, source]);

  // `fresh` on Refresh and Try again, so the answer is never a kept one.
  const load = useCallback(async (fresh = false) => {
    setError(null);
    const current = query();
    const persist = isDefaultQuery(current);
    let body: Loaded;
    try {
      body = await (fresh ? loadResource<Loaded>(consentKey(current), { persist }) : readResource<Loaded>(consentKey(current), { persist }));
    } catch (failure) {
      // A network failure (a rejected fetch, not a 4xx/5xx) must still end the skeleton with an error.
      setError(failure instanceof Error && "status" in failure ? failure.message : "Could not reach the server. Check your connection and try again.");
      return;
    }
    setLoaded(body);
  }, [query]);

  // The 250 ms wait is for typing in the search and flicking filters; the page's first read goes at once.
  const firstLoad = useRef(true);
  useEffect(() => {
    // A fresh document (a reload) starts from the kept answer as soon as it has hydrated, then asks again.
    const current = query();
    const kept = peek<Loaded>(consentKey(current), isDefaultQuery(current))?.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept) setLoaded((loadedNow) => loadedNow ?? kept);
    const delay = firstLoad.current ? 0 : 250;
    firstLoad.current = false;
    const timer = setTimeout(() => void load(), delay);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function refresh() {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }

  const tiles = loaded?.tiles;
  const coverage = paginate([...(loaded?.coverage ?? [])].sort((a, b) => (b.claimedPct ?? -1) - (a.claimedPct ?? -1)), coveragePage, pageSize);
  // On Missing proof the tab is the filter, not a filter to clear.
  const filtered = Boolean(search || (filter !== "every" && tab !== "missing") || source);
  const clearFilters = () => { setSearch(""); setSource(""); setPage(0); if (tab !== "missing") go({ evidence: "every" }); };
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
          onChange={(next) => { setPage(0); go({ view: next }); }}
          tabs={[
            { key: "leads", label: "Leads", count: tiles ? tiles.leads : null },
            { key: "missing", label: "Missing proof", count: tiles ? tiles.textMissing : null },
            ...(loaded?.coverageAvailable ? [{ key: "coverage" as const, label: "By vendor", count: loaded.coverage.length }] : []),
          ]}
        />
      </ComplianceSlot>
      {/* Export follows the list's filters; with none set it is the whole locker. The step's one primary. */}
      <ComplianceSlot slot="corner">
        <Button asChild><a href={`/api/app/consent?${exportQuery}`}><Download aria-hidden="true" />Export</a></Button>
      </ComplianceSlot>

      {/* The first read only; a filter or page change keeps the page drawn and swaps the rows. */}
      {!loaded && !error ? <TableCard><SectionLoading rows={6} columns={6} label="Loading consent evidence" /></TableCard> : <>

      {/* Plain figures; a problem tile says so with one chip in its footnote (round 7). */}
      <StatStrip label="Consent evidence totals">
        <StatTile label="Full evidence" value={tiles ? tiles.full.toLocaleString() : "—"} footnote={!tiles ? " " : tiles.leads && tiles.full * 2 < tiles.leads ? <StatusChip tone="warning">{pct(tiles.full, tiles.leads)} of leads</StatusChip> : `${pct(tiles.full, tiles.leads)} of leads`} href={showHref("full")} />
        <StatTile label="Consent text missing" value={tiles ? tiles.textMissing.toLocaleString() : "—"} footnote={tiles && tiles.textMissing > 0 ? <StatusChip tone="warning">Still dialable</StatusChip> : "none flagged"} href={showHref("no_text")} />
        <StatTile label="IP address missing" value={tiles ? tiles.noIp.toLocaleString() : "—"} footnote={tiles && tiles.noIp > 0 ? <StatusChip tone="warning">Still dialable</StatusChip> : "none flagged"} href={showHref("no_ip")} />
      </StatStrip>

      <div role="tabpanel" aria-labelledby={`consent-view-${tab === "coverage" && loaded?.coverageAvailable ? "coverage" : tab === "missing" ? "missing" : "leads"}`} className="flex min-w-0 flex-col">
      {tab !== "coverage" || !loaded?.coverageAvailable ? (
        <TableCard
          toolbar={
            <DataToolbar actions={<>
              {filtered && <ClearFiltersButton onClick={clearFilters} />}
              <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(0); }} placeholder="Search leads or numbers" label="Search leads" />
              {/* One select for who provided the lead (was three toggles beside the Provider column). */}
              <select aria-label="Provider" className={toolbarControl} value={source} onChange={(event) => { setSource(event.target.value as Source | ""); setPage(0); }}>
                <option value="">Every provider</option>
                {(Object.keys(SOURCE_LABEL) as Source[]).map((key) => <option key={key} value={key}>{SOURCE_LABEL[key]}</option>)}
              </select>
            </DataToolbar>
          }
          footer={loaded && loaded.rows.length > 0 ? (
            <Pager page={loaded.page + 1} total={loaded.total} pageSize={loaded.pageSize} noun={loaded.total === 1 ? "lead" : "leads"} onPage={(next) => setPage(next - 1)} />
          ) : undefined}
        >
          {error ? <ErrorState title="The consent locker did not load" detail={error} action={<Button variant="outline" onClick={() => void refresh()}>Try again</Button>} />
            : !loaded ? <SectionLoading rows={5} columns={6} label="Loading consent evidence" />
            : loaded.rows.length === 0 ? (filtered
              ? <NoMatches noun="leads" onClear={clearFilters} />
              : tab === "missing"
                ? <EmptyState title="Every lead has proof" hint="Leads land here when they come in without a consent certificate or text." />
                : <EmptyState title="No leads yet" hint="Evidence arrives with each posted or imported lead." action={<Button variant="outline" asChild><Link href="/app/import">Import leads</Link></Button>} />)
            : <Table className="min-w-[760px]">
                <TableHeader><TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Consent given</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Next step</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loaded.rows.map((row) => {
                    // The row opens the lead's consent record: its best certificate, or the lead itself when it has none.
                    const href = consentRecordHref(row, filter);
                    const day = consentDay(when(row.consentGivenAt));
                    const missing = needsProof(row.level);
                    return (
                      <TableRow key={row.leadId} className="cursor-pointer" onClick={() => router.push(href)}>
                        <TableCell className="max-w-[220px] truncate whitespace-nowrap font-medium text-foreground" title={row.name}>
                          <Link href={`/app/leads/${row.leadId}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>{row.name}</Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{row.phone ? formatPhone(normalizeDigits(row.phone) ?? row.phone) : <span className="text-muted-foreground">—</span>}</TableCell>
                        {/* One value: who provided it. How it was captured is its tooltip. */}
                        <TableCell className="max-w-[200px] truncate whitespace-nowrap" title={row.captured !== "—" ? `${row.providerName} · ${row.captured}` : row.providerName}>{row.providerName}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground" title={row.consentGivenAt ? when(row.consentGivenAt) : undefined}>{day ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap"><span title={EVIDENCE_LABEL[row.level]}><StatusChip tone={evidenceChipTone(row.level)}>{EVIDENCE_CHIP[row.level]}</StatusChip></span></TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Link href={href} onClick={(event) => event.stopPropagation()} className="hover:underline" title={missing ? "Open the consent record to attach the vendor's certificate or our stored copy" : "Open the consent record"}>{missing ? "Add proof ›" : "Open ›"}</Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>}
        </TableCard>
      ) : (
        <TableCard
          toolbar={<DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />} />}
          footer={loaded.coverage.length ? <Pager page={coverage.current} total={loaded.coverage.length} noun={loaded.coverage.length === 1 ? "vendor" : "vendors"} pageSize={pageSize} onPage={setCoveragePage} /> : undefined}
        >
          {loaded.coverage.length === 0 ? <EmptyState title="No vendor coverage yet" hint="No vendor has supplied leads yet." />
            : <Table className="min-w-[560px]">
                <TableHeader><TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right"><span className="inline-flex items-center gap-1">Stored copy<InfoTip label="About stored copy">The share of each vendor&rsquo;s leads with a stored copy of the certificate.</InfoTip></span></TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {coverage.rows.map((vendor) => {
                    const chip = coverageState(vendor.claimedPct);
                    return (
                      <TableRow key={vendor.vendorId}>
                        <TableCell className="max-w-[260px] truncate whitespace-nowrap font-medium text-foreground" title={vendor.vendorName}>{vendor.vendorName}</TableCell>
                        <TableCell className="text-right tabular-nums">{vendor.leads.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{vendor.claimedPct === null ? <span className="text-muted-foreground">—</span> : `${vendor.claimedPct.toFixed(1)}%`}</TableCell>
                        <TableCell className="whitespace-nowrap"><StatusChip tone={chip.tone}>{chip.label}</StatusChip></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>}
        </TableCard>
      )}
      </div>
      </>}
    </>
  );
}
