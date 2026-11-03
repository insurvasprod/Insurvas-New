import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { ViewTabs } from "@/components/ui/view-tabs";
import { PayoutsBoard } from "@/components/app/agency/payouts-board";
import { PRODUCER_PAYOUTS_SLOT } from "@/components/app/agency/slots";

/**
 * AG-1.7 · Accounting › Producer payouts (moved from Team › Payout runs, owner 2026-11-03; same address). The
 * owner, an admin or the bookkeeper runs them. Tabs on the title line: New run (the preview, `?tab=` absent) and
 * Runs (`?tab=runs`); a run's row opens its statement (/app/producer-statements/<run>).
 */
export default async function ProducerPayoutsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer payouts" description="Close a period and pay your producers." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Producer payouts" detail="The owner, admins and the bookkeeper run producer payouts. Your own pay is under My pay." />;
  const [{ tab: asked }, money] = await Promise.all([searchParams, guardPage("profit_and_loss")]);
  const tab = asked === "runs" ? "runs" : "run";
  const readOnly = guard.entitlement.access === "read_only";
  // Void a run and write off a balance are LA-7.5's routes, behind Profit & loss for the bookkeepers (one producer-pay system, 2026-11-03).
  const moneyActions = money.entitled && actAsPage(money, ["owner", "bookkeeper"]) && !readOnly;
  return (
    <AccountingPage
      step="producerPayouts"
      info="Close a period and pay your producers from their ledger. The preview writes nothing; negative balances come first, so you decide to pay, withhold or pay a stated amount before you commit. Each producer gets a statement. Nothing here moves money: it records how you paid."
      lead={<ViewTabs label="Producer payouts" value={tab} tabs={[{ key: "run", label: "New run", href: "/app/producer-payouts" }, { key: "runs", label: "Runs", href: "/app/producer-payouts?tab=runs" }]} />}
      actions={<StepSlotTarget id={PRODUCER_PAYOUTS_SLOT} />}
    >
      <PayoutsBoard tab={tab} canCommit={!readOnly} moneyActions={moneyActions} />
    </AccountingPage>
  );
}
