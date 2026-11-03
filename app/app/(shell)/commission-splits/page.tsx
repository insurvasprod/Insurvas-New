import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { Button } from "@/components/ui/button";
import { SplitsBoard } from "@/components/app/agency/splits-board";

/**
 * AG-1.6 · Accounting › Commission splits (moved from Team, owner 2026-11-03; same address). Owner and admin edit;
 * the bookkeeper reads. New split opens the form page; the pool rule sits behind the (i).
 */
export default async function CommissionSplitsPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Commission splits" description="Policies two producers share." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Commission splits" detail="The owner, admins and the bookkeeper see commission splits." />;
  const canEdit = guard.role === "owner" && guard.entitlement.access !== "read_only";
  return (
    <AccountingPage
      step="commissionSplits"
      info="Policies two producers agreed to share. The agency's commission pays the writer's pool at the writer's own level; the override comes off first, then the pool is split by the shares, which always add up to 100%. The other producer's own level is not applied. Not the same as Producer splits, which set each producer's share of the agency's commission."
      actions={canEdit ? <Button asChild><Link href="/app/commission-splits/new">New split</Link></Button> : undefined}
    >
      <SplitsBoard canEdit={canEdit} />
    </AccountingPage>
  );
}
