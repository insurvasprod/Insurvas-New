"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { bookLine, formatPhone, gapDay, type GapItem } from "@/lib/compliance/evidenceGaps";
import type { BookScan, EvidenceReport } from "@/lib/compliance/evidenceReport";
import { SEVERITY_LABEL, SEVERITY_TONE, evidenceQuery, type EvidenceQuery, type EvidenceView } from "@/lib/compliance/evidenceView";
import { Callout } from "@/components/app/settings/primitives";

/**
 * LA-6.3 · the evidence report on screen, and with no number the book-wide gap scan. PDF and CSV come from
 * the same route the screen reads (/api/app/compliance/evidence).
 *
 * Foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md), list page → record page → tabs:
 *   /app/evidence-report                   the scan: the scope picker (a number, a date range) is the gap
 *                                          table's toolbar, never a card of its own; each figure and each
 *                                          finding opens the numbers behind it.
 *   /app/evidence-report?focus=<finding>   a finding's numbers, paged, each opening its report.
 *   /app/evidence-report?phone=…           one number's report: the number, its gap count and one facts line
 *                                          on the title line, Download PDF and More; tabs Gaps (first, as the
 *                                          spec orders) · Consent · Where it came from · Timeline (`?view=`).
 * What is wrong goes to the bell; the page shows the records.
 */
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

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
        <Button type="submit" variant="outline">{phone.trim() ? "Run report" : "Scan the book"}</Button>
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

function GapRows({ items, multiple }: { items: GapItem[]; multiple: boolean }) {
  return (
    <>
      {items.map((g) => (
        <tr key={`${g.category}-${g.status}-${g.phoneDigits ?? ""}`}>
          <td className="align-top">{g.status === "gap" ? <StatusChip tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</StatusChip> : <StatusChip tone="info">Undetermined</StatusChip>}</td>
          <td><div className="font-medium">{g.label}{multiple && g.phoneDigits ? <span className="font-normal text-muted-foreground"> · {formatPhone(g.phoneDigits)}</span> : null}</div>{g.lines.map((l) => <div key={l} className="text-sm text-[var(--body)]">{l}</div>)}</td>
        </tr>
      ))}
    </>
  );
}

/** One number's (or lead's, or client's) report: the body of the tab that is open. */
export function ReportView({ report, view, query }: { report: EvidenceReport; view: EvidenceView; query: EvidenceQuery }) {
  const multiple = report.phones.length > 1;
  const validConsent = report.consent.filter((c) => c.valid).length;
  const critical = report.gaps.some((g) => g.severity === "critical");
  const base = (v: EvidenceView) => `/app/evidence-report?${evidenceQuery(query, v === "gaps" ? {} : { view: v })}`;
  return (
    <>
      {report.gaps.length ? <Callout tone={critical ? "error" : "warning"} title={`${report.gaps.length} gap${report.gaps.length === 1 ? "" : "s"} found for ${report.phones.map(formatPhone).join(", ") || "this record"}`}>Fix {report.gaps.length === 1 ? "it" : "them"} while {report.gaps.length === 1 ? "it is" : "they are"} still fixable.</Callout> : null}
      <StatStrip label="Report totals">
        <StatTile label="Gaps found" value={String(report.gaps.length)} valueTone={report.gaps.length ? (critical ? "danger" : "warning") : undefined} footnote={`${report.gapsChecked} checks · ${report.undetermined.length} undetermined`} href={base("gaps")} />
        <StatTile label="Consent" value={`${validConsent} of ${report.consent.length}`} footnote="artefacts valid" href={base("consent")} />
        <StatTile label="Leads" value={String(report.leads.length)} footnote="where it came from" href={base("leads")} />
        <StatTile label="Records held" value={String(report.timeline.length)} footnote="on the timeline" href={base("timeline")} />
      </StatStrip>
      {view === "gaps" ? (
        <TableCard>
          {report.gaps.length === 0 && report.undetermined.length === 0 ? (
            <EmptyState title="No gaps found" hint="Every check ran and found nothing missing." />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Severity</th><th>Gap</th></tr></thead>
              <tbody>
                <GapRows items={report.gaps} multiple={multiple} />
                <GapRows items={report.undetermined} multiple={multiple} />
              </tbody>
            </table>
          )}
        </TableCard>
      ) : view === "consent" ? (
        <TableCard>
          {report.consent.length === 0 ? (
            <EmptyState title="No consent artefact is held for this number" hint="Calls to it rest on no recorded consent." />
          ) : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th>Provider</th><th>Certificate</th><th>Consent given</th><th>Still valid?</th></tr></thead>
              <tbody>
                {report.consent.map((c) => (
                  <tr key={c.artefactId}>
                    <td>{c.provider}{multiple ? <div className="text-xs text-muted-foreground">{formatPhone(c.phoneDigits)}</div> : null}</td>
                    <td className="max-w-[320px]"><Link className="text-[var(--accent-ink)] hover:underline" href={`/app/consent/${c.artefactId}`}>{c.certificateId ?? "Open certificate"}</Link>{c.sourceUrl ? <div className="truncate text-xs text-muted-foreground" title={c.sourceUrl}>{c.sourceUrl}</div> : null}</td>
                    <td className="whitespace-nowrap">{c.consentAt ? when(c.consentAt) : "Not stated"}<div className="text-xs text-muted-foreground">captured {when(c.capturedAt)}</div></td>
                    <td><StatusChip tone={c.valid ? "good" : "danger"}>{c.valid ? "Valid" : "Not valid"}</StatusChip><div className="mt-1 text-xs text-muted-foreground">{c.validity}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : view === "leads" ? (
        <TableCard>
          {report.leads.length === 0 ? <EmptyState title="No lead holds this number" hint="Nothing on record says where it came from." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Received</th><th>Source</th><th>Name</th><th className="text-right"><span className="sr-only">Lead</span></th></tr></thead>
              <tbody>
                {report.leads.map((l) => (
                  <tr key={l.leadId}>
                    <td className="whitespace-nowrap tabular-nums">{l.createdAt.slice(0, 10)}</td>
                    <td>{l.partner ? `Partner: ${l.partner}` : l.campaign ? `Campaign: ${l.campaign}` : "Entered directly"}</td>
                    <td>{l.name ?? "—"}</td>
                    <td className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/app/leads/${l.leadId}`}>Open</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : (
        // A record's facts make rows of different heights: PagedTableCard measures them, so a page fits the rail's foot.
        <PagedTableCard total={report.timeline.length} noun={report.timeline.length === 1 ? "record" : "records"} suffix="oldest first">
          {report.timeline.length === 0 ? (
            <EmptyState title="Nothing recorded for this number" hint="No screening, scrub, consent, call or disclosure is on record." />
          ) : (
            <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
              <thead><tr><th>When</th><th>What</th><th>Source record</th></tr></thead>
              <PagedBody>
                {report.timeline.map((t) => (
                  <tr key={`${t.sourceTable}-${t.sourceId}-${t.sourceSubId ?? ""}-${t.eventType}`}>
                    <td className="whitespace-nowrap tabular-nums">{when(t.at)}</td>
                    <td>{t.summary}{t.facts.map((f) => <div key={f} className={`text-xs ${f.startsWith("OUTSIDE") ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground"}`}>{f}</div>)}</td>
                    <td className="max-w-[280px] text-xs text-muted-foreground"><div>{t.module} · {t.sourceTable}</div><div className="truncate" title={`${t.sourceId}${t.sourceSubId ? ` / ${t.sourceSubId}` : ""}`}>{t.sourceId}{t.sourceSubId ? ` / ${t.sourceSubId}` : ""}</div></td>
                  </tr>
                ))}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      )}
    </>
  );
}

/** The book-wide gap scan: the figures, then every finding, each opening its numbers. */
export function ScanView({ scan, query, problem }: { scan?: BookScan; query: EvidenceQuery; problem?: string }) {
  const line = (k: string) => scan?.lines.find((l) => l.category === k);
  const dnc = line("called_after_dnc");
  const hours = line("outside_legal_hours");
  const consent = line("calls_without_consent");
  const undetermined = scan ? scan.lines.filter((l) => l.undeterminedReason && !l.numbers).length : 0;
  const RANK = { critical: 0, high: 1, medium: 2 } as const;
  const worst = scan?.lines.filter((l) => l.numbers > 0).sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
  const focus = (category: string) => `/app/evidence-report?${evidenceQuery(query, { focus: category })}`;
  return (
    <>
      {worst ? <Callout tone={worst.severity === "critical" ? "error" : "warning"} title={`${worst.label}: ${worst.numbers.toLocaleString("en-US")} number${worst.numbers === 1 ? "" : "s"}`}>{worst.severity === "critical" ? "Fix today." : "Open Evidence to see them."}</Callout>
        : undetermined ? <Callout tone="warning" title={`${undetermined} check${undetermined === 1 ? "" : "s"} could not run`}>Every other check is clear.</Callout> : null}
      {scan ? (
        <StatStrip label="Book-wide gaps">
          <StatTile label="Called after DNC" value={String(dnc?.numbers ?? 0)} valueTone={dnc?.numbers ? "danger" : undefined} footnote="numbers · fix today" href={dnc?.numbers ? focus("called_after_dnc") : undefined} />
          <StatTile label="Outside legal hours" value={String(hours?.count ?? 0)} valueTone={hours?.count ? "danger" : undefined} footnote={`calls${hours?.undeterminedCount ? ` · ${hours.undeterminedCount} undetermined` : ""}`} href={hours?.count ? focus("outside_legal_hours") : undefined} />
          <StatTile label="No consent artefact" value={String(consent?.numbers ?? 0)} footnote={`numbers · ${consent?.count ?? 0} calls`} href={consent?.numbers ? focus("calls_without_consent") : undefined} />
          <StatTile label="Undetermined checks" value={String(undetermined)} footnote={`of ${scan.lines.length}`} />
        </StatStrip>
      ) : null}
      <TableCard toolbar={<ScopeToolbar query={query} />}>
        {problem ? <ErrorState detail={problem} /> : !scan ? <EmptyState title="Nothing scanned yet" hint="Scan the book, or enter a number to run its report." /> : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Severity</th><th>Finding</th><th className="text-right">Numbers</th><th className="text-right">Count</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {scan.lines.map((l) => (
                <tr key={l.category} id={`gap-${l.category}`}>
                  <td>{l.numbers ? <StatusChip tone={SEVERITY_TONE[l.severity]}>{SEVERITY_LABEL[l.severity]}</StatusChip> : l.undeterminedReason ? <StatusChip tone="info">Undetermined</StatusChip> : <StatusChip tone="good">Clear</StatusChip>}</td>
                  <td><div className="font-medium">{l.label}</div><div className="text-xs text-muted-foreground">{l.numbers || l.undeterminedReason ? bookLine(l) : "None found."}</div></td>
                  <td className="text-right tabular-nums">{l.numbers}</td>
                  <td className="text-right tabular-nums">{l.count}</td>
                  <td className="text-right">{(scan.numbersByCategory[l.category]?.length ?? 0) > 0 ? <Button size="sm" variant="outline" asChild><Link href={focus(l.category)}>Show numbers</Link></Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

/** One finding's numbers (`?focus=`): paged, each opening that number's report over the same range. */
export function FindingView({ scan, query, category }: { scan: BookScan; query: EvidenceQuery; category: string }) {
  const numbers = scan.numbersByCategory[category] ?? [];
  const pageSize = useFittingPageSize(420, 45);
  const [page, setPage] = useState(1);
  const shown = paginate(numbers, page, pageSize);
  const line = scan.lines.find((l) => l.category === category);
  return (
    <TableCard footer={numbers.length ? <Pager page={shown.current} total={numbers.length} pageSize={pageSize} noun={numbers.length === 1 ? "number" : "numbers"} onPage={setPage} suffix={line && line.numbers > numbers.length ? `of ${line.numbers.toLocaleString("en-US")} found` : undefined} /> : undefined}>
      {numbers.length === 0 ? <EmptyState title="No numbers for this finding" hint="Nothing in the range shows it." /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Number</th><th className="text-right">Count</th><th>First seen</th><th className="text-right"><span className="sr-only">Report</span></th></tr></thead>
          <tbody>
            {shown.rows.map((n) => (
              <tr key={n.phone}>
                <td className="font-semibold tabular-nums text-[var(--ink)]">{formatPhone(n.phone)}</td>
                <td className="text-right tabular-nums">{n.count}</td>
                <td className="tabular-nums">{gapDay(n.firstAt)}</td>
                <td className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/app/evidence-report?${evidenceQuery({ ...query, phone: n.phone })}`}>Open report</Link></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
