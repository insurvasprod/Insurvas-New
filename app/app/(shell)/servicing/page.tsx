import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { CAMPAIGN_PENDING_MESSAGE, loadCampaign } from "@/lib/retention/campaignStore";
import { loadServicing, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PaperBillCampaign } from "@/components/app/paper-bill-campaign";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ServicingBoard } from "@/components/app/servicing-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { RetentionPage } from "@/components/app/retention/retention-page";

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
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Servicing" detail="Only owners, producers and retention reps can open servicing requests." />;
  }
  // The Requests view's chip (`?status=`) is read by the board itself, so it follows the address.
  const { view } = await searchParams;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const readOnly = guard.entitlement.access === "read_only";
  const campaignView = view === "campaign";
  const [campaign, list] = campaignView ? [await loadCampaign(viewer), null] : [null, await loadServicing(viewer)];

  return (
    <RetentionPage step="servicing" lead={<ViewTabs
        label="Servicing views"
        active={campaignView ? "campaign" : "requests"}
        tabs={[
          { key: "requests", label: "Requests", href: "/app/servicing" },
          { key: "campaign", label: "Paper bill → bank", href: "/app/servicing?view=campaign" },
        ]}
      />}>
    <>
      {campaign ? (
        campaign.available ? <PaperBillCampaign campaign={campaign} isOwner={guard.role === "owner"} readOnly={readOnly} /> : <TableCard><EmptyState title="Not switched on yet" hint={CAMPAIGN_PENDING_MESSAGE} /></TableCard>
      ) : list && list.available ? (
        <ServicingBoard rows={list.rows} verifiedLast30={list.verifiedLast30} readOnly={readOnly} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint={SERVICING_PENDING_MESSAGE} />
        </TableCard>
      )}
    </>
    </RetentionPage>
  );
}
