"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { bookLine, formatPhone, gapDay, type GapItem, type GapSeverity } from "@/lib/compliance/evidenceGaps";
import type { BookScan, EvidenceReport } from "@/lib/compliance/evidenceReport";

/**
 * LA-6.3 · the evidence report on screen: the gaps first and expanded, consent broken out, the
 * timeline collapsed; or, with no number, the book-wide gap scan. PDF and CSV come from the same
 * route the screen reads (/api/app/compliance/evidence).
 */
type Query = { phone: string; from: string; to: string; lead: string; contact: string };

const SEVERITY_TONE: Record<GapSeverity, "danger" | "warning" | "neutral"> = { critical: "danger", high: "warning", medium: "neutral" };
const SEVERITY_LABEL: Record<GapSeverity, string> = { critical: "Fix today", high: "High", medium: "Medium" };
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function qs(query: Query, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...extra })) if (v) p.set(k, v);
  return p.toString();
}

function Toolbar({ query, report }: { query: Query; report?: EvidenceReport }) {
  const router = useRouter();
  const [phone, setPhone] = useState(query.phone);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const [refreshing, startRefresh] = useTransition();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    router.push(`/app/evidence-report?${qs({ phone: phone.trim(), from, to, lead: "", contact: "" })}`);
  };
  const api = `/api/app/compliance/evidence?${qs(query)}`;
  return (
    <form onSubmit={submit} className="w-full">
      <DataToolbar
        actions={
          <>
            {report ? (
              <>
                <Button asChild variant="outline"><a href={`${api}&format=pdf`}>Download PDF</a></Button>
                <Button asChild variant="outline"><a href={`${api}&format=csv`}>Timeline CSV</a></Button>
                <Button asChild variant="outline"><Link href="/app/evidence-report">Whole book</Link></Button>
              </>
            ) : null}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>
        }
      >
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Phone number</span>
          <input className={`${toolbarControl} w-full`} inputMode="tel" placeholder="Phone number, e.g. (817) 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">From<input type="date" className={toolbarControl} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">To<input type="date" className={toolbarControl} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button type="submit">{phone.trim() ? "Run report" : "Scan the book"}</Button>
      </DataToolbar>
    </form>
  );
}

function GapList({ items, multiple }: { items: GapItem[]; multiple: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((g) => (
        <li key={`${g.category}-${g.status}-${g.phoneDigits ?? ""}`} className="flex flex-col gap-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {g.status === "gap" ? <StatusChip tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</StatusChip> : <StatusChip tone="info">Undetermined</StatusChip>}
            <span className="font-semibold">{g.label}</span>
            {multiple && g.phoneDigits ? <span className="text-sm text-muted-foreground">{formatPhone(g.phoneDigits)}</span> : null}
          </div>
          {g.lines.map((l) => <p key={l} className="text-sm">{l}</p>)}
        </li>
      ))}
    </ul>
  );
}

function ReportView({ report }: { report: EvidenceReport }) {
  const [open, setOpen] = useState(false);
  const multiple = report.phones.length > 1;
  const validConsent = report.consent.filter((c) => c.valid).length;
  return (
    <>
      <StatStrip label="Report totals">
        <StatTile label="Gaps found" value={String(report.gaps.length)} valueTone={report.gaps.length ? "warning" : undefined} footnote={`${report.gapsChecked} checks · ${report.undetermined.length} undetermined`} />
        <StatTile label="Records held" value={String(report.timeline.length)} footnote={report.phones.map(formatPhone).join(", ")} />
        <StatTile label="Consent" value={`${validConsent} of ${report.consent.length}`} footnote="artefacts valid" />
        <StatTile label="Generated" value={report.generatedAt.slice(0, 10)} footnote={`by ${report.generatedBy}`} />
      </StatStrip>

      <TableCard title={`Gaps found: ${report.gaps.length}`} description={report.names.length ? `Names on file: ${report.names.join(", ")}` : undefined}>
        {report.gaps.length === 0 && report.undetermined.length === 0 ? (
          <EmptyState title="No gaps found" hint="Every check ran and found nothing missing." />
        ) : (
          <>
            {report.gaps.length ? <GapList items={report.gaps} multiple={multiple} /> : <p className="px-4 py-3 text-sm text-muted-foreground">No gaps found by the checks that could be run.</p>}
            {report.undetermined.length ? <div className="border-t border-border"><GapList items={report.undetermined} multiple={multiple} /></div> : null}
          </>
        )}
      </TableCard>

      <TableCard title="Consent" description="Do we have proof this person agreed to be called, whose proof, captured when, still valid?">
        {report.consent.length === 0 ? (
          <EmptyState title="No consent artefact is held for this number" hint="Calls to it rest on no recorded consent." />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th className="w-[160px]">Provider</th><th>Certificate</th><th className="w-[180px]">Consent given</th><th className="w-[260px]">Still valid?</th></tr></thead>
            <tbody>
              {report.consent.map((c) => (
                <tr key={c.artefactId}>
                  <td>{c.provider}{multiple ? <div className="text-xs text-muted-foreground">{formatPhone(c.phoneDigits)}</div> : null}</td>
                  <td className="break-all">{c.certificateUrl ? <a className="underline" href={c.certificateUrl} target="_blank" rel="noreferrer">{c.certificateId ?? "Open certificate"}</a> : c.certificateId ?? "—"}{c.sourceUrl ? <div className="text-xs text-muted-foreground">{c.sourceUrl}</div> : null}</td>
                  <td>{c.consentAt ? when(c.consentAt) : "Not stated"}<div className="text-xs text-muted-foreground">captured {when(c.capturedAt)}</div></td>
                  <td><StatusChip tone={c.valid ? "good" : "danger"}>{c.valid ? "Valid" : "Not valid"}</StatusChip><div className="mt-1 text-xs text-muted-foreground">{c.validity}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {report.leads.length ? (
        <TableCard title="Where the lead came from">
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th className="w-[140px]">Received</th><th>Source</th><th className="w-[220px]">Name</th><th className="w-[120px] text-right">Lead</th></tr></thead>
            <tbody>
              {report.leads.map((l) => (
                <tr key={l.leadId}>
                  <td>{l.createdAt.slice(0, 10)}</td>
                  <td>{l.partner ? `Partner: ${l.partner}` : l.campaign ? `Campaign: ${l.campaign}` : "Entered directly"}</td>
                  <td>{l.name ?? "—"}</td>
                  <td className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/app/leads/${l.leadId}`}>Open</Link></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : null}

      <TableCard
        title={`Timeline: ${report.timeline.length} record${report.timeline.length === 1 ? "" : "s"}`}
        action={<Button variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Collapse" : "Expand"}</Button>}
      >
        {!open ? null : report.timeline.length === 0 ? (
          <EmptyState title="Nothing recorded for this number" hint="No screening, scrub, consent, call or disclosure is on record." />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead><tr><th className="w-[170px]">When</th><th>What</th><th className="w-[300px]">Source record</th></tr></thead>
            <tbody>
              {report.timeline.map((t) => (
                <tr key={`${t.sourceTable}-${t.sourceId}-${t.sourceSubId ?? ""}-${t.eventType}`}>
                  <td className="whitespace-nowrap">{when(t.at)}</td>
                  <td>{t.summary}{t.facts.map((f) => <div key={f} className={`text-xs ${f.startsWith("OUTSIDE") ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground"}`}>{f}</div>)}</td>
                  <td className="break-all text-xs text-muted-foreground">{t.module} · {t.sourceTable}<div>{t.sourceId}{t.sourceSubId ? ` / ${t.sourceSubId}` : ""}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

function ScanView({ scan, query }: { scan: BookScan; query: Query }) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const line = (k: string) => scan.lines.find((l) => l.category === k);
  const dnc = line("called_after_dnc");
  const hours = line("outside_legal_hours");
  const consent = line("calls_without_consent");
  const undetermined = scan.lines.filter((l) => l.undeterminedReason && !l.numbers).length;
  return (
    <>
      <StatStrip label="Book-wide gaps">
        <StatTile label="Called after DNC" value={String(dnc?.numbers ?? 0)} valueTone={dnc?.numbers ? "danger" : undefined} footnote="numbers · fix today" />
        <StatTile label="Outside legal hours" value={String(hours?.count ?? 0)} valueTone={hours?.count ? "danger" : undefined} footnote={`calls${hours?.undeterminedCount ? ` · ${hours.undeterminedCount} undetermined` : ""}`} />
        <StatTile label="No consent artefact" value={String(consent?.numbers ?? 0)} footnote={`numbers · ${consent?.count ?? 0} calls`} />
        <StatTile label="Undetermined checks" value={String(undetermined)} footnote={`of ${scan.lines.length}`} />
      </StatStrip>
      <TableCard title="Gaps across the book" description={query.from || query.to ? `Calls from ${query.from || "the start"} to ${query.to || "today"}.` : "Every call on record."}>
        <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th className="w-[120px]">Severity</th><th>Finding</th><th className="w-[110px] text-right">Numbers</th><th className="w-[110px] text-right">Count</th><th className="w-[140px] text-right" /></tr></thead>
          <tbody>
            {scan.lines.map((l) => {
              const numbers = scan.numbersByCategory[l.category] ?? [];
              const expanded = openCat === l.category;
              return [
                <tr key={l.category}>
                  <td>{l.numbers ? <StatusChip tone={SEVERITY_TONE[l.severity]}>{SEVERITY_LABEL[l.severity]}</StatusChip> : l.undeterminedReason ? <StatusChip tone="info">Undetermined</StatusChip> : <StatusChip tone="good">Clear</StatusChip>}</td>
                  <td><div className="font-medium">{l.label}</div><div className="text-xs text-muted-foreground">{l.numbers || l.undeterminedReason ? bookLine(l) : "None found."}</div></td>
                  <td className="text-right tabular-nums">{l.numbers}</td>
                  <td className="text-right tabular-nums">{l.count}</td>
                  <td className="text-right">{numbers.length ? <Button size="sm" variant="outline" onClick={() => setOpenCat(expanded ? null : l.category)} aria-expanded={expanded}>{expanded ? "Hide numbers" : "Show numbers"}</Button> : null}</td>
                </tr>,
                expanded ? (
                  <tr key={`${l.category}-numbers`}>
                    <td />
                    <td colSpan={4}>
                      <ul className="grid gap-1 py-1 sm:grid-cols-2 lg:grid-cols-3">
                        {numbers.slice(0, 300).map((n) => (
                          <li key={n.phone} className="text-sm">
                            <Link className="underline" href={`/app/evidence-report?${qs({ ...query, phone: n.phone })}`}>{formatPhone(n.phone)}</Link>
                            <span className="text-xs text-muted-foreground"> · {n.count} · {gapDay(n.firstAt)}</span>
                          </li>
                        ))}
                      </ul>
                      {numbers.length > 300 ? <p className="text-xs text-muted-foreground">Showing 300 of {numbers.length}.</p> : null}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </TableCard>
    </>
  );
}

export function EvidenceReportView({ query, report, scan, problem }: { query: Query; report?: EvidenceReport; scan?: BookScan; problem?: string }) {
  return (
    <>
      <TableCard toolbar={<Toolbar query={query} report={report} />}>
        {problem ? <ErrorState detail={problem} /> : null}
      </TableCard>
      {report ? <ReportView report={report} /> : scan ? <ScanView scan={scan} query={query} /> : null}
    </>
  );
}
