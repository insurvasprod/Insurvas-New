import { guardPage } from "@/lib/entitlements/guardPage";
import { bookGapScan, buildEvidenceReport, EvidenceError, mayGenerateReports, type EvidenceScope } from "@/lib/compliance/evidenceReport";
import { evidenceRange } from "@/lib/compliance/evidenceRange";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { EvidenceReportView } from "@/components/app/compliance/evidence-report";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/page-states";

/**
 * Setup › Evidence report (LA-6.3, Notion sprint). With no number: the book-wide gap scan — where
 * the gaps are while they can still be fixed. With a number (or a lead, or a client): every
 * compliance record we hold about it, gaps first. Owner and producer only. Every generation is logged.
 */
export default async function EvidenceReportPage({ searchParams }: { searchParams: Promise<{ phone?: string; lead?: string; contact?: string; from?: string; to?: string }> }) {
  const guard = await guardPage("litigation_packet");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Evidence report" description="Every compliance record held about a number, and every gap." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Evidence report" detail="Only owners and producers can see a consumer's compliance records." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice featureLabel="Evidence report" detail="In an agency, the owner and admins handle evidence report." />;
  if (!(await mayGenerateReports(guard.context.tenantId, guard.role))) {
    return <RoleGateNotice featureLabel="Evidence report" detail="Your agency has not allowed your role to generate compliance reports." />;
  }
  const q = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  const range = evidenceRange(q.from ?? null, q.to ?? null);
  const scope: EvidenceScope | null = q.phone ? { type: "phone", phone: q.phone } : q.lead ? { type: "lead", leadId: q.lead } : q.contact ? { type: "contact", contactId: q.contact } : null;
  const query = { phone: q.phone ?? "", from: q.from ?? "", to: q.to ?? "", lead: q.lead ?? "", contact: q.contact ?? "" };

  let report: Awaited<ReturnType<typeof buildEvidenceReport>> | undefined;
  let scan: Awaited<ReturnType<typeof bookGapScan>> | undefined;
  let problem: string | undefined;
  if (!("error" in range)) {
    try {
      if (scope) report = await buildEvidenceReport(viewer, scope, range, "screen");
      else scan = await bookGapScan(viewer, range);
    } catch (error) {
      if (!(error instanceof EvidenceError)) throw error;
      problem = error.message;
    }
  }
  const content = "error" in range ? <ErrorState detail={range.error} /> : <EvidenceReportView query={query} report={report} scan={scan} problem={problem} />;
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Evidence report" description="What we hold about a number — and what is missing." />
      {content}
    </div>
  );
}
