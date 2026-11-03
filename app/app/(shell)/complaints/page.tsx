import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { ComplaintError, deadlineSetup, listComplaints, loadThresholds } from "@/lib/compliance/complaintStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplaintsBoard } from "@/components/app/compliance/complaints-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Setup › Complaints (LA-6.4, Notion sprint). Every complaint with an owner, a deadline and a
 * countdown; days remaining is the order. Owner and producer only.
 */
export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ q?: string; open?: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Complaints" description="Every complaint with an owner, a deadline and a countdown." />;
  }
  if (!actAsPage(guard, ["owner", "producer"])) {
    return <RoleGateNotice featureLabel="Complaints" detail="Only owners and producers can see consumer complaints." />;
  }
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Complaints" detail="In an agency, the owner and admins handle complaints." />;
  const { q, open } = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { complaints: Awaited<ReturnType<typeof listComplaints>>; setup: Awaited<ReturnType<typeof deadlineSetup>>; thresholds: Awaited<ReturnType<typeof loadThresholds>>; team: { id: string; name: string; role: string }[]; partners: { id: string; name: string }[] } | null = null;
  let problem: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseServiceClient() as any;
    const [complaints, setup, thresholds, team, partners] = await Promise.all([
      listComplaints(viewer, { search: q ?? "" }),
      deadlineSetup(viewer.tenantId),
      loadThresholds(viewer.tenantId),
      db.from("tenant_users").select("user_id, role, users!inner(name, email)").eq("tenant_id", viewer.tenantId).not("accepted_at", "is", null),
      db.from("partners").select("id, name").eq("tenant_id", viewer.tenantId).order("name"),
    ]);
    loaded = {
      complaints, setup, thresholds,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      team: ((team.data ?? []) as any[]).map((m) => ({ id: m.user_id as string, name: (m.users?.name as string | null) ?? (m.users?.email as string) ?? "Unnamed", role: m.role as string })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      partners: ((partners.data ?? []) as any[]).map((p) => ({ id: p.id as string, name: p.name as string })),
    };
  } catch (error) {
    if (!(error instanceof ComplaintError)) throw error;
    problem = error.message;
  }
  const content = loaded ? (
    <ComplaintsBoard complaints={loaded.complaints} coverage={loaded.setup.coverage} thresholds={loaded.thresholds} search={q ?? ""} openId={open ?? null}
      isOwner={guard.role === "owner"} readOnly={guard.entitlement.access === "read_only"} team={loaded.team} partners={loaded.partners} />
  ) : (
    <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
  );
  // The Complaints step of the one Compliance page (2026-10-30).
  return <ComplianceFlowPage step="complaints">{content}</ComplianceFlowPage>;
}
