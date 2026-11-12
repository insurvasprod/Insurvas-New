"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { LinkRow } from "@/components/app/book/setup/link-row";
import { bookLine, formatPhone, gapDay, type BookGapLine } from "@/lib/compliance/evidenceGaps";
import type { BookScan, EvidenceReport, ReportGap, ReportRun, TimelineItem } from "@/lib/compliance/evidenceReport";
import { SEVERITY_LABEL, SEVERITY_TONE, evidenceHref, evidenceQuery, rangeProblem, runHref, runScope, whenShort, type EvidenceQuery, type EvidenceView } from "@/lib/compliance/evidenceView";

/**
 * LA-6.3 · the evidence report on screen, and with no number the book-wide gap scan. PDF and CSV come from
 * the same route the screen reads (/api/app/compliance/evidence).
 *
 * Round 7 (owner 2026-11-11, docs/la4/mockups-r7/compliance.html §6, the A boards):
 *   /app/evidence-report                   Findings · Reports run on the title line; Run a report (a number, a lead,
 *                                          a date range) beside Scan the book; one line a finding, its sentence in
 *                                          the tooltip, the whole row opening the finding.
 *   /app/evidence-report?tab=runs          LA-6.3's log: who ran which report, newest first; a row reopens it.
 *   /app/evidence-report?focus=<finding>   a finding's numbers, one line each, each opening its report.
 *   /app/evidence-report?phone=…           one number's report: the number alone on the title line, its tabs Gaps ·
 *                                          Consent · Where it came from · Timeline, ‹ › through the finding it was
 *                                          opened from (`&finding=`), Download PDF.
 * Nothing on the page is a notice: a problem is a count on a tab, a chip on a tile or a row.
 */
const first = "whitespace-nowrap font-medium text-foreground";
const muted = "whitespace-nowrap tabular-nums text-muted-foreground";
const num = "text-right tabular-nums";
const next = "whitespace-nowrap text-right text-[var(--accent-ink)]";

/** The scan's scope picker: a number runs its report; none scans the book, over an optional date range. */
function ScopeToolbar({ query }: { query: EvidenceQuery }) {
  const router = useRouter();
  const [phone, setPhone] = useState(query.phone);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const [refreshing, startRefresh] = useTransition();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    router.push(`/app/evidence-report?${evidenceQuery({ phone: phone.trim(), from, to, lead: "", contact: "" })}`);
  };
  return (
    <form onSubmit={submit} className="w-full">
      <DataToolbar actions={<>
        <Button type="submit" variant="outline">{phone.trim() ? "Run report" : "Scan these dates"}</Button>
        <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
      </>}>
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Phone number</span>
          <input className={`${toolbarControl} w-full`} inputMode="tel" placeholder="A number, e.g. (817) 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">From<input type="date" className={toolbarControl} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">To<input type="date" className={toolbarControl} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </DataToolbar>
    </form>
  );
}

type Scope = "phone" | "lead" | "range";
type LeadHit = { id: string; name: string; phone: string | null };

/**
 * Run a report (round 7, LA-6.3 scope): one number, one lead (found by name or number) or a date range. A range is
 * the book-wide scan over those days, which is what the report store runs for a range; it is logged as one.
 */
export function RunReportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("phone");
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadHit | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (scope !== "lead" || lead || search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/app/compliance/evidence?search=${encodeURIComponent(search.trim())}`, { signal: controller.signal })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "Could not search leads");
          setHits(Array.isArray(body.leads) ? body.leads : []);
          setSearchError(null);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name !== "AbortError") setSearchError(error instanceof Error ? error.message : "Could not search leads");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [scope, search, lead]);

  const problem = scope === "range" ? rangeProblem(from, to) : null;
  const ready = scope === "phone" ? phone.trim().length > 0 : scope === "lead" ? lead !== null : Boolean(from || to) && !problem;
  const blank = { phone: "", lead: "", contact: "", from: "", to: "" };
  const run = () => {
    if (!ready) return;
    const href = scope === "phone" ? evidenceHref({ ...blank, phone: phone.trim() }) : scope === "lead" && lead ? evidenceHref({ ...blank, lead: lead.id }) : evidenceHref({ ...blank, from, to });
    setOpen(false);
    router.push(href);
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Run a report</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Run an evidence report</DialogTitle>
            <DialogDescription className="text-[var(--body)]">Every report run is logged with who ran it and when.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <Field label="Scope" htmlFor="evidence-scope">
              <select id="evidence-scope" className={control} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="phone">One number</option>
                <option value="lead">One lead</option>
                <option value="range">A date range</option>
              </select>
            </Field>
            {scope === "phone" ? (
              <Field label="Number" htmlFor="evidence-phone">
                <input id="evidence-phone" className={control} inputMode="tel" placeholder="(704) 555-2098" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            ) : scope === "lead" ? (
              <Field label="Lead" htmlFor="evidence-lead" error={searchError ?? undefined} hint={lead ? undefined : "A name, a number or an email."}>
                {lead ? (
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className={first}>{lead.name}{lead.phone ? <span className="font-normal text-[var(--body)]"> · {lead.phone}</span> : null}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => { setLead(null); setHits([]); }}>Change</Button>
                  </div>
                ) : (
                  <>
                    <input id="evidence-lead" className={control} placeholder="Search leads" value={search} onChange={(e) => { setSearch(e.target.value); if (e.target.value.trim().length < 2) setHits([]); }} autoComplete="off" />
                    {hits.length ? (
                      <ul className="mt-1.5 max-h-56 overflow-auto rounded-md border border-[var(--border)]" aria-label="Leads found">
                        {hits.map((h) => (
                          <li key={h.id}>
                            <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--primary-soft)]" onClick={() => setLead(h)}>
                              <span className={first}>{h.name}</span>
                              <span className="whitespace-nowrap tabular-nums text-[var(--body)]">{h.phone ?? "—"}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="evidence-from"><input id="evidence-from" type="date" className={control} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To" htmlFor="evidence-to" error={problem ?? undefined}><input id="evidence-to" type="date" className={control} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!ready}>Run report</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const gapChip = (g: ReportGap) => g.status === "gap"
  ? <StatusChip tone={SEVERITY_TONE[g.severity]} title={g.lines.join(" ")}>{SEVERITY_LABEL[g.severity]}</StatusChip>
  : <StatusChip tone="neutral" title={g.lines.join(" ")}>Undetermined</StatusChip>;

/** What a timeline row's Module column says, by the kind of record (the LA number stays in the tooltip). */
const MODULE_WORD: Record<string, string> = { screening: "Screening", scrub: "Scrub", dnc_add: "DNC", consent: "Consent", call_attempt: "Calls", disclosure: "Scripts", transfer_verdict: "Transfers", complaint: "Complaints", deletion: "Deletions" };

/** Where a timeline record opens: its own page when it has one, else its lead. */
function recordHref(t: TimelineItem): string | null {
  if (t.sourceTable === "tenant_consent_artefacts") return `/app/consent/${t.sourceId}`;
  if (t.sourceTable === "complaint") return `/app/complaints/${t.sourceId}`;
  if (t.sourceTable === "deletion") return `/app/deletion-requests/${t.sourceId}`;
  return t.leadId ? `/app/leads/${t.leadId}` : null;
}

/** One number's (or lead's, or client's) report: the strip, then the body of the tab that is open. */
export function ReportView({ report, view, query }: { report: EvidenceReport; view: EvidenceView; query: EvidenceQuery }) {
  const multiple = report.phones.length > 1;
  const validConsent = report.consent.filter((c) => c.valid).length;
  const fixToday = report.gaps.filter((g) => g.severity === "critical").length;
  const base = (v: EvidenceView) => `/app/evidence-report?${evidenceQuery(query, v === "gaps" ? {} : { view: v })}`;
  return (
    <>
      <StatStrip label="Report totals">
        <StatTile label="Gaps found" value={String(report.gaps.length)}
          footnote={fixToday ? <StatusChip tone="danger">{`${fixToday} fix today`}</StatusChip> : report.gaps.length ? <StatusChip tone="warning">{`${report.gaps.length} to fix`}</StatusChip> : `${report.gapsChecked} checks · ${report.undetermined.length} undetermined`} href={base("gaps")} />
        <StatTile label="Consent" value={`${validConsent} of ${report.consent.length}`}
          footnote={validConsent < report.consent.length ? <StatusChip tone="danger">{`${report.consent.length - validConsent} not valid`}</StatusChip> : "artefacts valid"} href={base("consent")} />
        <StatTile label="Leads" value={String(report.leads.length)} footnote={report.names[0] ?? "where it came from"} href={base("leads")} />
        <StatTile label="Records held" value={String(report.timeline.length)} footnote="on the timeline" href={base("timeline")} />
      </StatStrip>
      {view === "gaps" ? (
        <TableCard>
          {report.gaps.length === 0 && report.undetermined.length === 0 ? (
            <EmptyState title="No gaps found" hint="Every check ran and found nothing missing." />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Gap</th><th>Since</th><th className="text-right">Calls</th><th>Status</th></tr></thead>
              <tbody>
                {[...report.gaps, ...report.undetermined].map((g) => (
                  <LinkRow key={`${g.category}-${g.status}-${g.phoneDigits ?? ""}`} href={base("timeline")}>
                    <td className={first} title={g.lines.join(" ")}>{g.label}{multiple && g.phoneDigits ? ` · ${formatPhone(g.phoneDigits)}` : ""}</td>
                    <td className={muted}>{g.firstAt ? gapDay(g.firstAt) : "—"}</td>
                    <td className={num}>{g.count.toLocaleString("en-US")}</td>
                    <td>{gapChip(g)}</td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : view === "consent" ? (
        <TableCard>
          {report.consent.length === 0 ? (
            <EmptyState title="No consent artefact is held for this number" hint="Calls to it rest on no recorded consent." />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Provider</th><th>Certificate</th><th>Consent given</th><th>Status</th><th className="text-right">Next step</th></tr></thead>
              <tbody>
                {report.consent.map((c) => (
                  <LinkRow key={c.artefactId} href={`/app/consent/${c.artefactId}`}>
                    <td className={first}>{c.provider}{multiple ? ` · ${formatPhone(c.phoneDigits)}` : ""}</td>
                    <td className="max-w-[280px] truncate whitespace-nowrap" title={c.sourceUrl ?? undefined}>{c.certificateId ?? "—"}</td>
                    <td className={muted} title={`Captured ${whenShort(c.capturedAt)} UTC`}>{c.consentAt ? whenShort(c.consentAt) : "Not stated"}</td>
                    <td><StatusChip tone={c.valid ? "good" : "danger"} title={c.validity}>{c.valid ? "Valid" : "Not valid"}</StatusChip></td>
                    <td className={next}><Link href={`/app/consent/${c.artefactId}`} className="hover:underline">Open ›</Link></td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : view === "leads" ? (
        <TableCard>
          {report.leads.length === 0 ? <EmptyState title="No lead holds this number" hint="Nothing on record says where it came from." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Name</th><th>Source</th><th>Received</th><th className="text-right">Next step</th></tr></thead>
              <tbody>
                {report.leads.map((l) => (
                  <LinkRow key={l.leadId} href={`/app/leads/${l.leadId}`}>
                    <td className={first}>{l.name ?? "No name"}</td>
                    <td className="whitespace-nowrap">{l.partner ? `Partner: ${l.partner}` : l.campaign ? `Campaign: ${l.campaign}` : "Entered directly"}</td>
                    <td className={muted}>{gapDay(l.createdAt)}</td>
                    <td className={next}><Link href={`/app/leads/${l.leadId}`} className="hover:underline">Open lead ›</Link></td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
        <PagedTableCard total={report.timeline.length} noun={report.timeline.length === 1 ? "record" : "records"} suffix="oldest first · times in UTC · the table and record id are in Open ›'s tooltip">
          {report.timeline.length === 0 ? (
            <EmptyState title="Nothing recorded for this number" hint="No screening, scrub, consent, call or disclosure is on record." />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>When</th><th>What</th><th>Agent</th><th>Result</th><th>Module</th><th className="text-right">Record</th></tr></thead>
              <PagedBody>
                {report.timeline.map((t) => {
                  const href = recordHref(t);
                  const record = `${t.sourceTable} · ${t.sourceId}${t.sourceSubId ? ` / ${t.sourceSubId}` : ""}`;
                  const cells = (
                    <>
                      <td className={muted}>{whenShort(t.at)}</td>
                      <td className="max-w-[360px] truncate whitespace-nowrap font-medium text-foreground" title={[t.summary, ...t.facts].join(" · ")}>{t.result ? t.summary.replace(/^Call #(\d+) · .*$/, "Call $1") : t.summary}{multiple ? ` · ${formatPhone(t.phoneDigits)}` : ""}</td>
                      <td className="whitespace-nowrap">{t.agent ?? "—"}</td>
                      <td>{t.outsideHours ? <StatusChip tone="danger" title={t.facts.find((f) => f.startsWith("OUTSIDE")) ?? undefined}>Outside hours</StatusChip> : t.result ? <StatusChip tone="neutral">{t.result}</StatusChip> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap" title={`${t.module} · ${t.sourceTable}`}>{MODULE_WORD[t.eventType] ?? t.module}</td>
                      <td className={next} title={record}>{href ? <Link href={href} className="hover:underline">Open ›</Link> : <span className="text-muted-foreground">—</span>}</td>
                    </>
                  );
                  const key = `${t.sourceTable}-${t.sourceId}-${t.sourceSubId ?? ""}-${t.eventType}`;
                  return href ? <LinkRow key={key} href={href}>{cells}</LinkRow> : <tr key={key}>{cells}</tr>;
                })}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      )}
    </>
  );
}

const RANK = { critical: 0, high: 1, medium: 2 } as const;
const problemOf = (l: BookGapLine) => l.numbers > 0 || l.count > 0;

/** Worst first: problems by severity, then the checks that could not run, then the clear ones (the check order within each). */
function worstFirst(lines: BookGapLine[]): BookGapLine[] {
  const band = (l: BookGapLine) => (problemOf(l) ? RANK[l.severity] : l.undeterminedReason ? 3 : 4);
  return lines.map((l, i) => ({ l, i })).sort((a, b) => band(a.l) - band(b.l) || a.i - b.i).map((x) => x.l);
}

/** When the finding was first seen: the earliest of its numbers, only when the scan holds every one of them. */
function firstSeen(scan: BookScan, line: BookGapLine): string | null {
  const numbers = scan.numbersByCategory[line.category] ?? [];
  if (!numbers.length || numbers.length < line.numbers) return null;
  return numbers.map((n) => n.firstAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
}

/** The book-wide gap scan: the figures, then one line a finding, each opening its numbers. */
export function ScanView({ scan, query, problem }: { scan?: BookScan; query: EvidenceQuery; problem?: string }) {
  const line = (k: string) => scan?.lines.find((l) => l.category === k);
  const dnc = line("called_after_dnc");
  const hours = line("outside_legal_hours");
  const consent = line("calls_without_consent");
  const undetermined = scan ? scan.lines.filter((l) => l.undeterminedReason && !l.numbers).length : 0;
  const focus = (category: string) => `/app/evidence-report?${evidenceQuery(query, { focus: category })}`;
  return (
    <>
      {scan ? (
        <StatStrip label="Book-wide gaps">
          <StatTile label="Called after DNC" value={(dnc?.numbers ?? 0).toLocaleString("en-US")} footnote={dnc?.numbers ? <StatusChip tone="danger">Fix today</StatusChip> : "numbers"} href={dnc?.numbers ? focus("called_after_dnc") : undefined} />
          <StatTile label="Outside legal hours" value={(hours?.count ?? 0).toLocaleString("en-US")} footnote={hours?.count ? <StatusChip tone="danger">Should be 0</StatusChip> : `calls${hours?.undeterminedCount ? ` · ${hours.undeterminedCount} undetermined` : ""}`} href={hours?.count ? focus("outside_legal_hours") : undefined} />
          <StatTile label="No consent artefact" value={(consent?.numbers ?? 0).toLocaleString("en-US")} footnote={`${(consent?.count ?? 0).toLocaleString("en-US")} calls`} href={consent?.numbers ? focus("calls_without_consent") : undefined} />
          <StatTile label="Undetermined checks" value={String(undetermined)} footnote={`of ${scan.lines.length}`} />
        </StatStrip>
      ) : null}
      <TableCard toolbar={<ScopeToolbar query={query} />}>
        {problem ? <ErrorState detail={problem} /> : !scan ? <EmptyState title="Nothing scanned yet" hint="Scan the book, or run a report on a number, a lead or a date range." /> : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Finding</th><th className="text-right">Numbers</th><th className="text-right">Calls</th><th>First seen</th><th>Status</th><th className="text-right">Next step</th></tr></thead>
            <tbody>
              {worstFirst(scan.lines).map((l) => {
                const seen = firstSeen(scan, l);
                const bad = problemOf(l);
                const step = !bad ? "Open ›" : l.category === "outside_legal_hours" ? "See calls ›" : "See numbers ›";
                return (
                  <LinkRow key={l.category} href={focus(l.category)}>
                    <td className={first} id={`gap-${l.category}`} title={bad || l.undeterminedReason ? bookLine(l) : "None found."}>{l.label}</td>
                    <td className={num}>{l.numbers.toLocaleString("en-US")}</td>
                    <td className={num}>{l.count.toLocaleString("en-US")}</td>
                    <td className={muted}>{seen ? gapDay(seen) : "—"}</td>
                    <td>{bad ? <StatusChip tone={SEVERITY_TONE[l.severity]}>{SEVERITY_LABEL[l.severity]}</StatusChip> : l.undeterminedReason ? <StatusChip tone="neutral" title={l.undeterminedReason}>Undetermined</StatusChip> : <StatusChip tone="good">Clear</StatusChip>}</td>
                    <td className={next}><Link href={focus(l.category)} className="hover:underline">{step}</Link></td>
                  </LinkRow>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

/** Reports run (LA-6.3's log): one line a run, newest first; a row reopens that report's scope. */
export function RunsView({ runs, total }: { runs: ReportRun[]; total: number }) {
  const pageSize = useFittingPageSize(420, 45);
  const [page, setPage] = useState(1);
  const shown = paginate(runs, page, pageSize);
  return (
    <TableCard footer={runs.length ? <Pager page={shown.current} total={runs.length} pageSize={pageSize} noun={runs.length === 1 ? "run" : "runs"} onPage={setPage} suffix={total > runs.length ? `newest ${runs.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}` : "newest first"} /> : undefined}>
      {runs.length === 0 ? <EmptyState title="No report has been run yet" hint="Every report and every scan is logged here with who ran it and when." /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Who</th><th>Scope</th><th>Gaps found</th><th>Downloaded</th><th>When</th></tr></thead>
          <tbody>
            {shown.rows.map((r) => {
              const href = runHref(r);
              const scopeWords = runScope(r, formatPhone);
              const cells = (
                <>
                  <td className={first}>{r.who}</td>
                  <td className="whitespace-nowrap">{href ? <Link href={href} className="text-foreground hover:underline">{scopeWords}</Link> : scopeWords}</td>
                  <td>{r.gapCount === null ? <span className="text-muted-foreground">—</span> : r.gapCount > 0 ? <StatusChip tone="warning">{`${r.gapCount} ${r.scopeType === "book_scan" || r.scopeType === "date_range" ? (r.gapCount === 1 ? "finding" : "findings") : r.gapCount === 1 ? "gap" : "gaps"}`}</StatusChip> : <StatusChip tone="good">No gaps</StatusChip>}</td>
                  <td className="whitespace-nowrap">{r.output === "pdf" ? "PDF" : r.output === "csv" ? "CSV" : <span className="text-muted-foreground">—</span>}</td>
                  <td className={muted}>{whenShort(r.generatedAt)}</td>
                </>
              );
              return href ? <LinkRow key={r.id} href={href}>{cells}</LinkRow> : <tr key={r.id}>{cells}</tr>;
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** One finding's numbers (`?focus=`): one line each, each opening that number's report over the same range. */
export function FindingView({ scan, query, category }: { scan: BookScan; query: EvidenceQuery; category: string }) {
  const numbers = scan.numbersByCategory[category] ?? [];
  const pageSize = useFittingPageSize(420, 45);
  const [page, setPage] = useState(1);
  const shown = paginate(numbers, page, pageSize);
  const line = scan.lines.find((l) => l.category === category);
  // `finding` lets the report's ‹ › walk this list (round 7); `from`/`to` are the date range and stay as they are.
  const report = (phone: string) => evidenceHref({ ...query, phone }, { finding: category });
  return (
    <TableCard footer={numbers.length ? <Pager page={shown.current} total={numbers.length} pageSize={pageSize} noun={numbers.length === 1 ? "number" : "numbers"} onPage={setPage} suffix={line && line.numbers > numbers.length ? `of ${line.numbers.toLocaleString("en-US")} found` : undefined} /> : undefined}>
      {numbers.length === 0 ? <EmptyState title="No numbers for this finding" hint="Nothing in the range shows it." /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Number</th><th className="text-right">Calls</th><th>First seen</th><th className="text-right">Next step</th></tr></thead>
          <tbody>
            {shown.rows.map((n) => (
              <LinkRow key={n.phone} href={report(n.phone)}>
                <td className={`${first} tabular-nums`}>{formatPhone(n.phone)}</td>
                <td className={num}>{n.count.toLocaleString("en-US")}</td>
                <td className={muted}>{n.firstAt ? gapDay(n.firstAt) : "—"}</td>
                <td className={next}><Link href={report(n.phone)} className="hover:underline">Open report ›</Link></td>
              </LinkRow>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
