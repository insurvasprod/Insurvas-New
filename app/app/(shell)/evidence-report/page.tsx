import { Download } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { bookGapScan, buildEvidenceReport, EvidenceError, mayGenerateReports, type EvidenceScope } from "@/lib/compliance/evidenceReport";
import { evidenceRange } from "@/lib/compliance/evidenceRange";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { EVIDENCE_VIEWS, SEVERITY_LABEL, SEVERITY_TONE, evidenceQuery, type EvidenceView } from "@/lib/compliance/evidenceView";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { FindingView, ReportView, ScanView } from "@/components/app/compliance/evidence-report";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Evidence (LA-6.3, Notion sprint). With no number: the book-wide gap scan — where the gaps are
 * while they can still be fixed — and `?focus=<finding>` a finding's numbers (Overview's "See the numbers").
 * With a number (or a lead, or a client): every compliance record we hold about it, gaps first, as a record
 * page with tabs (foundation pass 2026-11-03). Owner and producer only. Every generation is logged.
 */
export default async function EvidenceReportPage({ searchParams }: { searchParams: Promise<{ phone?: string; lead?: string; contact?: string; from?: string; to?: string; focus?: string; view?: string }> }) {
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
      else scan = await bookGapScan(viewer, range, q.focus ? { focus: q.focus } : {});
    } catch (error) {
      if (!(error instanceof EvidenceError)) throw error;
      problem = error.message;
    }
  }

  if (report) {
    const view: EvidenceView = EVIDENCE_VIEWS.includes(q.view as EvidenceView) ? (q.view as EvidenceView) : "gaps";
    const api = `/api/app/compliance/evidence?${evidenceQuery(query)}`;
    const tabHref = (v: EvidenceView) => `/app/evidence-report?${evidenceQuery(query, v === "gaps" ? {} : { view: v })}`;
    const critical = report.gaps.some((g) => g.severity === "critical");
    const title = report.phones.map(formatPhone).join(", ") || "This record";
    const facts = [
      report.names.length ? report.names.join(", ") : "no name on file",
      rangeWords,
      `generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC by ${report.generatedBy}`,
    ].join(" · ");
    return (
      <ComplianceFlowPage
        step="evidence"
        title={title}
        chip={report.gaps.length ? <StatusChip tone={critical ? "danger" : "warning"}>{`${report.gaps.length} gap${report.gaps.length === 1 ? "" : "s"}`}</StatusChip> : <StatusChip tone="good">No gaps</StatusChip>}
        facts={facts}
        lead={<ViewTabs label="This report" value={view} tabs={[
          { key: "gaps", label: "Gaps", count: report.gaps.length || null, tone: "danger", href: tabHref("gaps") },
          { key: "consent", label: "Consent", count: report.consent.length, href: tabHref("consent") },
          { key: "leads", label: "Where it came from", count: report.leads.length, href: tabHref("leads") },
          { key: "timeline", label: "Timeline", count: report.timeline.length, href: tabHref("timeline") },
        ]} />}
        actions={<>
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
        chip={finding.numbers ? <StatusChip tone={SEVERITY_TONE[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</StatusChip> : <StatusChip tone="good">Clear</StatusChip>}
        facts={`${finding.numbers.toLocaleString("en-US")} number${finding.numbers === 1 ? "" : "s"} · ${finding.count.toLocaleString("en-US")} in all · ${rangeWords}`}
      >
        <FindingView scan={scan} query={query} category={finding.category} />
      </ComplianceFlowPage>
    );
  }

  return (
    <ComplianceFlowPage step="evidence" info="With no number, the scan looks across your whole book for the gaps that lose a case: calls after a DNC entry or a complaint, calls outside legal hours, calls with no consent. Enter a number to see every record we hold about it.">
      {/* A bad number or range keeps the scope picker on screen, with the reason in the card. */}
      {scan || problem ? <ScanView scan={scan} query={query} problem={problem} />
        : <TableCard><EmptyState title="Nothing scanned yet" hint="Scan the book, or enter a number to run its report." /></TableCard>}
    </ComplianceFlowPage>
  );
}
