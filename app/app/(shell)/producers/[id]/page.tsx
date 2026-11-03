import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducerDetail } from "@/components/app/agency/producer-detail";
import { hasFeature } from "@/lib/entitlements/types";

/** AG-1.1 · one producer's record. Visibility is enforced by the APIs (a producer cannot open another's: 404). */
export default async function ProducerPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Producers" detail="The owner, admins, managers, producers and the bookkeeper open producer records." />;
  const { id } = await params;
  return (
    <ProducerDetail
      producerId={id}
      viewer={{
        isOwner: guard.role === "owner",
        isManager: guard.context.memberRole === "manager",
        isBookkeeper: guard.role === "bookkeeper",
        canSeeMoney: hasFeature(guard.entitlement, "producer_payouts"),
      }}
    />
  );
}
