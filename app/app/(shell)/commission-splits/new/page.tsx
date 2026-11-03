import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { SplitForm } from "@/components/app/agency/splits-board";

/**
 * AG-1.6 · New split (or Change, prefilled from a row: `?carrier&policy&writer&other&share`), a page of its own
 * (foundation pass 2026-11-03; it was a side panel beside the list). Saving the same carrier and policy replaces the
 * split from now on. Owner and admin only.
 */
export default async function NewSplitPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Commission splits" description="Policies two producers share." />;
  if (!actAsPage(guard, ["owner"]) || guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Commission splits" detail="The owner and admins record commission splits; the bookkeeper reads them." />;
  const { carrier, policy, writer, other, share } = await searchParams;
  return (
    <AccountingPage step="commissionSplits" title={policy ? `Change split · ${policy}` : "New split"} facts="The pool is the writer's, at the writer's level; the override comes off before it is split.">
      <SplitForm initial={{ carrier, policy, writer, other, share }} />
    </AccountingPage>
  );
}
