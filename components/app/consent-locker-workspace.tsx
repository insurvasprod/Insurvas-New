"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONSENT_STATUS_HINTS, CONSENT_STATUS_LABELS, type ConsentArtefact } from "@/lib/consent/constants";
import { EVIDENCE_FILTER_LABEL, EVIDENCE_LABEL, EVIDENCE_TONE, evidenceTime, keptFor, type EvidenceFilter, type EvidenceLevel } from "@/lib/consent/evidence";

/**
 * The consent locker by lead (p-app-consent). Every lead, with the best evidence it has — the words,
 * the time, the address it came from, and who provided it — and the leads with none at all, which
 * a list of certificates could never show.
 *
 * Missing evidence is FLAGGED here, not blocked: the dialer still places those calls (LA-2.6's
 * "flag, do not block", kept by the owner on 24 Sep), so nothing on this page says otherwise.
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

const SOURCE_LABEL: Record<Source, string> = { partner: "Partner submitted", vendor: "Vendor list or post", direct: "Direct" };
const when = (value: string | null) => evidenceTime(value);
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

function coverageTone(value: number | null) {
  if (value === null) return "neutral";
  return value >= 95 ? "success" : value >= 70 ? "warning" : "error";
}

export function ConsentLockerWorkspace() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EvidenceFilter>("every");
  const [sources, setSources] = useState<Source[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record_ | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const query = useCallback((extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ view: "leads", evidence: filter, page: String(page), ...extra });
    if (search.trim()) params.set("search", search.trim());
    if (sources.length) params.set("sources", sources.join(","));
    return params.toString();
  }, [filter, page, search, sources]);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/app/consent?${query()}`, { cache: "no-store" });
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

  function toggleSource(source: Source) {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
    setPage(0);
  }

  const tiles = loaded?.tiles;
  const incomplete = tiles ? tiles.textMissing + tiles.noIp : 0;
  const first = loaded ? loaded.page * loaded.pageSize + 1 : 0;
  const last = loaded ? loaded.page * loaded.pageSize + loaded.rows.length : 0;
  const lastPage = loaded ? Math.max(0, Math.ceil(loaded.total / loaded.pageSize) - 1) : 0;

  return (
    <div className="portal-consent-view">
      <div className="portal-consent-tiles">
        <StatTile label="Leads with full evidence" value={tiles ? tiles.full.toLocaleString() : "—"} valueTone={tiles && tiles.full > 0 ? "good" : undefined} footnote={tiles ? `${pct(tiles.full, tiles.leads)} of ${tiles.leads.toLocaleString()} leads` : " "} />
        <StatTile label="Consent text missing" value={tiles ? tiles.textMissing.toLocaleString() : "—"} valueTone={tiles && tiles.textMissing > 0 ? "danger" : undefined} footnote="flagged; still dialable" />
        <StatTile label="IP address missing" value={tiles ? tiles.noIp.toLocaleString() : "—"} valueTone={tiles && tiles.noIp > 0 ? "danger" : undefined} footnote="flagged; still dialable" />
        <StatTile label="Oldest record kept" value={tiles?.oldestCapturedAt ? keptFor(tiles.oldestCapturedAt, now) : "—"} footnote={tiles?.oldestCapturedAt ? `captured ${when(tiles.oldestCapturedAt).replace(/, .*$/, "")}` : "no certificates yet"} />
      </div>

      <div className="portal-consent-bar">
        <select aria-label="Evidence status" value={filter} onChange={(event) => { setFilter(event.target.value as EvidenceFilter); setPage(0); }}>
          {(Object.keys(EVIDENCE_FILTER_LABEL) as EvidenceFilter[]).map((key) => <option key={key} value={key}>{EVIDENCE_FILTER_LABEL[key]}</option>)}
        </select>
        <label className="portal-consent-search"><Search className="size-4" aria-hidden="true" /><input type="search" aria-label="Search leads" placeholder="Search name or phone" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
        <div className="portal-consent-filters">
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal className="size-4" aria-hidden="true" />Filters{sources.length > 0 && <span className="portal-consent-count">{sources.length}</span>}</button>
          {filtersOpen && <div className="portal-consent-filter-panel" role="group" aria-label="Filter by source">
            <span>Source</span>
            {(Object.keys(SOURCE_LABEL) as Source[]).map((source) => <label key={source} className="portal-remember-me"><input type="checkbox" checked={sources.includes(source)} onChange={() => toggleSource(source)} />{SOURCE_LABEL[source]}</label>)}
            {sources.length > 0 && <button type="button" className="portal-consent-clear" onClick={() => { setSources([]); setPage(0); }}>Clear filters</button>}
          </div>}
        </div>
        <span className="portal-consent-bar-spacer" />
        <Button variant="outline" asChild><a href={`/api/app/consent?${query({ format: "csv" })}`}>Export</a></Button>
        {tiles && <span className="portal-consent-complete">{tiles.full.toLocaleString()} of {tiles.leads.toLocaleString()} complete</span>}
      </div>

      <section className="portal-consent-panel" aria-label="Leads and their consent evidence">
        {error ? <p className="portal-consent-empty is-error" role="alert">{error}</p>
          : !loaded ? <p className="portal-consent-empty" role="status">Loading consent evidence…</p>
          : loaded.rows.length === 0 ? <p className="portal-consent-empty">{search || filter !== "every" || sources.length ? "No leads match these filters." : "No leads yet. Evidence arrives with each posted or imported lead."}</p>
          : <>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="w-[200px]">Provider</TableHead>
                <TableHead className="w-[190px]">Consent given</TableHead>
                <TableHead className="w-[150px]">Captured</TableHead>
                <TableHead className="w-[230px]">Evidence</TableHead>
                <TableHead className="w-[110px] text-right"><span className="sr-only">Open</span></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loaded.rows.map((row) => (
                  <TableRow key={row.leadId}>
                    <TableCell><strong className="portal-consent-name">{row.name}</strong>{row.phone && <small className="portal-consent-sub">{row.phone}</small>}</TableCell>
                    <TableCell>{row.providerName}</TableCell>
                    <TableCell className="tabular-nums">{when(row.consentGivenAt)}</TableCell>
                    <TableCell>{row.captured}</TableCell>
                    <TableCell><span className={`portal-status-chip is-${EVIDENCE_TONE[row.level]}`}><span aria-hidden="true" />{EVIDENCE_LABEL[row.level]}</span></TableCell>
                    <TableCell className="text-right">
                      {row.artefactId
                        ? <Button type="button" variant="ghost" size="sm" disabled={opening === row.artefactId} onClick={() => void openRecord(row.artefactId!)}>{opening === row.artefactId ? "Opening…" : "Open"}</Button>
                        : <Button variant="ghost" size="sm" asChild><Link href={`/app/leads/${row.leadId}`}>Open</Link></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="portal-consent-pager">
              <span>Showing {first.toLocaleString()}&ndash;{last.toLocaleString()} of {loaded.total.toLocaleString()} lead{loaded.total === 1 ? "" : "s"}</span>
              <span>
                <Button type="button" variant="outline" size="sm" disabled={loaded.page === 0} onClick={() => setPage(loaded.page - 1)}>Previous</Button>
                <Button type="button" variant="outline" size="sm" disabled={loaded.page >= lastPage} onClick={() => setPage(loaded.page + 1)}>Next</Button>
              </span>
            </div>
          </>}
      </section>

      <div className="portal-consent-lower">
        <section className="portal-consent-panel is-roomy" aria-labelledby="consent-coverage-heading">
          <h2 id="consent-coverage-heading">Coverage by vendor</h2>
          <p className="portal-consent-lede">A vendor whose bar is short is selling leads without the evidence to defend a call.</p>
          {!loaded ? <p className="portal-consent-lede" role="status">Loading…</p>
            : !loaded.coverageAvailable ? <p className="portal-consent-lede">Per-vendor coverage is unavailable on this deployment; the leads above are unaffected.</p>
            : loaded.coverage.length === 0 ? <p className="portal-consent-lede">No vendor has supplied leads yet.</p>
            : <div className="portal-consent-bars">
              {[...loaded.coverage].sort((a, b) => (b.claimedPct ?? -1) - (a.claimedPct ?? -1)).map((vendor) => (
                <div key={vendor.vendorId}>
                  <div className="portal-consent-bar-label"><span>{vendor.vendorName}</span><span>{vendor.claimedPct === null ? "—" : `${vendor.claimedPct.toFixed(1)}%`}</span></div>
                  <span className="portal-consent-meter" role="meter" aria-label={`${vendor.vendorName}: ${vendor.claimedPct ?? 0}% of ${vendor.leads} leads with a stored copy`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={vendor.claimedPct ?? 0}>
                    <span className={`is-${coverageTone(vendor.claimedPct)}`} style={{ width: `${Math.max(0, Math.min(100, vendor.claimedPct ?? 0))}%` }} />
                  </span>
                </div>
              ))}
            </div>}
        </section>
        <div className="portal-consent-notes">
          <div className="portal-consent-note is-error">
            <strong>Missing evidence is flagged, and the calls still go out</strong>
            <p>{incomplete.toLocaleString()} lead{incomplete === 1 ? " has" : "s have"} incomplete consent. The dialer does not refuse them — this workspace flags missing evidence rather than blocking it — so fix them at the vendor, or with the customer, before relying on them in a dispute.</p>
          </div>
          <div className="portal-consent-note is-info">
            <strong>The words are stored exactly as the customer saw them</strong>
            <p>For every certificate whose copy we claimed: not a summary, not a checkbox state &mdash; the literal text of the disclosure on the page they agreed to, which is the only version worth anything in a dispute.</p>
          </div>
        </div>
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
