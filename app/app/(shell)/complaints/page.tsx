import { redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ComplaintError, deadlineSetup, listComplaints, loadThresholds } from "@/lib/compliance/complaintStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplaintsBoard, type ComplaintView } from "@/components/app/compliance/complaints-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Compliance › Complaints (LA-6.4, Notion sprint). Every complaint with an owner, a deadline and a
 * countdown; days remaining is the order. Owner and producer only. `?view=` picks Not resolved, Due soon
 * or All; a complaint opens its own page, and the old `?open=<id>` (Overview, the top bar's urgent alert,
 * the daily email) lands there.
 */
export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ q?: string; open?: string; view?: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Complaints" description="Every complaint with an owner, a deadline and a countdown." />;
  }
  if (!actAsPage(guard, ["owner", "producer"])) {
    return <RoleGateNotice featureLabel="Complaints" detail="Only owners and producers can see consumer complaints." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Complaints" detail="In an agency, the owner and admins handle complaints." />;
  const { q, open, view: asked } = await searchParams;
  if (open && /^[0-9a-f-]{36}$/i.test(open)) redirect(`/app/complaints/${open}`);
  const view: ComplaintView = asked === "due" || asked === "all" ? asked : "open";
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { complaints: Awaited<ReturnType<typeof listComplaints>>; setup: Awaited<ReturnType<typeof deadlineSetup>>; thresholds: Awaited<ReturnType<typeof loadThresholds>> } | null = null;
  let problem: string | null = null;
  try {
    const [complaints, setup, thresholds] = await Promise.all([listComplaints(viewer, { search: q ?? "" }), deadlineSetup(viewer.tenantId), loadThresholds(viewer.tenantId)]);
    loaded = { complaints, setup, thresholds };
  } catch (error) {
    if (!(error instanceof ComplaintError)) throw error;
    problem = error.message;
  }
  const content = loaded ? (
    <ComplaintsBoard complaints={loaded.complaints} coverage={loaded.setup.coverage} thresholds={loaded.thresholds} search={q ?? ""} view={view}
      isOwner={guard.role === "owner"} readOnly={guard.entitlement.access === "read_only"} />
  ) : (
    <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
  );
  // The Complaints step of the one Compliance page (2026-10-30).
  return <ComplianceFlowPage step="complaints" info="Days remaining is the order: amber inside the amber window, red inside the red one, overdue loudest. A complaint about unwanted calls puts the number on your do-not-call list the moment it is recorded.">{content}</ComplianceFlowPage>;
}
