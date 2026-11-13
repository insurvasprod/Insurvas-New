import { Download } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import Link from "next/link";

import { bookGapScan, buildEvidenceReport, EvidenceError, countReportRuns, listReportRuns, mayGenerateReports, type EvidenceScope } from "@/lib/compliance/evidenceReport";
import { evidenceRange } from "@/lib/compliance/evidenceRange";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { EVIDENCE_VIEWS, SEVERITY_LABEL, evidenceHref, evidenceQuery, type EvidenceTab, type EvidenceView } from "@/lib/compliance/evidenceView";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { FindingView, ReportView, RunReportButton, RunsView, ScanView } from "@/components/app/compliance/evidence-report";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Evidence (LA-6.3, Notion sprint). With no number: the book-wide gap scan — where the gaps are
 * while they can still be fixed — and `?focus=<finding>` a finding's numbers (Overview's "See the numbers").
 * With a number (or a lead, or a client): every compliance record we hold about it, gaps first, as a record
 * page with tabs (foundation pass 2026-11-03). Owner and producer only. Every generation is logged.
 * Round 7 (mockups-r7/compliance.html §6 A): Findings · Reports run on the title line (`?tab=runs`, LA-6.3's log),
 * Run a report (a number, a lead, a date range), the number alone as a report's title, and ‹ › through the finding
 * a report was opened from (`&finding=`: `from` is already the date range's start).
 */
export default async function EvidenceReportPage({ searchParams }: { searchParams: Promise<{ phone?: string; lead?: string; contact?: string; from?: string; to?: string; focus?: string; view?: string; tab?: string; finding?: string }> }) {
  const guard = await guardPage("litigation_packet");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Evidence report" description="Every compliance record held about a number, and every gap." />;
  }
  if (!actAsPage(guard, ["owner", "producer"])) {
    return <RoleGateNotice featureLabel="Evidence report" detail="Only owners and producers can see a consumer's compliance records." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Evidence report" detail="In an agency, the owner and admins handle the evidence report." />;
  if (!(await mayGenerateReports(guard.context.tenantId, guard.role))) {
    return <RoleGateNotice featureLabel="Evidence report" detail="Your agency has not allowed your role to generate compliance reports." />;
  }
  const q = await searchParams;
  // The mockup's address for the "Where it came from" tab; the tab's key stays "leads".
  if (q.view === "sources") q.view = "leads";
  const tab: EvidenceTab = q.tab === "runs" ? "runs" : "findings";
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  const range = evidenceRange(q.from ?? null, q.to ?? null);
  const scope: EvidenceScope | null = q.phone ? { type: "phone", phone: q.phone } : q.lead ? { type: "lead", leadId: q.lead } : q.contact ? { type: "contact", contactId: q.contact } : null;
  const query = { phone: q.phone ?? "", from: q.from ?? "", to: q.to ?? "", lead: q.lead ?? "", contact: q.contact ?? "" };
  const rangeWords = q.from || q.to ? `calls from ${q.from || "the start"} to ${q.to || "today"}` : "every call on record";

  let report: Awaited<ReturnType<typeof buildEvidenceReport>> | undefined;
  let scan: Awaited<ReturnType<typeof bookGapScan>> | undefined;
  // A bad range keeps the scope picker on screen with the reason, as a bad number does (QA pass 2026-10-22).
  let problem: string | undefined = "error" in range ? range.error : undefined;
  if (!("error" in range)) {
    try {
      if (scope) report = await buildEvidenceReport(viewer, scope, range, "screen");
      // Reports run reads the log; the scan behind the Findings count is not a run of its own there.
      else scan = await bookGapScan(viewer, range, q.focus ? { focus: q.focus } : tab === "runs" ? { log: false } : {});
    } catch (error) {
      if (!(error instanceof EvidenceError)) throw error;
      problem = error.message;
    }
  }

  if (report) {
    const view: EvidenceView = EVIDENCE_VIEWS.includes(q.view as EvidenceView) ? (q.view as EvidenceView) : "gaps";
    const api = `/api/app/compliance/evidence?${evidenceQuery(query)}`;
    const tabHref = (v: EvidenceView) => `/app/evidence-report?${evidenceQuery(query, v === "gaps" ? {} : { view: v })}`;
    const title = report.phones.map(formatPhone).join(", ") || "This record";
    // ‹ › walk the finding's numbers in the order its page lists them, when the report was opened from one.
    let stepper: { previous: { href: string; label: string } | null; next: { href: string; label: string } | null } = { previous: null, next: null };
    if (q.finding && q.phone && !("error" in range)) {
      const finding = q.finding;
      const walk = await bookGapScan(viewer, range, { focus: finding, log: false }).catch(() => null);
      const list = walk?.numbersByCategory[finding] ?? [];
      const at = neighboursOf(list, report.phones[0] ?? "", (n) => n.phone);
      const link = (n: { phone: string } | null) => (n ? { href: evidenceHref({ ...query, phone: n.phone }, { finding }), label: formatPhone(n.phone) } : null);
      stepper = { previous: link(at.previous), next: link(at.next) };
    }
    const facts = [
      report.names.length ? report.names.join(", ") : "no name on file",
      rangeWords,
      `generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC by ${report.generatedBy}`,
    ].join(" · ");
    return (
      <ComplianceFlowPage
        step="evidence"
        title={title}
        info={`${facts}.`}
        tabs={<ViewTabs label="This report" value={view} tabs={[
          { key: "gaps", label: "Gaps", count: report.gaps.length || null, tone: "danger", href: tabHref("gaps") },
          { key: "consent", label: "Consent", count: report.consent.length, href: tabHref("consent") },
          { key: "leads", label: "Where it came from", count: report.leads.length, href: tabHref("leads") },
          { key: "timeline", label: "Timeline", count: report.timeline.length, href: tabHref("timeline") },
        ]} />}
        actions={<>
          <RecordStepper previous={stepper.previous} next={stepper.next} noun="number" />
          <MoreMenu items={[
            { label: "Timeline CSV", href: `${api}&format=csv` },
            { label: "Scan the whole book", href: "/app/evidence-report" },
          ]} />
          <Button asChild><a href={`${api}&format=pdf`}><Download aria-hidden="true" />Download PDF</a></Button>
        </>}
      >
        <ReportView report={report} view={view} query={query} />
      </ComplianceFlowPage>
    );
  }

  const finding = q.focus && scan ? scan.lines.find((l) => l.category === q.focus) : undefined;
  if (finding && scan) {
    return (
      <ComplianceFlowPage
        step="evidence"
        title={finding.label}
        facts={`${finding.numbers ? SEVERITY_LABEL[finding.severity] : "Clear"} · ${finding.numbers.toLocaleString("en-US")} number${finding.numbers === 1 ? "" : "s"} · ${finding.count.toLocaleString("en-US")} in all · ${rangeWords}`}
      >
        <FindingView scan={scan} query={query} category={finding.category} />
      </ComplianceFlowPage>
    );
  }

  const problems = scan ? scan.lines.filter((l) => l.numbers > 0 || l.count > 0) : [];
  const fixToday = problems.some((l) => l.severity === "critical");
  let runsProblem: string | undefined;
  const runs = tab === "runs" ? await listReportRuns(viewer).catch((error: unknown) => {
    if (!(error instanceof EvidenceError)) throw error;
    runsProblem = error.message;
    return null;
  }) : null;
  const runCount = runs ? runs.total : await countReportRuns(viewer);
  const listHref = (t: EvidenceTab) => evidenceHref({ ...query, phone: "", lead: "", contact: "" }, t === "runs" ? { tab: "runs" } : {});
  return (
    <ComplianceFlowPage step="evidence"
      info="With no number, the scan looks across your whole book for the gaps that lose a case: calls after a DNC entry or a complaint, calls outside legal hours, calls with no consent. Run a report to see every record we hold about a number or a lead."
      tabs={<ViewTabs label="Evidence" value={tab} tabs={[
        { key: "findings", label: "Findings", count: scan ? problems.length : null, tone: fixToday ? "danger" : undefined, href: listHref("findings") },
        { key: "runs", label: "Reports run", count: runCount, href: listHref("runs") },
      ]} />}
      actions={<>
        <Button asChild variant="outline"><Link href={listHref("findings")}>Scan the book</Link></Button>
        <RunReportButton />
      </>}
    >
      {tab === "runs" ? (runs ? <RunsView runs={runs.runs} total={runs.total} /> : <TableCard><ErrorState detail={runsProblem ?? "The report log could not be read."} /></TableCard>)
        /* A bad number or range keeps the scope picker on screen, with the reason in the card. */
        : scan || problem ? <ScanView scan={scan} query={query} problem={problem} />
          : <TableCard><EmptyState title="Nothing scanned yet" hint="Scan the book, or run a report on a number, a lead or a date range." /></TableCard>}
    </ComplianceFlowPage>
  );
}
