import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { LeadListDetailView } from "@/components/app/lead-list-detail";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { leadListDetail } from "@/lib/leadLists/detail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadListDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const guard = await guardPage("lead_import");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Lead lists"
        description="What you bought from each vendor, how much of it arrived, and how much of it nobody has touched."
      />
    );
  // The same roles as the index this opens from.
  if (!["owner", "producer", "assistant"].includes(guard.role))
    return <RoleGateNotice featureLabel="Lead lists" detail="Only owners, producers and assistants can hand out leads." />;

  const { campaignId } = await params;
  if (!UUID.test(campaignId)) notFound();

  // What a list turned into — issued policies and what each one cost — is True CPA's, under its
  // own feature, kill switch and roles. An assistant sees the inventory, never the economics.
  // Assigning goes through /api/app/assignments, which is Outbound dialing's and managers' only
  // (assign_lead_list refuses anyone else with ASSIGNMENT_MANAGER_REQUIRED).
  const [trueCpa, dialing] = await Promise.all([guardPage("true_cpa"), guardPage("outbound_dialing")]);
  const money = trueCpa.entitled && ["owner", "producer"].includes(guard.role);
  const manager = ["owner", "producer"].includes(guard.role);
  const assignBlocked = !dialing.entitled
    ? "Assigning leads needs Outbound dialing on your plan."
    : dialing.entitlement.access === "read_only"
      ? "Your plan is read-only right now, so leads cannot be assigned."
      : null;
  const [detail, timeZone] = await Promise.all([
    leadListDetail(guard.context.tenantId, guard.context.userId, campaignId, {
      money,
      readOnly: trueCpa.entitlement.access === "read_only",
    }),
    getWorkspaceTimezone(guard.context.tenantId).catch(() => null),
  ]);
  if (!detail) notFound();

  return (
    <LeadListDetailView
      detail={detail}
      money={money}
      timeZone={timeZone}
      assign={{ manager, blocked: assignBlocked }}
      claimBlocked={trueCpa.entitlement.access === "read_only" ? "Your plan is read-only right now, so a claim cannot be drafted." : null}
    />
  );
}
