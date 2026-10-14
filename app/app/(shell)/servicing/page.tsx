import { guardPage } from "@/lib/entitlements/guardPage";
import { CAMPAIGN_PENDING_MESSAGE, loadCampaign } from "@/lib/retention/campaignStore";
import { loadServicing, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PaperBillCampaign } from "@/components/app/paper-bill-campaign";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ServicingBoard } from "@/components/app/servicing-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Book › Servicing (the `payment_repair` feature). Two views:
 *   · Requests (LA-5.4): every change asked of a carrier — payment date, bank or card, mailed bill to
 *     bank draft, address — open until the next carrier file proves it. Opening this view checks the
 *     open requests against the latest files (the database decides).
 *   · Paper bill → bank (LA-5.5): every in-force mailed-bill policy, biggest premium first, worked
 *     through before any of them fails. Opening it writes nothing.
 */
export default async function ServicingPage({ searchParams }: { searchParams: Promise<{ status?: string; view?: string }> }) {
  const guard = await guardPage("payment_repair");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Servicing" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  }
  if (!["owner", "producer"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Servicing" detail="Only owners and producers can open servicing requests." />;
  }
  const { status, view } = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  const readOnly = guard.entitlement.access === "read_only";
  const campaignView = view === "campaign";
  const [campaign, list] = campaignView ? [await loadCampaign(viewer), null] : [null, await loadServicing(viewer)];

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader
        title="Servicing"
        description={campaignView ? "Every policy paid by mailed bill, biggest premium first, switched to bank payment before it fails." : "Changes asked of the carrier, open until the next carrier file shows them."}
      />
      <ViewTabs
        label="Servicing views"
        active={campaignView ? "campaign" : "requests"}
        tabs={[
          { key: "requests", label: "Requests", href: "/app/servicing" },
          { key: "campaign", label: "Paper bill → bank", href: "/app/servicing?view=campaign" },
        ]}
      />
      {campaign ? (
        campaign.available ? <PaperBillCampaign campaign={campaign} isOwner={guard.role === "owner"} readOnly={readOnly} /> : <TableCard><EmptyState title="Not switched on yet" hint={CAMPAIGN_PENDING_MESSAGE} /></TableCard>
      ) : list && list.available ? (
        <ServicingBoard rows={list.rows} carriers={list.carriers} verifiedLast30={list.verifiedLast30} initialStatus={status === "failed" || status === "verified" || status === "all" ? status : "open"} readOnly={readOnly} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={SERVICING_PENDING_MESSAGE} />
        </TableCard>
      )}
    </div>
  );
}
