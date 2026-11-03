import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { DeletionError, deletionSettings, listDeletionRequests } from "@/lib/compliance/dataSubjectStore";
import { loadComplianceSettings } from "@/lib/compliance/settingsStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DeletionRequestsBoard, type DeletionQueue } from "@/components/app/compliance/deletion-requests-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Compliance › Deletions (LA-6.5, Notion sprint). One person asks to be deleted: verify who they are, hold
 * (cancellable), delete, and issue the certificate. Owners and producers log and read; the agency's
 * performers (Compliance settings, the owner by default) verify and perform. `?queue=` picks the tab; a
 * request opens its own page.
 */
export default async function DeletionRequestsPage({ searchParams }: { searchParams: Promise<{ queue?: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Deletion requests" description="When one person asks to be deleted: verify, hold, delete and certify." />;
  }
  if (!actAsPage(guard, ["owner", "producer"])) {
    return <RoleGateNotice featureLabel="Deletion requests" detail="Only owners and producers can see consumer deletion requests." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Deletion requests" detail="In an agency, the owner and admins handle deletion requests." />;
  const asked = (await searchParams).queue;
  const queue: DeletionQueue = asked === "ready" || asked === "done" || asked === "all" ? asked : "open";
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { requests: Awaited<ReturnType<typeof listDeletionRequests>>; settings: Awaited<ReturnType<typeof deletionSettings>>; performers: string[] } | null = null;
  let problem: string | null = null;
  try {
    const [requests, settings, compliance] = await Promise.all([listDeletionRequests(viewer), deletionSettings(viewer.tenantId), loadComplianceSettings(viewer.tenantId)]);
    loaded = { requests, settings, performers: compliance.deletion.performerRoles };
  } catch (error) {
    if (!(error instanceof DeletionError)) throw error;
    problem = error.message;
  }
  const content = loaded
    ? <DeletionRequestsBoard requests={loaded.requests} holdDays={loaded.settings.holdDays} queue={queue} mayPerform={loaded.performers.includes(guard.role)} readOnly={guard.entitlement.access === "read_only"} />
    : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  // The Deletions step of the one Compliance page (2026-10-30).
  return <ComplianceFlowPage step="deletions" info="Verify who it is first, then a short hold that can be cancelled, then the deletion and its certificate. The do-not-call entry is always kept, so they are never called again.">{content}</ComplianceFlowPage>;
}
