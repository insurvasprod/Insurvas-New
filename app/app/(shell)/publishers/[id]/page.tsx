import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PartnersWorkspace, type PartnerExtraTab } from "@/components/app/partners-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { PartnerQualityDetailWorkspace } from "@/components/app/partner-quality-detail";
import { PayoutsBoard } from "@/components/app/accounting/payouts-board";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { listRuns, PayoutError } from "@/lib/accounting/payoutStore";
import type { ReactNode } from "react";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublisherDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const guard = await guardPage("publisher_records");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Partners"
        description="Manage publishers, marketing companies and affiliates."
      />
    );
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return (
      <RoleGateNotice
        featureLabel="Partners"
        detail="Partner records are managed by the account owner or bookkeeper."
      />
    );
  }

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = typeof query.tab === "string" ? query.tab : null;

  // Module 1 simplified (2026-10-25): quality and payouts for this one partner are sections of its
  // Overview. Each keeps the gate of the page it replaces — its feature on the plan, the roles that
  // page admits, and (quality) no narrowed agency session — so a section is shown only to someone who
  // could have opened that page. Chat stays in Partner chat; Message opens this partner's conversation.
  const extraTabs: Partial<Record<PartnerExtraTab, ReactNode>> = {};
  let messageHref: string | null = null;
  if (UUID.test(id)) {
    const [quality, payouts, chat, scope] = await Promise.all([
      guardPage("partner_quality"),
      guardPage("payout_runs"),
      guardPage("inbound_transfers"),
      scopeFor(guard.context),
    ]);
    if (quality.entitled && actAsPage(quality, ["owner", "producer", "bookkeeper"]) && scope === null) {
      extraTabs.quality = <PartnerQualityDetailWorkspace partnerId={id} embedded />;
    }
    if (payouts.entitled && actAsPage(payouts, ["owner", "bookkeeper"])) {
      const loaded = await listRuns(guard.context.tenantId).catch((error: unknown) => {
        if (error instanceof PayoutError) return null;
        throw error;
      });
      const partner = loaded?.partners.find((row) => row.id === id);
      if (loaded && partner) {
        extraTabs.payouts = (
          <PayoutsBoard
            runs={loaded.runs.filter((run) => run.partnerId === id)}
            partners={[partner]}
            readOnly={payouts.entitlement.access === "read_only"}
            openId={null}
            partnerFixed
          />
        );
      }
    }
    if (chat.entitled && actAsPage(chat, ["owner", "producer"])) {
      messageHref = `/app/partner-chat?partner=${id}`;
    }
  }

  // Partners A (2026-10-25): on the dashboard's moving ribbon.
  return (
    <DashboardStage ribbon>
    <PartnersWorkspace
      readOnly={guard.entitlement.access === "read_only"}
      canManageProductConfig={guard.role === "owner"}
      initialSelectedId={id}
      detailOnly
      extraTabs={extraTabs}
      initialTab={tab}
      messageHref={messageHref}
    />
    </DashboardStage>
  );
}
