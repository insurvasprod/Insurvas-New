import { guardPage } from "@/lib/entitlements/guardPage";
import { DeletionError, deletionSettings, listDeletionRequests } from "@/lib/compliance/dataSubjectStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DeletionRequestsBoard } from "@/components/app/compliance/deletion-requests-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Setup › Deletion requests (LA-6.5, Notion sprint). One person asks to be deleted: verify who they
 * are, hold (cancellable), delete, and issue the certificate. Owners and producers log and read;
 * the owner verifies and performs.
 */
export default async function DeletionRequestsPage() {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Deletion requests" description="When one person asks to be deleted: verify, hold, delete and certify." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Deletion requests" detail="Only owners and producers can see consumer deletion requests." />;
  }
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { requests: Awaited<ReturnType<typeof listDeletionRequests>>; settings: Awaited<ReturnType<typeof deletionSettings>> } | null = null;
  let problem: string | null = null;
  try {
    const [requests, settings] = await Promise.all([listDeletionRequests(viewer), deletionSettings(viewer.tenantId)]);
    loaded = { requests, settings };
  } catch (error) {
    if (!(error instanceof DeletionError)) throw error;
    problem = error.message;
  }
  const content = loaded
    ? <DeletionRequestsBoard requests={loaded.requests} methods={loaded.settings.methods} holdDays={loaded.settings.holdDays} isOwner={guard.role === "owner"} readOnly={guard.entitlement.access === "read_only"} />
    : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Deletion requests" description="Someone asked to be deleted: verify, hold, delete, certify." />
      {content}
    </div>
  );
}
